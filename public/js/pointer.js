// Mouse and touch: drag a sticker to turn its layer, or drag anywhere else to look around.
import * as THREE from "three";

const DRAG_THRESHOLD = 7;
const ORBIT_SPEED = 0.006;
const CUBE_RADIUS = 1.5;

const AXIS_NAMES = ["x", "y", "z"];
const UNIT_AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

export function setupPointer(stage, cube, { canTurn, onTurn, onDragStart }) {
  const canvas = stage.canvas;
  const raycaster = new THREE.Raycaster();
  let drag = null;

  function pieceAt(event) {
    const bounds = canvas.getBoundingClientRect();
    const position = new THREE.Vector2(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -(event.clientY - bounds.top) / bounds.height * 2 + 1,
    );
    raycaster.setFromCamera(position, stage.camera);
    const hit = raycaster.intersectObjects(cube.meshes, false)[0];
    if (!hit) return null;

    // The largest coordinate of the point shows which side of the cube was touched
    const point = cube.rig.worldToLocal(hit.point.clone());
    const sizes = point.toArray().map(Math.abs);
    const index = sizes.indexOf(Math.max(...sizes));
    const normal = UNIT_AXES[index].clone().multiplyScalar(Math.sign(point.getComponent(index)));

    return { cubie: hit.object.userData.cubie, point: hit.point.clone(), normal };
  }

  /** Work out which layer a drag means, from its direction on the screen. */
  function chooseLayer(grab, movement) {
    const start = stage.toScreen(grab.point);
    let best = null;

    for (const tangent of UNIT_AXES) {
      if (Math.abs(tangent.dot(grab.normal)) > 0.5) continue;

      const screen = stage.toScreen(grab.point.clone().add(tangent)).sub(start);
      const alignment = movement.dot(screen.clone().normalize());
      if (!best || Math.abs(alignment) > Math.abs(best.alignment)) {
        best = { tangent, screen, alignment };
      }
    }

    // Moving a surface along a tangent means rotating about normal x tangent
    const axisVector = grab.normal.clone().cross(best.tangent);
    const index = axisVector.toArray().findIndex((value) => Math.abs(value) > 0.5);
    const axis = AXIS_NAMES[index];
    return {
      axis,
      layer: Math.round(grab.cubie.position[axis]),
      sign: axisVector.getComponent(index),
      direction: best.screen.clone().normalize(),
      pixelsPerRadian: best.screen.length() * CUBE_RADIUS,
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
    stage.flick(0, 0);

    drag = {
      mode: "pending",
      grab: canTurn() ? pieceAt(event) : null,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityX: 0,
      velocityY: 0,
      angleVelocity: 0,
    };
    if (!drag.grab) drag.mode = "orbit";
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    const seconds = Math.max((event.timeStamp - drag.lastTime) / 1000, 0.001);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;

    const movement = new THREE.Vector2(event.clientX - drag.startX, event.clientY - drag.startY);

    if (drag.mode === "pending" && movement.length() > DRAG_THRESHOLD) {
      const choice = chooseLayer(drag.grab, movement);
      // The middle layers move the centres, which the solver treats as fixed
      if (choice.layer === 0 || !canTurn()) {
        drag.mode = "orbit";
      } else {
        drag.mode = "layer";
        drag.choice = choice;
        cube.beginDrag(choice.axis, choice.layer);
        onDragStart();
      }
    }

    if (drag.mode === "orbit") {
      const scale = ORBIT_SPEED;
      stage.orbit(deltaX * scale, deltaY * scale);
      drag.velocityX = deltaX * scale / seconds;
      drag.velocityY = deltaY * scale / seconds;
    } else if (drag.mode === "layer") {
      const { direction, pixelsPerRadian, sign } = drag.choice;
      const angle = movement.dot(direction) / pixelsPerRadian * sign;
      drag.angleVelocity = (angle - cube.dragLayer.angle) / seconds;
      cube.dragTo(angle);
    }
  });

  async function finishDrag() {
    if (!drag) return;
    const finished = drag;
    drag = null;
    canvas.classList.remove("dragging");

    if (finished.mode === "orbit") {
      stage.flick(finished.velocityX * 0.35, finished.velocityY * 0.35);
    } else if (finished.mode === "layer") {
      const move = await cube.endDrag(finished.angleVelocity);
      onTurn(move);
    }
  }

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
}
