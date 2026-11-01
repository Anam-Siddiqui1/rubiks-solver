// The cube model on screen: 26 pieces that really turn, and everything about moving them.
import * as THREE from "three";
import { RoundedBoxGeometry } from "../vendor/RoundedBoxGeometry.js";

export const COLOURS = {
  U: "#f5f4ef",
  R: "#d4202c",
  F: "#00a650",
  D: "#ffd400",
  L: "#ff6a13",
  B: "#0b57d9",
};

// Which layer each face moves, and which way round "clockwise" is
export const FACE_LAYERS = {
  U: { axis: "y", layer: 1, clockwise: -1 },
  D: { axis: "y", layer: -1, clockwise: 1 },
  R: { axis: "x", layer: 1, clockwise: -1 },
  L: { axis: "x", layer: -1, clockwise: 1 },
  F: { axis: "z", layer: 1, clockwise: -1 },
  B: { axis: "z", layer: -1, clockwise: 1 },
};

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const STICKER_FACES = [
  { letter: "U", normal: new THREE.Vector3(0, 1, 0) },
  { letter: "D", normal: new THREE.Vector3(0, -1, 0) },
  { letter: "R", normal: new THREE.Vector3(1, 0, 0) },
  { letter: "L", normal: new THREE.Vector3(-1, 0, 0) },
  { letter: "F", normal: new THREE.Vector3(0, 0, 1) },
  { letter: "B", normal: new THREE.Vector3(0, 0, -1) },
];

const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const QUARTER = Math.PI / 2;
const HIGHLIGHT_OFFSET = 0.07;
const SPIN_SECONDS = 1.5;

export function invertMove(name) {
  if (name.endsWith("2")) return name;
  return name.endsWith("'") ? name[0] : `${name}'`;
}

function stickerGeometry() {
  const half = 0.405;
  const corner = 0.1;
  const shape = new THREE.Shape();
  shape.moveTo(-half + corner, -half);
  shape.lineTo(half - corner, -half);
  shape.quadraticCurveTo(half, -half, half, -half + corner);
  shape.lineTo(half, half - corner);
  shape.quadraticCurveTo(half, half, half - corner, half);
  shape.lineTo(-half + corner, half);
  shape.quadraticCurveTo(-half, half, -half, half - corner);
  shape.lineTo(-half, -half + corner);
  shape.quadraticCurveTo(-half, -half, -half + corner, -half);

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
    curveSegments: 6,
  });
}

// Moves quickly, then settles slightly past the end and back, like real plastic
function easeTurn(t, overshoot) {
  const smooth = t * t * (3 - 2 * t);
  const back = smooth - 1;
  return 1 + (overshoot + 1) * back ** 3 + overshoot * back ** 2;
}

export class Cube3D {
  constructor(scene) {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.spinner = new THREE.Group();
    this.rig = new THREE.Group();
    this.pivot = new THREE.Group();
    this.spinner.add(this.rig);
    this.rig.add(this.pivot);
    scene.add(this.spinner);

    this.cubies = [];
    this.meshes = [];
    this.buildPieces();

    this.animation = null;
    this.tail = Promise.resolve();
    this.pending = 0;
    this.dragLayer = null;

    this.lean = new THREE.Vector3();
    this.leanVelocity = new THREE.Vector3();
    this.highlighted = null;
    this.spinTime = null;
    this.clock = 0;
  }

