# app.py - Backend dung CSV, 3 tuyen, khong OSRM

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, List
from pathlib import Path
import os

import pandas as pd
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

# ---------- FastAPI app ----------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # co the gioi han lai sau
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Health check ----------
@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}


# ---------- Model request/response ----------
class SolveCSVSelectedReq(BaseModel):
    # map ten tuyen -> danh sach atm_id da chon (KHONG gom depot)
    # keys: "Tuyen1", "Tuyen2", "Tuyen3"
    routes: Dict[str, List[int]]
    # co the override depot id va ten file neu muon
    depots: Dict[str, int] | None = None
    files: Dict[str, str] | None = None


class SolveCSVSelectedResp(BaseModel):
    # name -> {order_ids: list[int|str], total_distance_m: int}
    results: Dict[str, Dict[str, object]]


# ---------- TSP solver tu CSV ----------
def solve_tsp_from_csv(csv_file: str | Path, start_id: int, subset_ids: List[int]) -> tuple[list[str], int]:
    """
    Doc ma tran khoang cach tu CSV, cat ma tran con theo subset_ids (phai co ca start_id),
    giai TSP (vong kin) bang OR-Tools, tra ve (route_ids, total_distance).
    route_ids la list string (theo index CSV).
    """
    csv_file = Path(csv_file)
    if not csv_file.exists():
        raise HTTPException(status_code=400, detail=f"CSV not found: {csv_file}")

    df = pd.read_csv(csv_file, index_col=0)
    df.index = df.index.astype(str)

    want = [str(x) for x in subset_ids]
    missing = [x for x in want if x not in df.index]
    if missing:
        raise HTTPException(status_code=400, detail=f"IDs not in CSV index: {missing}")

    df = df.loc[want, want]

    ids = list(df.index)  # string
    if str(start_id) not in ids:
        raise HTTPException(
            status_code=400,
            detail=f"start_id {start_id} not in CSV index after subset. Current ids: {ids}",
        )

    id_to_index = {id_: i for i, id_ in enumerate(ids)}
    distance_matrix = df.values.tolist()

    manager = pywrapcp.RoutingIndexManager(len(distance_matrix), 1, id_to_index[str(start_id)])
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
    route_ids: list[str] = []
    total = 0
    prev = None
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        route_ids.append(ids[node])
        if prev is not None:
            total += routing.GetArcCostForVehicle(prev, index, 0)
        prev = index
        index = sol.Value(routing.NextVar(index))

    # quay ve depot
    route_ids.append(ids[manager.IndexToNode(index)])
    return route_ids, int(total)


# ---------- Endpoint giai 3 tuyen tu CSV ----------
@app.post("/solve_csv_selected", response_model=SolveCSVSelectedResp)
def solve_csv_selected(req: SolveCSVSelectedReq):
    """
    Nhan cac diem da chon theo tung tuyen, cat ma tran CSV theo tap con (them depot),
    giai TSP tung tuyen doc lap, tra ket qua.
    """
    # Folder cha: .../AppBIDV (app.py nam trong .../AppBIDV/atm-backend/)
    BASE = Path(__file__).resolve().parents[1]

    default_files = {
        "Tuyen1": "Distance_Matrix_Tuyến1.csv",
        "Tuyen2": "Distance_Matrix_Tuyến2.csv",
        "Tuyen3": "Distance_Matrix_Tuyến3.csv",
    }
    default_depots = {
        "Tuyen1": 1,
        "Tuyen2": 2,
        "Tuyen3": 3,
    }

    files = req.files or default_files
    depots = req.depots or default_depots

    results: Dict[str, Dict[str, object]] = {}

    for name, picked in req.routes.items():
        if not picked:
            continue

        csv_name = files.get(name, default_files.get(name))
        if not csv_name:
            continue

        depot_id = depots.get(name, default_depots.get(name))
        if depot_id is None:
            continue

        csv_path = BASE / csv_name

        # tap con: [depot] + cac ATM da chon (unique, giu thu tu)
        subset = [depot_id] + list(dict.fromkeys(picked))

        route_ids_str, total = solve_tsp_from_csv(csv_path, depot_id, subset_ids=subset)

        # convert ra int neu duoc
        order_ids: list[object] = []
        for s in route_ids_str:
            try:
                order_ids.append(int(s))
            except ValueError:
                order_ids.append(s)

        results[name] = {
            "order_ids": order_ids,
            "total_distance_m": total,
        }

    return SolveCSVSelectedResp(results=results)


# ---------- Mount React build (STATIC) ----------
# LUU Y: dong nay DAT CUOI CUNG, sau tat ca cac @app.get/@app.post
app.mount("/", StaticFiles(directory="webui", html=True), name="ui")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("APP_PORT", "8000"))
    uvicorn.run("app:app", host="127.0.0.1", port=port, log_level="info")
