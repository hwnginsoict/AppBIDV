import pandas as pd
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

# ---------- Function TSP solver ----------
def solve_tsp(csv_file, start_node_id):
    # Load distance matrix
    df = pd.read_csv(csv_file, index_col=0)
    ids = list(df.index.astype(str))
    id_to_index = {id_: i for i, id_ in enumerate(ids)}

    # Distance matrix as nested list
    distance_matrix = df.values.tolist()

    # Create routing index manager
    manager = pywrapcp.RoutingIndexManager(len(distance_matrix), 1, id_to_index[str(start_node_id)])

    # Create routing model
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(distance_matrix[from_node][to_node])

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Add constraint: return to start
    # routing.SetDepot(id_to_index[str(start_node_id)])

    # Search parameters
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.seconds = 10

    # Solve
    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        print(f"No solution for {csv_file}")
        return None

    # Extract route
    index = routing.Start(0)
    route_ids = []
    route_distance = 0
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        route_ids.append(ids[node])
        previous_index = index
        index = solution.Value(routing.NextVar(index))
        route_distance += routing.GetArcCostForVehicle(previous_index, index, 0)

    # add depot again
    route_ids.append(ids[manager.IndexToNode(index)])

    return route_ids, route_distance


# ---------- Run for each route ----------
routes = {
    "Tuyen1": {"file": "Distance_Matrix_Tuyến1.csv", "start_id": 1},
    "Tuyen2": {"file": "Distance_Matrix_Tuyến2.csv", "start_id": 2},
    "Tuyen3": {"file": "Distance_Matrix_Tuyến3.csv", "start_id": 3},
}

for name, info in routes.items():
    result = solve_tsp(info["file"], info["start_id"])
    if result:
        path, dist = result
        print(f"✅ {name}:")
        print(" -> ".join(path))
        print(f"Total distance = {dist/1000:.2f} km\n")