  buildPieces() {
    const box = new RoundedBoxGeometry(0.97, 0.97, 0.97, 4, 0.085);
    const sticker = stickerGeometry();
    const plastic = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c0e,
      roughness: 0.42,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
    });
    const materials = {};
    for (const [letter, colour] of Object.entries(COLOURS)) {
      materials[letter] = new THREE.MeshPhysicalMaterial({
        color: colour,
        roughness: 0.5,
        clearcoat: 0.2,
        clearcoatRoughness: 0.35,
      });
    }

    // Fills the gap in the middle, so light never shows through during a turn
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), plastic);
    this.rig.add(core);

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x || y || z) this.addCubie(x, y, z, box, sticker, plastic, materials);
        }
      }
    }
  }

  addCubie(x, y, z, box, stickerShape, plastic, materials) {
    const cubie = new THREE.Group();
    const body = new THREE.Group();
    cubie.position.set(x, y, z);
    cubie.userData = { body, stickers: [] };
    cubie.add(body);

    const shell = new THREE.Mesh(box, plastic);
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.userData.cubie = cubie;
    body.add(shell);
    this.meshes.push(shell);

    for (const { letter, normal } of STICKER_FACES) {
      if (normal.dot(cubie.position) <= 0.5) continue;

      const sticker = new THREE.Mesh(stickerShape, materials[letter]);
      sticker.position.copy(normal).multiplyScalar(0.483);
      sticker.quaternion.setFromUnitVectors(AXES.z, normal);
      sticker.receiveShadow = true;
      sticker.userData = { cubie, letter, normal };
      body.add(sticker);
      cubie.userData.stickers.push(sticker);
      this.meshes.push(sticker);
    }

    this.rig.add(cubie);
    this.cubies.push(cubie);
  }

  get busy() {
    return this.pending > 0 || this.dragLayer !== null;
  }

  /** Add a turn to the queue. The promise resolves when that turn has finished. */
  turn(name, duration = 380) {
    this.pending++;
    this.tail = this.tail.then(() => this.playTurn(name, duration)).then(() => {
      this.pending--;
    });
    return this.tail;
  }

  playTurn(name, duration) {
    const { axis, layer, clockwise } = FACE_LAYERS[name[0]];
    const quarters = name.endsWith("2") ? 2 : name.endsWith("'") ? -1 : 1;
    const angle = clockwise * quarters * QUARTER;
    const time = (quarters === 2 ? duration * 1.35 : duration) / 1000;

    if (document.hidden || this.reducedMotion && duration > 100) {
      this.gatherLayer(axis, layer);
      this.pivot.setRotationFromAxisAngle(AXES[axis], angle);
      this.releaseLayer();
      return Promise.resolve();
    }

    this.gatherLayer(axis, layer);
    this.kick(axis, angle, duration);

    return new Promise((resolve) => {
      this.animation = {
        axis,
        from: 0,
        to: angle,
        elapsed: 0,
        time,
        overshoot: duration >= 200 ? 0.8 : 0,
        resolve,
      };
    });
  }

  /** Move the pieces of one layer on to the pivot, so they rotate together. */
  gatherLayer(axis, layer) {
    this.pivot.quaternion.identity();
    for (const cubie of this.cubies) {
      if (Math.round(cubie.position[axis]) === layer) this.pivot.attach(cubie);
    }
  }

  /** Hand the pieces back to the cube, snapped exactly into their new places. */
  releaseLayer() {
    const matrix = new THREE.Matrix4();
    for (const cubie of [...this.pivot.children]) {
      this.rig.attach(cubie);
      cubie.position.round();
      matrix.makeRotationFromQuaternion(cubie.quaternion);
      matrix.elements.forEach((value, i) => {
        matrix.elements[i] = Math.round(value);
      });
      cubie.quaternion.setFromRotationMatrix(matrix);
    }
    this.pivot.quaternion.identity();
  }

  // Dragging a layer by hand: start it, follow the pointer, then let it settle
  beginDrag(axis, layer) {
    this.dragLayer = { axis, layer, angle: 0 };
    this.gatherLayer(axis, layer);
  }

  dragTo(angle) {
    this.dragLayer.angle = angle;
    this.pivot.setRotationFromAxisAngle(AXES[this.dragLayer.axis], angle);
  }

  /** Settle on the nearest quarter turn. Resolves with the move made, or null. */
  endDrag(velocity) {
    const { axis, layer, angle } = this.dragLayer;
    const flick = Math.abs(velocity) > 2.5 ? Math.sign(velocity) * QUARTER * 0.5 : 0;
    const quarters = Math.round((angle + flick) / QUARTER);
    const distance = Math.abs(quarters * QUARTER - angle);

    return new Promise((resolve) => {
      this.animation = {
        axis,
        from: angle,
        to: quarters * QUARTER,
        elapsed: 0,
        time: Math.max(0.09, 0.26 * distance / QUARTER),
        overshoot: 0.5,
        resolve: () => {
          this.dragLayer = null;
          resolve(this.moveName(axis, layer, quarters));
        },
      };
    });
  }

  moveName(axis, layer, quarters) {
    const face = Object.keys(FACE_LAYERS).find((key) => {
      const entry = FACE_LAYERS[key];
      return entry.axis === axis && entry.layer === layer;
    });
    const turns = ((quarters * FACE_LAYERS[face].clockwise) % 4 + 4) % 4;
    return { 0: null, 1: face, 2: `${face}2`, 3: `${face}'` }[turns];
  }

  // Turning one layer pushes the rest of the cube a little the other way
  kick(axis, angle, duration) {
    if (this.reducedMotion || duration < 90) return;
    const strength = Math.min(1, duration / 300) * 0.5;
    this.leanVelocity.addScaledVector(AXES[axis], -Math.sign(angle) * strength);
  }

  highlight(face) {
    this.highlighted = face;
  }

  /** The cube's reward for being solved: one slow turn in the air. */
  celebrate() {
    if (!this.reducedMotion) this.spinTime = 0;
  }

  update(seconds) {
    this.clock += seconds;

    if (this.animation) this.updateTurn(seconds);

    // The lean behaves like a spring, returning to rest after each turn
    const force = this.lean.clone().multiplyScalar(-110).addScaledVector(this.leanVelocity, -11);
    this.leanVelocity.addScaledVector(force, seconds);
    this.lean.addScaledVector(this.leanVelocity, seconds);
    this.rig.rotation.set(this.lean.x, this.lean.y, this.lean.z);

    const bob = this.reducedMotion ? 0 : Math.sin(this.clock * 0.9) * 0.05;
    this.spinner.position.y = bob;
    this.updateSpin(seconds);
    this.updateHighlight(seconds);
  }

  updateTurn(seconds) {
    const animation = this.animation;
    animation.elapsed += seconds;
    const t = Math.min(1, animation.elapsed / animation.time);
    const amount = easeTurn(t, animation.overshoot);
    const angle = animation.from + (animation.to - animation.from) * amount;
    this.pivot.setRotationFromAxisAngle(AXES[animation.axis], angle);

    if (t === 1) {
      this.animation = null;
      this.releaseLayer();
      animation.resolve();
    }
  }

  updateSpin(seconds) {
    if (this.spinTime === null) return;
    this.spinTime += seconds;
    const t = Math.min(1, this.spinTime / SPIN_SECONDS);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    this.spinner.rotation.y = eased * Math.PI * 2;
    this.spinner.position.y += Math.sin(t * Math.PI) * 0.3;

    if (t === 1) {
      this.spinner.rotation.y = 0;
      this.spinTime = null;
    }
  }

  // Slide the highlighted layer outwards, so you can see what a button will turn
  updateHighlight(seconds) {
    const face = this.highlighted && FACE_LAYERS[this.highlighted];
    const blend = 1 - Math.exp(-16 * seconds);
    const offset = new THREE.Vector3();
    const inverse = new THREE.Quaternion();

    for (const cubie of this.cubies) {
      offset.set(0, 0, 0);
      if (face && Math.round(cubie.position[face.axis]) === face.layer) {
        offset.copy(AXES[face.axis]).multiplyScalar(face.layer * HIGHLIGHT_OFFSET);
      }
      if (cubie.parent === this.rig) {
        offset.applyQuaternion(inverse.copy(cubie.quaternion).invert());
      } else {
        offset.set(0, 0, 0);
      }
      cubie.userData.body.position.lerp(offset, blend);
    }
  }

  /** Read the cube as 54 letters, in the order the Python solver expects. */
  stickers() {
    const result = new Array(54);
    const normal = new THREE.Vector3();

    for (const cubie of this.cubies) {
      const x = Math.round(cubie.position.x);
      const y = Math.round(cubie.position.y);
      const z = Math.round(cubie.position.z);

      for (const sticker of cubie.userData.stickers) {
        normal.copy(sticker.userData.normal).applyQuaternion(cubie.quaternion).round();
        result[stickerIndex(normal, x, y, z)] = sticker.userData.letter;
      }
    }
    return result.join("");
  }

  isSolved() {
    return this.stickers() === SOLVED;
  }
}

function stickerIndex(normal, x, y, z) {
  if (normal.y === 1) return (z + 1) * 3 + (x + 1);
  if (normal.x === 1) return 9 + (1 - y) * 3 + (1 - z);
  if (normal.z === 1) return 18 + (1 - y) * 3 + (x + 1);
  if (normal.y === -1) return 27 + (1 - z) * 3 + (x + 1);
  if (normal.x === -1) return 36 + (1 - y) * 3 + (z + 1);
  return 45 + (1 - y) * 3 + (1 - x);
}
