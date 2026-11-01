"""Builds tables.bin, the lookup tables the solver needs.

This only has to run once. The finished file is committed with the project,
so the website never has to wait for it.
"""

import pickle
import zlib
from array import array

from cube import MOVE_NAMES, MOVES, Cube

PHASE_TWO_NAMES = ["U", "U2", "U'", "D", "D2", "D'", "R2", "L2", "F2", "B2"]
PHASE_TWO_MOVES = [MOVES[MOVE_NAMES.index(name)] for name in PHASE_TWO_NAMES]


def build_move_table(coordinate, moves):
    """For every coordinate value, record the value each move leads to."""
    solved = Cube()
    examples = {coordinate(solved): solved}
    waiting = [coordinate(solved)]
    results = {}

    while waiting:
        value = waiting.pop()
        for m, move in enumerate(moves):
            next_cube = examples[value].apply(move)
            next_value = coordinate(next_cube)
            results[value * len(moves) + m] = next_value
            if next_value not in examples:
                examples[next_value] = next_cube
                waiting.append(next_value)

    return array("H", (results[i] for i in range(len(results))))


def build_pruning_table(table_a, table_b, goal_a, goal_b, n_moves):
    """Record the fewest moves from every pair of values to the goal pair."""
    size_a = len(table_a) // n_moves
    size_b = len(table_b) // n_moves
    distances = bytearray(b"\xff") * (size_a * size_b)
    distances[goal_a * size_b + goal_b] = 0
    frontier = [goal_a * size_b + goal_b]
    depth = 0

    while frontier:
        depth += 1
        next_frontier = []
        for state in frontier:
            a, b = divmod(state, size_b)
            for m in range(n_moves):
                next_state = table_a[a * n_moves + m] * size_b + table_b[b * n_moves + m]
                if distances[next_state] == 255:
                    distances[next_state] = depth
                    next_frontier.append(next_state)
        frontier = next_frontier
        print(f"  depth {depth}: {len(frontier)} states")

    return bytes(distances)


def main():
    print("Building move tables")
    twist = build_move_table(Cube.twist, MOVES)
    flip = build_move_table(Cube.flip, MOVES)
    slice_positions = build_move_table(Cube.slice_positions, MOVES)
    corner_order = build_move_table(Cube.corner_order, PHASE_TWO_MOVES)
    edge_order = build_move_table(Cube.edge_order, PHASE_TWO_MOVES)
    slice_order = build_move_table(Cube.slice_order, PHASE_TWO_MOVES)

    home = Cube().slice_positions()

    print("Building pruning tables")
    tables = {
        "twist": twist.tobytes(),
        "flip": flip.tobytes(),
        "slice_positions": slice_positions.tobytes(),
        "corner_order": corner_order.tobytes(),
        "edge_order": edge_order.tobytes(),
        "slice_order": slice_order.tobytes(),
        "slice_twist": build_pruning_table(slice_positions, twist, home, 0, 18),
        "slice_flip": build_pruning_table(slice_positions, flip, home, 0, 18),
        "corner_slice": build_pruning_table(corner_order, slice_order, 0, 0, 10),
        "edge_slice": build_pruning_table(edge_order, slice_order, 0, 0, 10),
    }

    with open("tables.bin", "wb") as file:
        file.write(zlib.compress(pickle.dumps(tables), 9))
    print("Saved tables.bin")


if __name__ == "__main__":
    main()
