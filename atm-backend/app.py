# app.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict
import os, requests
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
import pandas as pd
from pathlib import Path


OSRM_URL = os.getenv("OSRM_URL", "http://localhost:5000")  # ví dụ: http://localhost:5000

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- HEALTH (đặt sớm để dễ test) ---
@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}


# app.py (thêm ngay sau tạo FastAPI app)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

# thư mục build của React sẽ đặt tên "webui"


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


def solve_tsp_from_csv(csv_file: str | Path, start_node_id: int, subset_ids: list[int] | None = None):
    """
    Đọc ma trận khoảng cách CSV (index là node id), giải TSP vòng kín.
    Nếu subset_ids được truyền, chỉ lấy ma trận con theo thứ tự subset_ids (phải gồm cả depot).
    Trả (route_ids(list[str]), total_distance(int meters)).
    """
    csv_file = Path(csv_file)
    if not csv_file.exists():
        raise HTTPException(status_code=400, detail=f"CSV not found: {csv_file}")

    df = pd.read_csv(csv_file, index_col=0)
    df.index = df.index.astype(str)
    # nếu truyền subset -> cắt ma trận theo thứ tự subset
    if subset_ids is not None:
        want = [str(x) for x in subset_ids]
        missing = [x for x in want if x not in df.index]
        if missing:
            raise HTTPException(status_code=400, detail=f"IDs not in CSV index: {missing}")
        df = df.loc[want, want]

    ids = list(df.index)  # string
    if str(start_node_id) not in ids:
        raise HTTPException(status_code=400, detail=f"start_id {start_node_id} not in CSV index (after subset)")

    id_to_index = {id_: i for i, id_ in enumerate(ids)}
    distance_matrix = df.values.tolist()

    manager = pywrapcp.RoutingIndexManager(len(distance_matrix), 1, id_to_index[str(start_node_id)])
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        f = manager.IndexToNode(from_index)
        t = manager.IndexToNode(to_index)
        return int(distance_matrix[f][t])

    cb = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(cb)

    search = pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search.time_limit.seconds = 10

    sol = routing.SolveWithParameters(search)
    if not sol:
        return [], 0

    index = routing.Start(0)
    route_ids = []
    total = 0
    prev = None
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        route_ids.append(ids[node])
        if prev is not None:
            total += routing.GetArcCostForVehicle(prev, index, 0)
        prev = index
        index = sol.Value(routing.NextVar(index))

    route_ids.append(ids[manager.IndexToNode(index)])  # quay về depot
    return route_ids, int(total)



class CSVRouteSpec(BaseModel):
    name: str
    file: str
    start_id: int

class SolveCSVMultiReq(BaseModel):
    routes: List[CSVRouteSpec] | None = None
    # Nếu không truyền, sẽ dùng default 3 tuyến như bên dưới.

class SolveCSVMultiResp(BaseModel):
    results: Dict[str, Dict[str, object]]  # name -> {order_ids, total_distance_m}


@app.post("/solve_csv_multi", response_model=SolveCSVMultiResp)
def solve_csv_multi(req: SolveCSVMultiReq):
    """
    Tối ưu 3 tuyến (hoặc nhiều tuyến) độc lập từ các file CSV có sẵn.
    CSV phải là ma trận khoảng cách, index là node id (string/numeric).
    """
    # Base dir: .../AppBIDV  (ngang hàng với atm-backend)
    # app.py đang ở: .../AppBIDV/atm-backend/app.py
    BASE = Path(__file__).resolve().parents[1]  # => .../AppBIDV

    default_routes = [
        CSVRouteSpec(name="Tuyen1", file="Distance_Matrix_Tuyến1.csv", start_id=1),
        CSVRouteSpec(name="Tuyen2", file="Distance_Matrix_Tuyến2.csv", start_id=2),
        CSVRouteSpec(name="Tuyen3", file="Distance_Matrix_Tuyến3.csv", start_id=3),
    ]
    routes = req.routes if req.routes else default_routes

    results = {}
    for r in routes:
        csv_path = BASE / r.file  # CSV đặt trực tiếp trong AppBIDV\
        order_ids, total = solve_tsp_from_csv(csv_path, r.start_id)
        results[r.name] = {
            "order_ids": order_ids,
            "total_distance_m": total
        }

    return SolveCSVMultiResp(results=results)


from pydantic import BaseModel
from typing import Dict, List

class SolveCSVSelectedReq(BaseModel):
    # map tên tuyến -> danh sách atm_id đã chọn (KHÔNG gồm depot)
    routes: Dict[str, List[int]]  # keys: "Tuyen1"/"Tuyen2"/"Tuyen3"
    # tuỳ chọn override depot id & file csv:
    depots: Dict[str, int] | None = None
    files: Dict[str, str] | None = None

class SolveCSVSelectedResp(BaseModel):
    results: Dict[str, Dict[str, object]]  # name -> {order_ids, total_distance_m}

@app.post("/solve_csv_selected", response_model=SolveCSVSelectedResp)
def solve_csv_selected(req: SolveCSVSelectedReq):
    """
    Nhận các điểm đã chọn theo từng tuyến, cắt ma trận CSV theo tập con (có thêm depot)
    rồi giải TSP từng tuyến độc lập.
    """
    BASE = Path(__file__).resolve().parents[1]  # .../AppBIDV
    default_files = {
        "Tuyen1": "Distance_Matrix_Tuyến1.csv",
        "Tuyen2": "Distance_Matrix_Tuyến2.csv",
        "Tuyen3": "Distance_Matrix_Tuyến3.csv",
    }
    default_depots = {"Tuyen1": 1, "Tuyen2": 2, "Tuyen3": 3}
    files = req.files or default_files
    depots = req.depots or default_depots

    results = {}
    for name, picked in req.routes.items():
        if not picked:
            continue
        csv_path = BASE / files.get(name, default_files.get(name, ""))
        depot_id = depots.get(name, default_depots.get(name))
        subset = [depot_id] + list(dict.fromkeys(picked))  # unique, giữ thứ tự
        order_ids, total = solve_tsp_from_csv(csv_path, depot_id, subset_ids=subset)
        # convert string IDs về int nếu được
        order_int = []
        for s in order_ids:
            try: order_int.append(int(s))
            except: order_int.append(s)  # fallback
        results[name] = {"order_ids": order_int, "total_distance_m": total}

    return SolveCSVSelectedResp(results=results)




app.mount("/ui", StaticFiles(directory="webui", html=True), name="ui")

# --- REDIRECT "/" sang UI ---
@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/ui/")

if __name__ == "__main__":
    import uvicorn, os
    port = int(os.getenv("APP_PORT", "8000"))
    uvicorn.run("app:app", host="127.0.0.1", port=port, log_level="info")
