# app.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict
import os, requests
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

OSRM_URL = os.getenv("OSRM_URL", "http://localhost:5000")  # ví dụ: http://localhost:5000

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # chặt chẽ hơn: ["http://localhost:5173"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ATM(BaseModel):
    atm_id: int
    lat: float
    lon: float
    final_address: str | None = None
    raw_address: str | None = None

class SolveReq(BaseModel):
    depot_id: int = Field(..., description="ATM id for depot (start & end)")
    atms: List[ATM] = Field(..., description="Danh sách ATM gồm cả depot")

class SolveResp(BaseModel):
    order_ids: List[int]
    total_distance_m: int
    legs_m: List[int]

def osrm_table_distance_matrix(coords: List[tuple[float,float]]) -> List[List[int]]:
    """
    Gọi OSRM /table để lấy ma trận khoảng cách (meters).
    coords = [(lon,lat), ...] (CHÚ Ý: OSRM dùng lon,lat)
    """
    locs = ";".join([f"{lon},{lat}" for (lon,lat) in coords])
    url = f"{OSRM_URL}/table/v1/driving/{locs}"
    # annotations=distance để lấy meters (nếu không có, OSRM trả durations mặc định)
    params = {"annotations": "distance"}
    r = requests.get(url, params=params, timeout=30)
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"OSRM table error: {r.text}")
    js = r.json()
    if "distances" not in js or js["distances"] is None:
        raise HTTPException(status_code=500, detail="OSRM không trả về distances; kiểm tra dữ liệu/annotations.")
    # Làm tròn int
    D = [[int(round(x if x is not None else 10**9)) for x in row] for row in js["distances"]]
    return D

@app.post("/solve", response_model=SolveResp)
def solve(req: SolveReq):
    # Gom unique theo atm_id, và kiểm tra depot
    uniq: Dict[int, ATM] = {a.atm_id: a for a in req.atms}
    if req.depot_id not in uniq:
        raise HTTPException(status_code=400, detail=f"Thiếu depot id {req.depot_id} trong danh sách atms.")

    ids = list(uniq.keys())
    id2idx = {id_: i for i, id_ in enumerate(ids)}
    depot_idx = id2idx[req.depot_id]

    # Tạo danh sách toạ độ cho OSRM: (lon,lat)
    points = [uniq[i] for i in ids]
    coords = [(p.lon, p.lat) for p in points]

    # Ma trận khoảng cách từ OSRM (meters)
    try:
        dist = osrm_table_distance_matrix(coords)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi gọi OSRM: {e}")

    n = len(points)
    # OR-Tools: start=end=depot
    manager = pywrapcp.RoutingIndexManager(n, 1, [depot_idx], [depot_idx])
    routing = pywrapcp.RoutingModel(manager)

    def distance_cb(from_index, to_index):
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        return dist[i][j]

    transit_idx = routing.RegisterTransitCallback(distance_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    search = pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search.time_limit.FromSeconds(8)

    sol = routing.SolveWithParameters(search)
    if not sol:
        return SolveResp(order_ids=[req.depot_id], total_distance_m=0, legs_m=[])

    # Lấy route (vòng kín start=end depot)
    index = routing.Start(0)
    order_idx = []
    legs = []
    total = 0
    prev_index = None
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        order_idx.append(node)
        if prev_index is not None:
            d = dist[manager.IndexToNode(prev_index)][node]
            total += d
            legs.append(d)
        prev_index = index
        index = sol.Value(routing.NextVar(index))

    # thêm điểm cuối (depot)
    if prev_index is not None:
        last_node = manager.IndexToNode(prev_index)
        end_node = manager.IndexToNode(index)  # depot
        if last_node != end_node:
            d = dist[last_node][end_node]
            total += d
            legs.append(d)
        order_idx.append(end_node)

    order_ids = [ids[i] for i in order_idx]
    return SolveResp(order_ids=order_ids, total_distance_m=int(total), legs_m=legs)
