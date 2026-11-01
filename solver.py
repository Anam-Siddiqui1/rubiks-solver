"""Kociemba's two-phase algorithm.

Solving a cube directly means searching far too many positions, so the job is
split in two:

  Phase one: reach a position where every corner and edge is oriented correctly
             and the middle-layer edges are in the middle layer.
  Phase two: finish the solve using only moves that keep all of that true.

Both phases use IDA*: a depth-first search that tries longer and longer limits,
and abandons a path when a lookup table proves the limit can't be met.

The first solution is rarely the shortest, so the search keeps improving it. It
stops after a short look if it has GOOD_LENGTH moves or fewer, after MAX_TIME
regardless, or as soon as it has proved that nothing shorter exists.
"""

import os
import pickle
import time
import zlib
from array import array

from build_tables import PHASE_TWO_NAMES
from cube import MOVE_NAMES, MOVES, Cube, invert_moves, random_cube

GOOD_LENGTH = 20
MIN_TIME = 0.4
MAX_TIME = 2.0

TWISTS = 2187
FLIPS = 2048
SLICE_ORDERS = 24
SLICE_HOME = Cube().slice_positions()

PHASE_ONE_FACES = [move // 3 for move in range(18)]
PHASE_TWO_FACES = ["URFDLB".index(name[0]) for name in PHASE_TWO_NAMES]
PHASE_TWO_INDEXES = [MOVE_NAMES.index(name) for name in PHASE_TWO_NAMES]


def load_tables():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tables.bin")
    with open(path, "rb") as file:
        tables = pickle.loads(zlib.decompress(file.read()))

    for name in ("twist", "flip", "slice_positions", "corner_order", "edge_order", "slice_order"):
        tables[name] = array("H", tables[name])
    return tables


TABLES = load_tables()
TWIST = TABLES["twist"]
FLIP = TABLES["flip"]
SLICE_POSITIONS = TABLES["slice_positions"]
CORNER_ORDER = TABLES["corner_order"]
EDGE_ORDER = TABLES["edge_order"]
SLICE_ORDER = TABLES["slice_order"]
SLICE_TWIST = TABLES["slice_twist"]
SLICE_FLIP = TABLES["slice_flip"]
CORNER_SLICE = TABLES["corner_slice"]
EDGE_SLICE = TABLES["edge_slice"]


def skip_face(face, last_face):
    """Turning a face twice in a row is wasteful, and opposite faces can go in either order."""
    return face == last_face or last_face - face == 3


class Search:
    def __init__(self, cube, min_time, max_time):
        self.cube = cube
        self.started = time.perf_counter()
        self.min_time = min_time
        self.max_time = max_time
        self.best = None

    def finished(self):
        """Decide whether to stop. There must always be a solution to return first."""
        if self.best is None:
            return False
        elapsed = time.perf_counter() - self.started
        return elapsed > self.max_time or (elapsed > self.min_time and len(self.best) <= GOOD_LENGTH)

    def run(self):
        twist, flip = self.cube.twist(), self.cube.flip()
        slice_positions = self.cube.slice_positions()
        depth = max(
            SLICE_TWIST[slice_positions * TWISTS + twist],
            SLICE_FLIP[slice_positions * FLIPS + flip],
        )
        # Phase one alone can't take longer than a whole solution, so once its
        # limit reaches the best length, nothing shorter is left to find
        while not self.finished() and (self.best is None or depth < len(self.best)):
            self.phase_one(twist, flip, slice_positions, depth, -1, [])
            depth += 1
        return self.best

    def phase_one(self, twist, flip, slice_positions, depth, last_face, path):
        if depth == 0:
            self.start_phase_two(path)
            return

        for move in range(18):
            face = PHASE_ONE_FACES[move]
            if skip_face(face, last_face):
                continue

            next_twist = TWIST[twist * 18 + move]
            next_flip = FLIP[flip * 18 + move]
            next_slice = SLICE_POSITIONS[slice_positions * 18 + move]

            estimate = max(
                SLICE_TWIST[next_slice * TWISTS + next_twist],
                SLICE_FLIP[next_slice * FLIPS + next_flip],
            )
            # Reaching the goal before the limit means a shorter path was already tried
            if estimate > depth - 1 or (estimate == 0 and depth > 1):
                continue

            path.append(move)
            self.phase_one(next_twist, next_flip, next_slice, depth - 1, face, path)
            path.pop()
            if self.finished():
                return

    def start_phase_two(self, phase_one_path):
        cube = self.cube
        for move in phase_one_path:
            cube = cube.apply(MOVES[move])

        corners, edges, middle = cube.corner_order(), cube.edge_order(), cube.slice_order()
        estimate = phase_two_estimate(corners, edges, middle)

        # Only a solution shorter than the best one so far is worth finding
        best_length = len(self.best) if self.best else 32
        limit = best_length - len(phase_one_path) - 1
        last_face = PHASE_ONE_FACES[phase_one_path[-1]] if phase_one_path else -1

        for depth in range(estimate, limit + 1):
            path = self.phase_two(corners, edges, middle, depth, last_face, [])
            if path is not None:
                self.best = phase_one_path + path
                self.phase_one_length = len(phase_one_path)
                return

    def phase_two(self, corners, edges, middle, depth, last_face, path):
        if depth == 0:
            return path if corners == edges == middle == 0 else None

        for m in range(10):
            face = PHASE_TWO_FACES[m]
            if skip_face(face, last_face):
                continue

            next_corners = CORNER_ORDER[corners * 10 + m]
            next_edges = EDGE_ORDER[edges * 10 + m]
            next_middle = SLICE_ORDER[middle * 10 + m]

            if phase_two_estimate(next_corners, next_edges, next_middle) > depth - 1:
                continue

            result = self.phase_two(next_corners, next_edges, next_middle, depth - 1, face,
                                    path + [PHASE_TWO_INDEXES[m]])
            if result is not None:
                return result
        return None


def phase_two_estimate(corners, edges, middle):
    return max(
        CORNER_SLICE[corners * SLICE_ORDERS + middle],
        EDGE_SLICE[edges * SLICE_ORDERS + middle],
    )


def solve(cube, min_time=MIN_TIME, max_time=MAX_TIME):
    """Return the moves that solve a cube, split into the two phases."""
    if is_solved(cube):
        return {"phase_one": [], "phase_two": []}

    search = Search(cube, min_time, max_time)
    names = [MOVE_NAMES[move] for move in search.run()]
    split = search.phase_one_length
    return {"phase_one": names[:split], "phase_two": names[split:]}


def is_solved(cube):
    solved = Cube()
    return (cube.cp == solved.cp and cube.co == solved.co
            and cube.ep == solved.ep and cube.eo == solved.eo)


def scramble():
    """Return moves that lead to a truly random position, by solving one backwards."""
    solution = solve(random_cube(), min_time=0, max_time=0.3)
    return invert_moves(solution["phase_one"] + solution["phase_two"])
