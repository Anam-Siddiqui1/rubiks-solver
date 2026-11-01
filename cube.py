"""The cube itself: its pieces, its moves, and reading a cube from its colours.

A cube is stored as 8 corners and 12 edges. Each list says which piece sits in
each position, and how that piece is twisted (corners) or flipped (edges).
"""

import random
from math import comb

URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB = range(8)
UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR = range(12)

FACES = "URFDLB"

# Which stickers belong to each piece, numbered 0-53 in the order U, R, F, D, L, B
CORNER_STICKERS = [
    (8, 9, 20), (6, 18, 38), (0, 36, 47), (2, 45, 11),
    (29, 26, 15), (27, 44, 24), (33, 53, 42), (35, 17, 51),
]
EDGE_STICKERS = [
    (5, 10), (7, 19), (3, 37), (1, 46), (32, 16), (28, 25),
    (30, 43), (34, 52), (23, 12), (21, 41), (50, 39), (48, 14),
]
CORNER_COLOURS = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"]
EDGE_COLOURS = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"]


class Cube:
    def __init__(self, cp=None, co=None, ep=None, eo=None):
        self.cp = cp or list(range(8))
        self.co = co or [0] * 8
        self.ep = ep or list(range(12))
        self.eo = eo or [0] * 12

    def apply(self, move):
        """Return a new cube with another cube's arrangement applied on top."""
        return Cube(
            [self.cp[i] for i in move.cp],
            [(self.co[i] + o) % 3 for i, o in zip(move.cp, move.co)],
            [self.ep[i] for i in move.ep],
            [(self.eo[i] + o) % 2 for i, o in zip(move.ep, move.eo)],
        )

    # The coordinates below turn parts of the cube into single numbers,
    # which is what lets the solver use lookup tables instead of whole cubes.

    def twist(self):
        """How all the corners are twisted: 0 to 2186."""
        value = 0
        for orientation in self.co[:7]:
            value = value * 3 + orientation
        return value

    def flip(self):
        """How all the edges are flipped: 0 to 2047."""
        value = 0
        for orientation in self.eo[:11]:
            value = value * 2 + orientation
        return value

    def slice_positions(self):
        """Where the four middle-layer edges are: 0 to 494, with 494 meaning home."""
        positions = [i for i, edge in enumerate(self.ep) if edge >= FR]
        return sum(comb(position, k + 1) for k, position in enumerate(positions))

    def corner_order(self):
        return rank_permutation(self.cp)

    def edge_order(self):
        """The order of the eight top and bottom edges. Only valid in phase two."""
        return rank_permutation(self.ep[:8])

    def slice_order(self):
        """The order of the four middle-layer edges. Only valid in phase two."""
        return rank_permutation(self.ep[8:])


def rank_permutation(items):
    """Give every ordering of a list its own number, starting from 0."""
    rank = 0
    for i, item in enumerate(items):
        smaller_later = sum(other < item for other in items[i + 1:])
        rank = rank * (len(items) - i) + smaller_later
    return rank


def parity(items):
    """Return 0 if a list takes an even number of swaps to sort, otherwise 1."""
    swaps = 0
    for i, item in enumerate(items):
        swaps += sum(other < item for other in items[i + 1:])
    return swaps % 2


