// The 3D scene: renderer, lights, the floor shadow and the orbiting camera.
import * as THREE from "three";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js";

const FIELD_OF_VIEW = 30;
const MIN_ELEVATION = -1.35;
const MAX_ELEVATION = 1.35;

export class Stage {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.28;

    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 100);
    this.azimuth = 0.62;
    this.elevation = 0.48;
    this.distance = 16;
    this.spin = { azimuth: 0, elevation: 0 };

    this.addLights();
    this.addFloor();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  addLights() {
    const key = new THREE.SpotLight(0xfff4e6, 170, 0, 0.42, 0.9, 2);
    key.position.set(4.5, 10, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 7;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 1.5);
    fill.position.set(7, 1, 3);
    this.scene.add(fill);

    const soft = new THREE.DirectionalLight(0xffffff, 0.9);
    soft.position.set(-4, 2, 7);
    this.scene.add(soft);

    const under = new THREE.DirectionalLight(0xffffff, 1.6);
    under.position.set(1, -8, 2);
    this.scene.add(under);

    const rim = new THREE.DirectionalLight(0xbcd0ff, 1.3);
    rim.position.set(-6, 3, -7);
    this.scene.add(rim);
  }

  addFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.6 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the whole cube in view, however narrow the window gets
    this.distance = Math.max(16, 13 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  orbit(deltaX, deltaY) {
    this.azimuth -= deltaX;
    this.elevation = THREE.MathUtils.clamp(this.elevation + deltaY, MIN_ELEVATION, MAX_ELEVATION);
  }

  /** Keep the view gliding for a moment after the pointer lets go. */
  flick(deltaX, deltaY) {
    this.spin.azimuth = deltaX;
    this.spin.elevation = deltaY;
  }

  update(seconds) {
    this.orbit(this.spin.azimuth * seconds, this.spin.elevation * seconds);
    const damping = Math.exp(-4 * seconds);
    this.spin.azimuth *= damping;
    this.spin.elevation *= damping;

    const flat = Math.cos(this.elevation) * this.distance;
    this.camera.position.set(
      Math.sin(this.azimuth) * flat,
      Math.sin(this.elevation) * this.distance,
      Math.cos(this.azimuth) * flat,
    );
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Convert a point in the scene to pixels on the canvas. */
  toScreen(point) {
    const projected = point.clone().project(this.camera);
    return new THREE.Vector2(
      (projected.x + 1) / 2 * this.canvas.clientWidth,
      (1 - projected.y) / 2 * this.canvas.clientHeight,
    );
  }
}
