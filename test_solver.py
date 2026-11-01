"""Checks the cube model and the solver. Run with: python test_solver.py"""

import random
import time

from cube import (
    CORNER_COLOURS, CORNER_STICKERS, EDGE_COLOURS, EDGE_STICKERS, FACES, MOVE_NAMES, MOVES,
    Cube, InvalidCube, cube_from_stickers, invert_moves, random_cube,
)
from solver import is_solved, scramble, solve


def apply_names(cube, names):
    for name in names:
        cube = cube.apply(MOVES[MOVE_NAMES.index(name)])
    return cube


def to_stickers(cube):
    """The reverse of cube_from_stickers, used to check that the two agree."""
    stickers = [face for face in FACES for _ in range(9)]
    for position, piece, twist in zip(CORNER_STICKERS, cube.cp, cube.co):
        colours = CORNER_COLOURS[piece]
        for i, sticker in enumerate(position):
            stickers[sticker] = colours[(i - twist) % 3]
    for position, piece, flip in zip(EDGE_STICKERS, cube.ep, cube.eo):
        colours = EDGE_COLOURS[piece]
        for i, sticker in enumerate(position):
            stickers[sticker] = colours[(i + flip) % 2]
    return "".join(stickers)


def test_moves():
    for name in "URFDLB":
        assert is_solved(apply_names(Cube(), [name] * 4)), name
        assert is_solved(apply_names(Cube(), [name, name + "'"])), name
        assert is_solved(apply_names(Cube(), [name + "2", name + "2"])), name
    # A known fact about real cubes: this sequence repeats after six goes
    assert is_solved(apply_names(Cube(), ["R", "U", "R'", "U'"] * 6))
    assert not is_solved(apply_names(Cube(), ["R", "U", "R'", "U'"] * 5))


def test_stickers():
    solved = "".join(face * 9 for face in FACES)
    assert to_stickers(Cube()) == solved
    assert is_solved(cube_from_stickers(solved))

    # Turning U moves the front face's top row onto the left face
    turned = to_stickers(apply_names(Cube(), ["U"]))
    assert turned[36:39] == "FFF" and turned[18:21] == "RRR"

    for _ in range(100):
        cube = random_cube()
        read = cube_from_stickers(to_stickers(cube))
        assert (read.cp, read.co, read.ep, read.eo) == (cube.cp, cube.co, cube.ep, cube.eo)


def test_invalid_cubes():
    solved = list("".join(face * 9 for face in FACES))

    def swapped(a, b):
        stickers = solved[:]
        stickers[a], stickers[b] = stickers[b], stickers[a]
        return "".join(stickers)

    twisted = solved[:]
    twisted[8], twisted[9], twisted[20] = twisted[9], twisted[20], twisted[8]

    bad = ["", "U" * 54, swapped(4, 13), swapped(5, 10), "".join(twisted)]
    for stickers in bad:
        try:
            cube_from_stickers(stickers)
        except InvalidCube:
            continue
        raise AssertionError(f"Accepted an impossible cube: {stickers}")


def test_solver():
    lengths, times = [], []
    for _ in range(100):
        cube = random_cube()
        started = time.perf_counter()
        solution = solve(cube)
        times.append(time.perf_counter() - started)
        moves = solution["phase_one"] + solution["phase_two"]
        lengths.append(len(moves))
        assert is_solved(apply_names(cube, moves))

    print(f"100 random cubes: average {sum(lengths) / 100:.1f} moves, longest {max(lengths)}")
    print(f"Time: average {sum(times) / 100:.2f}s, slowest {max(times):.2f}s")


def test_edge_cases():
    assert solve(Cube()) == {"phase_one": [], "phase_two": []}
    for names in (["R"], ["U"], ["U", "R2"], ["R", "U", "F"], ["F", "B", "L"]):
        cube = apply_names(Cube(), names)
        solution = solve(cube)
        assert is_solved(apply_names(cube, solution["phase_one"] + solution["phase_two"]))
        assert len(solution["phase_one"] + solution["phase_two"]) <= len(names), names


def test_scramble():
    for _ in range(10):
        moves = scramble()
        solution = solve(apply_names(Cube(), moves))
        assert is_solved(apply_names(apply_names(Cube(), moves), solution["phase_one"] + solution["phase_two"]))
        assert is_solved(apply_names(apply_names(Cube(), moves), invert_moves(moves)))


if __name__ == "__main__":
    random.seed(7)
    test_moves()
    test_stickers()
    test_invalid_cubes()
    test_edge_cases()
    test_scramble()
    test_solver()
    print("All tests passed")
