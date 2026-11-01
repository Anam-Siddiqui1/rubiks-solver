// Connects the cube, the buttons and the Flask solver.
import { COLOURS, Cube3D, FACE_LAYERS, invertMove } from "./cube3d.js";
import { setupPointer } from "./pointer.js";
import { Stage } from "./stage.js";

const SPEEDS = { slow: 700, normal: 380, fast: 170 };
const SCRAMBLE_SPEED = 95;
const FACES = ["U", "R", "F", "D", "L", "B"];

const element = (id) => document.getElementById(id);
const bigNumber = element("big-number");
const statusText = element("status");
const solveButton = element("solve");
const scrambleButton = element("scramble");
const undoButton = element("undo");
const resetButton = element("reset");
const playerPanel = element("player");
const tokensBox = element("tokens");
const playButton = element("play");
const stepBackButton = element("step-back");
const stepForwardButton = element("step-forward");
const scrubber = element("scrubber");
const speedButtons = document.querySelectorAll(".speed");

const stage = new Stage(element("canvas"), element("viewport"));
const cube = new Cube3D(stage.scene);

const game = {
  task: null, // "scrambling", "searching" or "resetting" while one of those is running
  history: [], // every move since the cube was last solved, so it can be undone
  manualMoves: 0,
  solution: null,
  splitAt: 0,
  position: 0,
  target: 0,
  direction: 0,
  speed: "normal",
};

function setStatus(text) {
  statusText.textContent = text;
}

function setBigNumber(value, live = true) {
  bigNumber.textContent = value;
  bigNumber.classList.toggle("live", live);
}

function isPlaying() {
  return game.solution !== null && game.direction !== 0;
}

// Face turns can queue up while typing, but the app is otherwise busy
function isBusy() {
  return game.task !== null || isPlaying() || cube.dragLayer !== null;
}