# The six quarter turns
BASE_MOVES = {
    "U": Cube([UBR, URF, UFL, ULB, DFR, DLF, DBL, DRB], [0] * 8,
              [UB, UR, UF, UL, DR, DF, DL, DB, FR, FL, BL, BR], [0] * 12),
    "R": Cube([DFR, UFL, ULB, URF, DRB, DLF, DBL, UBR], [2, 0, 0, 1, 1, 0, 0, 2],
              [FR, UF, UL, UB, BR, DF, DL, DB, DR, FL, BL, UR], [0] * 12),
    "F": Cube([UFL, DLF, ULB, UBR, URF, DFR, DBL, DRB], [1, 2, 0, 0, 2, 1, 0, 0],
              [UR, FL, UL, UB, DR, FR, DL, DB, UF, DF, BL, BR],
              [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]),
    "D": Cube([URF, UFL, ULB, UBR, DLF, DBL, DRB, DFR], [0] * 8,
              [UR, UF, UL, UB, DF, DL, DB, DR, FR, FL, BL, BR], [0] * 12),
    "L": Cube([URF, ULB, DBL, UBR, DFR, UFL, DLF, DRB], [0, 1, 2, 0, 0, 2, 1, 0],
              [UR, UF, BL, UB, DR, DF, FL, DB, FR, UL, DL, BR], [0] * 12),
    "B": Cube([URF, UFL, UBR, DRB, DFR, DLF, ULB, DBL], [0, 0, 1, 2, 0, 0, 2, 1],
              [UR, UF, UL, BR, DR, DF, DL, BL, FR, FL, UB, DB],
              [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1]),
}

# All 18 turns, in the order U, U2, U', R, R2, R', and so on
MOVE_NAMES = []
MOVES = []
for face in FACES:
    turned = BASE_MOVES[face]
    for suffix in ("", "2", "'"):
        MOVE_NAMES.append(face + suffix)
        MOVES.append(turned)
        turned = turned.apply(BASE_MOVES[face])


def invert_moves(names):
    """Return the moves that exactly undo a list of moves."""
    opposite = {"": "'", "2": "2", "'": ""}
    return [name[0] + opposite[name[1:]] for name in reversed(names)]


def random_cube():
    """Return a cube picked evenly from every arrangement that can be reached."""
    cp = random.sample(range(8), 8)
    ep = random.sample(range(12), 12)
    if parity(cp) != parity(ep):
        ep[0], ep[1] = ep[1], ep[0]

    co = [random.randrange(3) for _ in range(7)]
    co.append(-sum(co) % 3)
    eo = [random.randrange(2) for _ in range(11)]
    eo.append(sum(eo) % 2)
    return Cube(cp, co, ep, eo)


class InvalidCube(ValueError):
    """The colours don't describe a cube that could be solved."""


def cube_from_stickers(stickers):
    """Build a cube from 54 letters, raising InvalidCube if it can't be solved."""
    if len(stickers) != 54 or any(s not in FACES for s in stickers):
        raise InvalidCube("A cube needs exactly 54 stickers.")
    if any(stickers[i * 9 + 4] != face for i, face in enumerate(FACES)):
        raise InvalidCube("The centre stickers are in the wrong place.")

    cp, co = read_corners(stickers)
    ep, eo = read_edges(stickers)

    pieces_unique = len(set(cp)) == 8 and len(set(ep)) == 12
    if not pieces_unique or sum(co) % 3 or sum(eo) % 2 or parity(cp) != parity(ep):
        raise InvalidCube("A real cube can't get into this state.")
    return Cube(cp, co, ep, eo)


def read_corners(stickers):
    cp, co = [], []
    for position in CORNER_STICKERS:
        colours = "".join(stickers[i] for i in position)
        # The sticker facing up or down tells us how far the corner is twisted
        orientation = next((i for i, c in enumerate(colours) if c in "UD"), None)
        name = colours[orientation:] + colours[:orientation] if orientation is not None else ""
        if name not in CORNER_COLOURS:
            raise InvalidCube("A corner has colours that don't exist.")
        cp.append(CORNER_COLOURS.index(name))
        co.append(orientation)
    return cp, co


def read_edges(stickers):
    ep, eo = [], []
    for first, second in EDGE_STICKERS:
        pair = stickers[first] + stickers[second]
        flipped = pair not in EDGE_COLOURS
        name = pair[::-1] if flipped else pair
        if name not in EDGE_COLOURS:
            raise InvalidCube("An edge has colours that don't exist.")
        ep.append(EDGE_COLOURS.index(name))
        eo.append(int(flipped))
    return ep, eo