// Anything that reads the cube has to wait until no turn is in progress
function isLocked() {
  return isBusy() || cube.pending > 0;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Everything on the page that depends on the current state
function render() {
  const locked = isLocked();
  solveButton.disabled = locked || cube.isSolved();
  scrambleButton.disabled = locked;
  undoButton.disabled = locked || game.history.length === 0;
  resetButton.disabled = locked || game.history.length === 0;
  document.querySelectorAll(".turn").forEach((button) => {
    button.disabled = isBusy();
  });

  playerPanel.hidden = game.solution === null;
  if (!game.solution) return;

  const total = game.solution.length;
  const playing = isPlaying() && game.target === total;
  playButton.classList.toggle("playing", playing);
  playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  stepBackButton.disabled = game.position === 0;
  stepForwardButton.disabled = game.position === total;
  scrubber.value = game.position;
  scrubber.style.setProperty("--progress", `${(game.position / total) * 100}%`);

  tokensBox.querySelectorAll(".token").forEach((token, i) => {
    token.classList.toggle("played", i < game.position);
    token.setAttribute("aria-current", String(i === game.position));
  });
  const current = tokensBox.querySelector('[aria-current="true"]');
  if (current) {
    const left = current.offsetLeft - (tokensBox.clientWidth - current.offsetWidth) / 2;
    tokensBox.scrollTo({ left, behavior: "smooth" });
  }
}

function clearSolution() {
  if (game.solution && cube.isSolved()) game.history = [];
  game.solution = null;
  game.position = game.target = game.direction = 0;
}

function checkSolvedByHand() {
  if (cube.pending > 0 || game.task || game.solution) return;
  if (cube.isSolved() && game.history.length > 0) {
    cube.celebrate();
    setStatus(`Solved, in ${plural(game.manualMoves, "move")}.`);
    setBigNumber(0);
    game.history = [];
    game.manualMoves = 0;
  }
  render();
}

function recordManualMove(name) {
  clearSolution();
  game.history.push(name);
  game.manualMoves++;
  setBigNumber(game.manualMoves);
  setStatus(`You've made ${plural(game.manualMoves, "move")}.`);
}

function turnByHand(name) {
  if (isBusy()) return;
  recordManualMove(name);
  // Fast typing shouldn't leave the cube lagging behind
  const duration = cube.pending > 0 ? SPEEDS.fast : SPEEDS.normal;
  cube.turn(name, duration).then(checkSolvedByHand);
  render();
}

function undo() {
  if (isLocked() || game.history.length === 0) return;
  clearSolution();
  const name = game.history.pop();
  if (!name) return;
  game.manualMoves = Math.max(0, game.manualMoves - 1);
  setBigNumber(game.manualMoves);
  setStatus("Took that move back.");
  cube.turn(invertMove(name), SPEEDS.normal).then(checkSolvedByHand);
  render();
}

async function scramble() {
  if (isLocked()) return;
  clearSolution();
  game.task = "scrambling";
  setStatus("Picking a random position.");
  render();

  try {
    const response = await fetch("/api/scramble", { method: "POST" });
    if (!response.ok) throw new Error();
    const { moves } = await response.json();

    let count = 0;
    setStatus("Scrambling.");
    for (const name of moves) {
      game.history.push(name);
      await cube.turn(name, SCRAMBLE_SPEED);
      count++;
      setBigNumber(count);
    }
    game.manualMoves = 0;
    setStatus("Scrambled. That's one random position out of 43 quintillion.");
  } catch {
    setStatus("Couldn't reach the server. Check that Flask is running, then try again.");
  }

  game.task = null;
  render();
}

async function solve() {
  if (isLocked() || cube.isSolved()) return;
  game.task = "searching";
  setStatus("Searching for a short solution.");
  render();

  try {
    const response = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stickers: cube.stickers() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    game.task = null;
    loadSolution(result);
    playTo(game.solution.length);
  } catch (error) {
    game.task = null;
    setStatus(error.message || "Couldn't reach the server. Check that Flask is running, then try again.");
    render();
  }
}

function loadSolution({ phase_one: phaseOne, phase_two: phaseTwo }) {
  game.solution = [...phaseOne, ...phaseTwo];
  game.splitAt = phaseOne.length;
  game.position = game.target = 0;

  scrubber.max = game.solution.length;
  tokensBox.replaceChildren(
    buildPhase("Phase one: line everything up", phaseOne, 0),
    buildPhase("Phase two: finish the solve", phaseTwo, phaseOne.length),
  );
  setBigNumber(game.solution.length);
  setStatus(`Found a solution in ${plural(game.solution.length, "move")}.`);
}

function buildPhase(label, moves, firstIndex) {
  const phase = document.createElement("div");
  phase.className = "phase";
  phase.hidden = moves.length === 0;

  const heading = document.createElement("span");
  heading.className = "phase-label";
  heading.textContent = label;

  const row = document.createElement("div");
  row.className = "phase-moves";
  moves.forEach((name, i) => {
    const token = document.createElement("button");
    token.className = "token";
    token.textContent = name;
    token.setAttribute("aria-label", `Go to move ${firstIndex + i + 1}, ${name}`);
    token.addEventListener("click", () => playTo(firstIndex + i));
    row.append(token);
  });

  phase.append(heading, row);
  return phase;
}

function describePosition() {
  const remaining = game.solution.length - game.position;
  setBigNumber(remaining);

  if (remaining === 0) return;
  if (game.position < game.splitAt) {
    setStatus(`Phase one: making every piece face the right way. ${plural(remaining, "move")} left.`);
  } else {
    setStatus(`Phase two: finishing with moves that keep the pieces lined up. ${plural(remaining, "move")} left.`);
  }
}

// Plays moves until the cube reaches the target. Changing the target redirects it
async function playTo(target) {
  game.target = Math.max(0, Math.min(target, game.solution.length));
  if (game.direction !== 0) {
    render();
    return;
  }

  const startedAt = game.position;
  while (game.solution && game.position !== game.target) {
    const forward = game.target > game.position;
    game.direction = forward ? 1 : -1;
    render();
    describePosition();

    const index = forward ? game.position : game.position - 1;
    const name = game.solution[index];
    const distance = Math.abs(game.target - game.position);
    // Big jumps along the timeline run quickly, single steps at the chosen speed
    const isJump = distance > 1 && game.target !== game.solution.length;
    const duration = isJump ? SPEEDS.fast : SPEEDS[game.speed];

    if (forward) game.history.push(name);
    else game.history.pop();

    await cube.turn(forward ? name : invertMove(name), duration);
    game.position += game.direction;
    game.direction = 0;
  }

  describePosition();
  if (game.position === game.solution.length && startedAt !== game.position) {
    cube.celebrate();
    setStatus(`Solved, in ${plural(game.solution.length, "move")}.`);
  }
  render();
}

function togglePlay() {
  if (!game.solution) return;
  if (isPlaying() && game.target === game.solution.length) {
    // Stop after the move that's in progress
    game.target = game.position + game.direction;
    render();
    return;
  }
  const atEnd = game.position === game.solution.length;
  if (atEnd) return;
  playTo(game.solution.length);
}

async function reset() {
  if (isLocked() || game.history.length === 0) return;
  clearSolution();
  game.task = "resetting";
  setStatus("Winding back.");
  render();

  const moves = [...game.history].reverse();
  const duration = Math.max(45, Math.min(120, 2600 / moves.length));
  for (const name of moves) {
    await cube.turn(invertMove(name), duration);
    game.history.pop();
    setBigNumber(game.history.length);
  }

  game.manualMoves = 0;
  game.task = null;
  setBigNumber(20, false);
  setStatus("Back to solved. Scramble it, then watch it solve itself.");
  render();
}

function buildPad() {
  const pad = element("pad");
  for (const face of FACES) {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = COLOURS[face];
    pad.append(swatch);

    for (const suffix of ["", "'", "2"]) {
      const name = face + suffix;
      const button = document.createElement("button");
      button.className = "turn";
      button.textContent = name;
      button.setAttribute("aria-label", `Turn ${name}`);
      button.addEventListener("click", () => turnByHand(name));
      button.addEventListener("pointerenter", () => cube.highlight(face));
      button.addEventListener("pointerleave", () => cube.highlight(null));
      button.addEventListener("focus", () => cube.highlight(face));
      button.addEventListener("blur", () => cube.highlight(null));
      pad.append(button);
    }
  }
}

function handleKey(event) {
  if (event.ctrlKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;

  const key = event.key.toUpperCase();
  if (FACE_LAYERS[key]) {
    turnByHand(event.shiftKey ? `${key}'` : key);
  } else if (event.key === "Enter" && event.target === document.body) {
    solve();
  } else if (event.key === " " && game.solution && event.target.tagName !== "BUTTON") {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "ArrowLeft" && game.solution) {
    playTo(game.position - 1);
  } else if (event.key === "ArrowRight" && game.solution) {
    playTo(game.position + 1);
  }
}

buildPad();

solveButton.addEventListener("click", solve);
scrambleButton.addEventListener("click", scramble);
undoButton.addEventListener("click", undo);
resetButton.addEventListener("click", reset);
playButton.addEventListener("click", togglePlay);
stepBackButton.addEventListener("click", () => playTo(game.position - 1));
stepForwardButton.addEventListener("click", () => playTo(game.position + 1));
scrubber.addEventListener("input", () => playTo(Number(scrubber.value)));
window.addEventListener("keydown", handleKey);

speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    game.speed = button.dataset.speed;
    speedButtons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
  });
});

setupPointer(stage, cube, {
  canTurn: () => !isLocked() && !cube.busy,
  onDragStart: () => render(),
  onTurn: (name) => {
    if (name) recordManualMove(name);
    checkSolvedByHand();
  },
});

let lastFrame = performance.now();
function frame(now) {
  // Long pauses, like a hidden tab, shouldn't make animations jump
  const seconds = Math.min((now - lastFrame) / 1000, 0.2);
  lastFrame = now;
  cube.update(seconds);
  stage.update(seconds);
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);
