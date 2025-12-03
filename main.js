const SPEED_OF_SOUND = 343;
const FREQ_MIN = 20;
const FREQ_MAX = 200;
const MODE_WEIGHTS = {
  axial: 1.0,
  tangential: 0.65,
  oblique: 0.4,
};

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(16).slice(2, 10)}`;
}

const state = {
  room: {
    type: "rect",
    lengthA: 6,
    widthA: 4.5,
    height: 2.6,
    lengthB: 3,
    widthB: 2.5,
    orientation: "x",
  },
  listener: {
    x: 3,
    y: 2.25,
    z: 1.2,
  },
  subwoofers: [],
  heatmap: {
    resolution: 60,
    data: null,
    min: 0,
    max: 0,
  },
  modes: [],
  frequencyResponse: [],
  updateScheduled: false,
  topView: {
    canvas: null,
    ctx: null,
    width: 800,
    height: 600,
    scale: 80,
    panX: 50,
    panY: 50,
    pointerState: {
      primaryId: null,
      secondaryId: null,
      positions: new Map(),
      draggingSubId: null,
      draggingCanvas: false,
      lastPan: { x: 0, y: 0 },
      listenerSetOnRelease: false,
      lastPinchDistance: null,
      lastPinchCenter: null,
    },
  },
  three: {
    initialized: false,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    container: null,
    floorGroup: null,
    subGroup: null,
    listenerMarker: null,
    animationHandle: null,
  },
  dom: {},
};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  initializeTopView();
  initializeThree();
  initializePlots();
  bindEvents();
  ensureDefaultSubwoofers();
  scheduleRecompute();
});

function cacheDom() {
  state.dom = {
    form: document.getElementById("room-form"),
    toggleLShape: document.getElementById("toggle-l-shape"),
    segmentBFieldset: document.getElementById("segment-b-fieldset"),
    lengthA: document.getElementById("length-a"),
    widthA: document.getElementById("width-a"),
    height: document.getElementById("height"),
    lengthB: document.getElementById("length-b"),
    widthB: document.getElementById("width-b"),
    orientation: document.getElementById("orientation"),
    listenerHeight: document.getElementById("listener-height"),
    addSubwoofer: document.getElementById("add-subwoofer"),
    subwooferList: document.getElementById("subwoofer-list"),
    exportPdf: document.getElementById("export-pdf"),
    heatmapResolution: document.getElementById("heatmap-resolution"),
    resetTopView: document.getElementById("reset-topview"),
    statusIndicator: document.getElementById("status-indicator"),
    topCanvas: document.getElementById("top-view-canvas"),
    heatmapCanvas: document.getElementById("heatmap-canvas"),
    frequencyChart: document.getElementById("frequency-chart"),
    modeDistribution: document.getElementById("mode-distribution"),
    threeContainer: document.getElementById("three-container"),
  };
}

function bindEvents() {
  const inputIds = [
    "length-a",
    "width-a",
    "height",
    "length-b",
    "width-b",
    "orientation",
    "listener-height",
  ];
  for (const id of inputIds) {
    const el = state.dom[id.replace("-", "")] || document.getElementById(id);
    el.addEventListener("input", () => {
      readFormInputs();
      scheduleRecompute();
    });
  }

  state.dom.toggleLShape.addEventListener("change", () => {
    state.room.type = state.dom.toggleLShape.checked ? "lshape" : "rect";
    state.dom.segmentBFieldset.classList.toggle("hidden", state.room.type !== "lshape");
    scheduleRecompute();
  });

  state.dom.heatmapResolution.addEventListener("change", () => {
    state.heatmap.resolution = parseInt(state.dom.heatmapResolution.value, 10);
    scheduleRecompute();
  });

  state.dom.addSubwoofer.addEventListener("click", () => {
    addSubwoofer();
  });

  state.dom.exportPdf.addEventListener("click", () => {
    exportPdfReport();
  });

  state.dom.resetTopView.addEventListener("click", () => {
    autoScaleTopView();
    renderTopView();
  });

  window.addEventListener("resize", () => {
    resizeCanvases();
    resizeThree();
    renderTopView();
  });
}

function readFormInputs() {
  const parse = (value, fallback, min) => {
    const val = parseFloat(String(value).replace(",", "."));
    if (Number.isFinite(val) && (!min || val >= min)) {
      return val;
    }
    return fallback;
  };
  state.room.lengthA = parse(state.dom.lengthA.value, state.room.lengthA, 1);
  state.room.widthA = parse(state.dom.widthA.value, state.room.widthA, 1);
  state.room.height = parse(state.dom.height.value, state.room.height, 2);
  state.room.lengthB = parse(state.dom.lengthB.value, state.room.lengthB, 0.5);
  state.room.widthB = parse(state.dom.widthB.value, state.room.widthB, 0.5);
  state.room.orientation = state.dom.orientation.value;
  state.listener.z = parse(state.dom.listenerHeight.value, state.listener.z, 0.8);
}

function ensureDefaultSubwoofers() {
  if (state.subwoofers.length === 0) {
    const segments = getSegments();
    if (segments.length > 0) {
      const seg = segments[0];
      const defaults = [
        { x: seg.origin.x + seg.length * 0.2, y: seg.origin.y + seg.width * 0.2 },
        { x: seg.origin.x + seg.length * 0.8, y: seg.origin.y + seg.width * 0.2 },
      ];
      defaults.forEach((pos) => {
        state.subwoofers.push({
          id: generateId(),
          x: pos.x,
          y: pos.y,
        });
      });
      updateSubwooferList();
    }
  }
}

function scheduleRecompute() {
  if (!state.updateScheduled) {
    state.updateScheduled = true;
    window.requestAnimationFrame(() => {
      state.updateScheduled = false;
      recomputeAndRender();
    });
  }
}

function recomputeAndRender() {
  updateStatus("Berechne …", "processing");
  readFormInputs();
  const segments = getSegments();
  clampListenerToRoom(segments);
  clampSubwoofers(segments);
  autoScaleTopView();
  computeModes(segments);
  computeHeatmap(segments);
  computeFrequencyResponse();
  updateSubwooferList();
  renderTopView();
  renderHeatmap();
  renderFrequencyChart();
  renderModeDistribution();
  updateThreeScene();
  updateStatus("Bereit", "ready");
}

function updateStatus(message, type = "ready") {
  const indicator = state.dom.statusIndicator;
  indicator.textContent = message;
  if (type === "processing") {
    indicator.style.color = "#b45309";
  } else if (type === "error") {
    indicator.style.color = "#b91c1c";
  } else {
    indicator.style.color = "#0f766e";
  }
}

function getSegments() {
  const { room } = state;
  const segments = [
    {
      id: "A",
      length: room.lengthA,
      width: room.widthA,
      height: room.height,
      origin: { x: 0, y: 0 },
    },
  ];
  if (room.type === "lshape") {
    const segB = {
      id: "B",
      length: room.lengthB,
      width: room.widthB,
      height: room.height,
      origin: { x: 0, y: 0 },
    };
    if (room.orientation === "x") {
      segB.origin.x = room.lengthA;
      segB.origin.y = 0;
    } else {
      segB.origin.x = 0;
      segB.origin.y = room.widthA;
    }
    segments.push(segB);
  }
  return segments;
}

function clampListenerToRoom(segments) {
  if (!pointInsideRoom(state.listener.x, state.listener.y, segments)) {
    const clamped = clampPointToRoom(state.listener.x ?? 0, state.listener.y ?? 0, segments);
    state.listener.x = clamped.x;
    state.listener.y = clamped.y;
  }
  if (state.listener.x == null || Number.isNaN(state.listener.x)) {
    const seg = segments[0];
    state.listener.x = seg.origin.x + seg.length / 2;
    state.listener.y = seg.origin.y + seg.width / 2;
  }
}

function clampSubwoofers(segments) {
  state.subwoofers = state.subwoofers.map((sub) => {
    if (!pointInsideRoom(sub.x, sub.y, segments)) {
      const clamped = clampPointToRoom(sub.x, sub.y, segments);
      return { ...sub, ...clamped };
    }
    return sub;
  });
}

function pointInsideRoom(x, y, segments) {
  if (x == null || y == null) return false;
  return segments.some((seg) => x >= seg.origin.x && x <= seg.origin.x + seg.length && y >= seg.origin.y && y <= seg.origin.y + seg.width);
}

function clampPointToRoom(x, y, segments) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const seg of segments) {
    const cx = clamp(x, seg.origin.x, seg.origin.x + seg.length);
    const cy = clamp(y, seg.origin.y, seg.origin.y + seg.width);
    const dist = (cx - x) ** 2 + (cy - y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: cx, y: cy, segment: seg.id };
    }
  }
  return best || { x, y };
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function computeModes(segments) {
  const modes = [];
  for (const segment of segments) {
    const { length, width, height, id } = segment;
    const nMaxX = Math.max(1, Math.ceil(((2 * FREQ_MAX) / SPEED_OF_SOUND) * length));
    const nMaxY = Math.max(1, Math.ceil(((2 * FREQ_MAX) / SPEED_OF_SOUND) * width));
    const nMaxZ = Math.max(1, Math.ceil(((2 * FREQ_MAX) / SPEED_OF_SOUND) * height));
    for (let nx = 0; nx <= nMaxX; nx += 1) {
      for (let ny = 0; ny <= nMaxY; ny += 1) {
        for (let nz = 0; nz <= nMaxZ; nz += 1) {
          if (nx === 0 && ny === 0 && nz === 0) continue;
          const type = classifyMode(nx, ny, nz);
          const freq = (SPEED_OF_SOUND / 2) * Math.sqrt(
            (nx / length) ** 2 +
              (ny / width) ** 2 +
              (nz / height) ** 2,
          );
          if (freq < FREQ_MIN - 1) continue;
          if (freq > FREQ_MAX + 10) continue;
          modes.push({
            segmentId: id,
            nx,
            ny,
            nz,
            frequency: freq,
            type,
            weight: MODE_WEIGHTS[type],
            dimensions: { length, width, height },
            origin: { ...segment.origin },
          });
        }
      }
    }
  }
  modes.sort((a, b) => a.frequency - b.frequency);
  state.modes = modes;
}

function classifyMode(nx, ny, nz) {
  const nonZero = [nx, ny, nz].filter((n) => n !== 0).length;
  if (nonZero === 1) return "axial";
  if (nonZero === 2) return "tangential";
  return "oblique";
}

function computeHeatmap(segments) {
  const resolution = state.heatmap.resolution;
  const { canvas } = state.topView;
  const bounds = getRoomBounds(segments);
  const dx = (bounds.maxX - bounds.minX) / resolution;
  const dy = (bounds.maxY - bounds.minY) / resolution;
  const values = new Float32Array(resolution * resolution);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let iy = 0; iy < resolution; iy += 1) {
    for (let ix = 0; ix < resolution; ix += 1) {
      const x = bounds.minX + ix * dx + dx / 2;
      const y = bounds.minY + iy * dy + dy / 2;
      let value = Number.NaN;
      if (pointInsideRoom(x, y, segments)) {
        value = evaluatePressureAtPoint({ x, y }, state.listener.z, segments);
        if (Number.isFinite(value)) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      values[iy * resolution + ix] = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-6) {
    min = -1;
    max = 1;
  }
  state.heatmap = {
    resolution,
    data: values,
    min,
    max,
    bounds,
  };
}

function evaluatePressureAtPoint(point, z, segments) {
  let sum = 0;
  for (const mode of state.modes) {
    const dims = mode.dimensions;
    const origin = mode.origin;
    const contains = pointInsideSegment2D(point, { origin, dimensions: dims });
    const weightModifier = contains ? 1 : 0.3;
    if (dims.length <= 0 || dims.width <= 0 || dims.height <= 0) continue;
    const xn = mode.nx === 0 ? 1 : Math.cos((mode.nx * Math.PI * (point.x - origin.x)) / dims.length);
    const yn = mode.ny === 0 ? 1 : Math.cos((mode.ny * Math.PI * (point.y - origin.y)) / dims.width);
    const zn = mode.nz === 0 ? 1 : Math.cos((mode.nz * Math.PI * z) / dims.height);
    const amplitude = mode.weight * weightModifier * xn * yn * zn;
    const damping = 1 / (1 + (mode.frequency / 40));
    sum += amplitude * damping;
  }
  return sum;
}

function computeFrequencyResponse() {
  const response = [];
  const resolution = 181;
  const listenerPoint = { x: state.listener.x, y: state.listener.y };
  for (let i = 0; i < resolution; i += 1) {
    const freq = FREQ_MIN + (i * (FREQ_MAX - FREQ_MIN)) / (resolution - 1);
    let real = 0;
    let imag = 0;
    for (const mode of state.modes) {
      const dims = mode.dimensions;
      const origin = mode.origin;
      const contains = pointInsideSegment2D(listenerPoint, { origin, dimensions: dims });
      const weightModifier = contains ? 1 : 0.35;
      const xn = mode.nx === 0 ? 1 : Math.cos((mode.nx * Math.PI * (listenerPoint.x - origin.x)) / dims.length);
      const yn = mode.ny === 0 ? 1 : Math.cos((mode.ny * Math.PI * (listenerPoint.y - origin.y)) / dims.width);
      const zn = mode.nz === 0 ? 1 : Math.cos((mode.nz * Math.PI * state.listener.z) / dims.height);
      const spatial = xn * yn * zn;
      const modeWeight = mode.weight * weightModifier * spatial;
      const delta = freq - mode.frequency;
      const bandwidth = 4;
      const denom = delta ** 2 + bandwidth ** 2;
      real += modeWeight * bandwidth / denom;
      imag += modeWeight * delta / denom;
    }
    const magnitude = Math.sqrt(real ** 2 + imag ** 2);
    const db = 20 * Math.log10(Math.max(magnitude, 1e-4));
    response.push({ freq, db });
  }
  state.frequencyResponse = response;
}

function initializeTopView() {
  const canvas = state.dom.topCanvas;
  const ctx = canvas.getContext("2d");
  state.topView.canvas = canvas;
  state.topView.ctx = ctx;
  resizeCanvases();
  attachTopViewInteractions();
}

function resizeCanvases() {
  const dpi = window.devicePixelRatio || 1;
  const topCanvas = state.topView.canvas;
  const rect = topCanvas.getBoundingClientRect();
  topCanvas.width = Math.round(rect.width * dpi);
  topCanvas.height = Math.round(rect.height * dpi);
  state.topView.width = topCanvas.width;
  state.topView.height = topCanvas.height;
  const heatmapCanvas = state.dom.heatmapCanvas;
  const heatmapRect = heatmapCanvas.getBoundingClientRect();
  heatmapCanvas.width = Math.round(heatmapRect.width * dpi);
  heatmapCanvas.height = Math.round(heatmapRect.height * dpi);
}

function attachTopViewInteractions() {
  const canvas = state.topView.canvas;
  canvas.addEventListener("pointerdown", onTopViewPointerDown);
  canvas.addEventListener("pointermove", onTopViewPointerMove);
  canvas.addEventListener("pointerup", onTopViewPointerUpCancel);
  canvas.addEventListener("pointercancel", onTopViewPointerUpCancel);
  canvas.addEventListener("pointerleave", onTopViewPointerUpCancel);
  canvas.addEventListener("wheel", onTopViewWheel, { passive: false });
}

function onTopViewPointerDown(event) {
  const canvas = state.topView.canvas;
  canvas.setPointerCapture(event.pointerId);
  state.topView.pointerState.positions.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.topView.pointerState.primaryId == null) {
    state.topView.pointerState.primaryId = event.pointerId;
  } else if (state.topView.pointerState.secondaryId == null && event.pointerId !== state.topView.pointerState.primaryId) {
    state.topView.pointerState.secondaryId = event.pointerId;
    const pointers = Array.from(state.topView.pointerState.positions.values());
    if (pointers.length === 2) {
      const distance = distanceBetweenPoints(pointers[0], pointers[1]);
      state.topView.pointerState.lastPinchDistance = distance;
      state.topView.pointerState.lastPinchCenter = midpoint(pointers[0], pointers[1]);
    }
  }
  const world = canvasToWorld(event.clientX, event.clientY);
  const hitSub = hitTestSubwoofer(world.x, world.y);
  if (hitSub) {
    state.topView.pointerState.draggingSubId = hitSub.id;
    state.topView.pointerState.listenerSetOnRelease = false;
  } else if (!state.topView.pointerState.draggingCanvas && state.topView.pointerState.positions.size === 1) {
    state.topView.pointerState.draggingCanvas = true;
    state.topView.pointerState.lastPan = { x: event.clientX, y: event.clientY };
    state.topView.pointerState.listenerSetOnRelease = true;
  }
}

function onTopViewPointerMove(event) {
  if (!state.topView.pointerState.positions.has(event.pointerId)) return;
  const pointerState = state.topView.pointerState;
  pointerState.positions.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointerState.draggingSubId) {
    const world = canvasToWorld(event.clientX, event.clientY);
    const segments = getSegments();
    const clamped = clampPointToRoom(world.x, world.y, segments);
    const idx = state.subwoofers.findIndex((s) => s.id === pointerState.draggingSubId);
    if (idx >= 0) {
      state.subwoofers[idx].x = clamped.x;
      state.subwoofers[idx].y = clamped.y;
      updateSubwooferList();
      renderTopView();
      scheduleRecompute();
    }
    return;
  }

  if (pointerState.positions.size >= 2) {
    const dpi = window.devicePixelRatio || 1;
    const pointers = Array.from(pointerState.positions.values());
    const center = midpoint(pointers[0], pointers[1]);
    const distance = distanceBetweenPoints(pointers[0], pointers[1]);
    if (pointerState.lastPinchDistance && pointerState.lastPinchDistance > 0 && distance > 0) {
      const scaleFactor = distance / pointerState.lastPinchDistance;
      applyZoom(scaleFactor, center);
    }
    if (pointerState.lastPinchCenter) {
      state.topView.panX += (center.x - pointerState.lastPinchCenter.x) * dpi;
      state.topView.panY += (center.y - pointerState.lastPinchCenter.y) * dpi;
    }
    pointerState.lastPinchDistance = distance;
    pointerState.lastPinchCenter = center;
    pointerState.draggingCanvas = true;
    renderTopView();
  } else if (pointerState.draggingCanvas) {
    const dx = (event.clientX - pointerState.lastPan.x) * (window.devicePixelRatio || 1);
    const dy = (event.clientY - pointerState.lastPan.y) * (window.devicePixelRatio || 1);
    pointerState.lastPan = { x: event.clientX, y: event.clientY };
    state.topView.panX += dx;
    state.topView.panY += dy;
    renderTopView();
  }
}

function onTopViewPointerUpCancel(event) {
  const canvas = state.topView.canvas;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  state.topView.pointerState.positions.delete(event.pointerId);
  if (state.topView.pointerState.primaryId === event.pointerId) {
    state.topView.pointerState.primaryId = null;
  }
  if (state.topView.pointerState.secondaryId === event.pointerId) {
    state.topView.pointerState.secondaryId = null;
  }
  if (state.topView.pointerState.draggingSubId && event.pointerId) {
    state.topView.pointerState.draggingSubId = null;
    scheduleRecompute();
  } else if (state.topView.pointerState.listenerSetOnRelease) {
    const world = canvasToWorld(event.clientX, event.clientY);
    const segments = getSegments();
    if (pointInsideRoom(world.x, world.y, segments)) {
      state.listener.x = world.x;
      state.listener.y = world.y;
      scheduleRecompute();
    }
    state.topView.pointerState.listenerSetOnRelease = false;
  }
  if (state.topView.pointerState.positions.size === 0) {
    state.topView.pointerState.draggingCanvas = false;
    state.topView.pointerState.lastPinchDistance = null;
    state.topView.pointerState.lastPinchCenter = null;
  } else if (state.topView.pointerState.positions.size === 1) {
    state.topView.pointerState.lastPinchDistance = null;
    state.topView.pointerState.lastPinchCenter = null;
  }
}

function onTopViewWheel(event) {
  event.preventDefault();
  const { deltaY } = event;
  const scaleFactor = deltaY > 0 ? 0.95 : 1.05;
  applyZoom(scaleFactor, { x: event.clientX, y: event.clientY });
}

function applyZoom(factor, centerClient) {
  const minScale = 20;
  const maxScale = 300;
  const newScale = clamp(state.topView.scale * factor, minScale, maxScale);
  const rect = state.topView.canvas.getBoundingClientRect();
  const dpi = window.devicePixelRatio || 1;
  const canvasPoint = {
    x: (centerClient.x - rect.left) * dpi,
    y: (centerClient.y - rect.top) * dpi,
  };
  const worldX = (canvasPoint.x - state.topView.panX) / state.topView.scale;
  const worldY = (canvasPoint.y - state.topView.panY) / state.topView.scale;
  state.topView.scale = newScale;
  state.topView.panX = canvasPoint.x - worldX * newScale;
  state.topView.panY = canvasPoint.y - worldY * newScale;
  renderTopView();
}

function distanceBetweenPoints(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function canvasToWorld(clientX, clientY) {
  const rect = state.topView.canvas.getBoundingClientRect();
  const dpi = window.devicePixelRatio || 1;
  const x = (clientX - rect.left) * dpi;
  const y = (clientY - rect.top) * dpi;
  return {
    x: (x - state.topView.panX) / state.topView.scale,
    y: (y - state.topView.panY) / state.topView.scale,
  };
}

function clientToWorld(clientX, clientY) {
  return canvasToWorld(clientX, clientY);
}

function worldToCanvas(point) {
  return {
    x: point.x * state.topView.scale + state.topView.panX,
    y: point.y * state.topView.scale + state.topView.panY,
  };
}

function hitTestSubwoofer(x, y) {
  const threshold = 0.3;
  for (const sub of state.subwoofers) {
    const dist = Math.hypot(sub.x - x, sub.y - y);
    if (dist <= threshold) return sub;
  }
  return null;
}

function autoScaleTopView() {
  const segments = getSegments();
  const bounds = getRoomBounds(segments);
  const widthMeters = bounds.maxX - bounds.minX;
  const heightMeters = bounds.maxY - bounds.minY;
  if (widthMeters <= 0 || heightMeters <= 0) return;
  const padding = 0.15;
  const availableWidth = state.topView.width;
  const availableHeight = state.topView.height;
  const scale = Math.min(
    availableWidth / ((1 + padding) * widthMeters),
    availableHeight / ((1 + padding) * heightMeters),
  );
  state.topView.scale = scale;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  state.topView.panX = availableWidth / 2 - centerX * scale;
  state.topView.panY = availableHeight / 2 - centerY * scale;
}

function getRoomBounds(segments = getSegments()) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  segments.forEach((seg) => {
    minX = Math.min(minX, seg.origin.x);
    minY = Math.min(minY, seg.origin.y);
    maxX = Math.max(maxX, seg.origin.x + seg.length);
    maxY = Math.max(maxY, seg.origin.y + seg.width);
  });
  return { minX, minY, maxX, maxY };
}

function renderTopView() {
  const { ctx, canvas } = state.topView;
  const segments = getSegments();
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, segments);
  drawRoomSegments(ctx, segments);
  drawSubwoofers(ctx);
  drawListener(ctx);
  ctx.restore();
}

function drawGrid(ctx, segments) {
  const bounds = getRoomBounds(segments);
  const meterSpacing = chooseGridSpacing(bounds);
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1;
  for (let x = Math.floor(bounds.minX / meterSpacing) * meterSpacing; x <= bounds.maxX; x += meterSpacing) {
    const start = worldToCanvas({ x, y: bounds.minY });
    const end = worldToCanvas({ x, y: bounds.maxY });
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  for (let y = Math.floor(bounds.minY / meterSpacing) * meterSpacing; y <= bounds.maxY; y += meterSpacing) {
    const start = worldToCanvas({ x: bounds.minX, y });
    const end = worldToCanvas({ x: bounds.maxX, y });
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
}

function chooseGridSpacing(bounds) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (span <= 4) return 0.5;
  if (span <= 8) return 1;
  if (span <= 12) return 1.5;
  return 2;
}

function drawRoomSegments(ctx, segments) {
  ctx.save();
  segments.forEach((seg, index) => {
    const topLeft = worldToCanvas({ x: seg.origin.x, y: seg.origin.y });
    const bottomRight = worldToCanvas({ x: seg.origin.x + seg.length, y: seg.origin.y + seg.width });
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    ctx.fillStyle = index === 0 ? "rgba(37, 99, 235, 0.08)" : "rgba(99, 102, 241, 0.12)";
    ctx.strokeStyle = "rgba(30, 64, 175, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(topLeft.x, topLeft.y, width, height);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function drawSubwoofers(ctx) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 14px Inter, sans-serif";
  state.subwoofers.forEach((sub, idx) => {
    const pos = worldToCanvas(sub);
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(idx + 1), pos.x, pos.y);
  });
  ctx.restore();
}

function drawListener(ctx) {
  ctx.save();
  const pos = worldToCanvas(state.listener);
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(15, 118, 110, 0.1)";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updateSubwooferList() {
  const list = state.dom.subwooferList;
  list.innerHTML = "";
  state.subwoofers.forEach((sub, idx) => {
    const item = document.createElement("li");
    item.innerHTML = `<span>Sub ${idx + 1}: x=${sub.x.toFixed(2)} m, y=${sub.y.toFixed(2)} m</span>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Entfernen";
    button.addEventListener("click", () => {
      state.subwoofers = state.subwoofers.filter((s) => s.id !== sub.id);
      updateSubwooferList();
      renderTopView();
      scheduleRecompute();
    });
    item.appendChild(button);
    list.appendChild(item);
  });
}

function renderHeatmap() {
  const canvas = state.dom.heatmapCanvas;
  const ctx = canvas.getContext("2d");
  const { resolution, data, min, max, bounds } = state.heatmap;
  if (!data) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const v = y / canvas.height;
    const iy = Math.min(resolution - 1, Math.floor(v * resolution));
    for (let x = 0; x < canvas.width; x += 1) {
      const u = x / canvas.width;
      const ix = Math.min(resolution - 1, Math.floor(u * resolution));
      const value = data[iy * resolution + ix];
      const index = (y * canvas.width + x) * 4;
      if (Number.isNaN(value)) {
        imageData.data[index + 3] = 0;
      } else {
        const color = interpolateColor(value, min, max);
        imageData.data[index] = color[0];
        imageData.data[index + 1] = color[1];
        imageData.data[index + 2] = color[2];
        imageData.data[index + 3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  drawHeatmapMask(ctx);
}

function interpolateColor(value, min, max) {
  const clamped = clamp((value - min) / (max - min), 0, 1);
  if (clamped < 0.5) {
    const t = clamped / 0.5;
    return lerpColor([37, 99, 235], [34, 197, 94], t);
  }
  const t = (clamped - 0.5) / 0.5;
  return lerpColor([34, 197, 94], [239, 68, 68], t);
}

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function drawHeatmapMask(ctx) {
  const segments = getSegments();
  ctx.save();
  ctx.strokeStyle = "rgba(30, 64, 175, 0.9)";
  ctx.lineWidth = 3;
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  segments.forEach((seg) => {
    const tl = heatmapWorldToCanvas({ x: seg.origin.x, y: seg.origin.y });
    const br = heatmapWorldToCanvas({ x: seg.origin.x + seg.length, y: seg.origin.y + seg.width });
    ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  });
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "rgba(30, 64, 175, 0.9)";
  ctx.lineWidth = 3;
  segments.forEach((seg) => {
    const topLeft = heatmapWorldToCanvas({ x: seg.origin.x, y: seg.origin.y });
    const bottomRight = heatmapWorldToCanvas({ x: seg.origin.x + seg.length, y: seg.origin.y + seg.width });
    ctx.strokeRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
  });
  ctx.restore();
}

function heatmapWorldToCanvas(point) {
  const { bounds } = state.heatmap;
  const canvas = state.dom.heatmapCanvas;
  const x = ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * canvas.width;
  const y = ((point.y - bounds.minY) / (bounds.maxY - bounds.minY)) * canvas.height;
  return { x, y };
}

function renderFrequencyChart() {
  const x = state.frequencyResponse.map((d) => d.freq);
  const y = state.frequencyResponse.map((d) => d.db);
  const layout = {
    margin: { l: 50, r: 20, t: 10, b: 40 },
    xaxis: { title: "Frequenz (Hz)", range: [FREQ_MIN, FREQ_MAX], dtick: 20 },
    yaxis: { title: "Amplitude (dB)", rangemode: "tozero" },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(248, 250, 252, 0.7)",
  };
  const trace = {
    x,
    y,
    type: "scatter",
    mode: "lines",
    line: { color: "#2563eb", width: 2 },
    hovertemplate: "Frequenz: %{x:.1f} Hz<br>Amplitude: %{y:.2f} dB<extra></extra>",
  };
  window.Plotly.react(state.dom.frequencyChart, [trace], layout, { displaylogo: false, responsive: true });
}

function renderModeDistribution() {
  const modes = state.modes.filter((mode) => mode.frequency >= FREQ_MIN && mode.frequency <= FREQ_MAX);
  const types = ["axial", "tangential", "oblique"];
  const colors = {
    axial: "#ef4444",
    tangential: "#f59e0b",
    oblique: "#22c55e",
  };
  const data = types.map((type) => {
    const typeModes = modes.filter((mode) => mode.type === type);
    return {
      x: typeModes.flatMap((mode) => [mode.frequency, mode.frequency, null]),
      y: typeModes.flatMap(() => [0, 1, null]),
      mode: "lines",
      line: { color: colors[type], width: 2 },
      name: `${capitalize(type)}`,
      hoverinfo: "skip",
    };
  });
  const markerTrace = {
    x: modes.map((mode) => mode.frequency),
    y: modes.map(() => 1),
    text: modes.map((mode) => `f=${mode.frequency.toFixed(1)} Hz<br>${capitalize(mode.type)} (${mode.nx},${mode.ny},${mode.nz})<br>Segment ${mode.segmentId}`),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers",
    marker: { color: modes.map((mode) => colors[mode.type]), size: 8 },
    name: "Moden",
  };
  const layout = {
    margin: { l: 50, r: 20, t: 10, b: 40 },
    xaxis: { title: "Frequenz (Hz)", range: [FREQ_MIN, FREQ_MAX], dtick: 10 },
    yaxis: { visible: false },
    showlegend: true,
    legend: { orientation: "h", y: -0.25 },
    shapes: [],
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(248, 250, 252, 0.7)",
  };
  window.Plotly.react(state.dom.modeDistribution, [...data, markerTrace], layout, { displaylogo: false, responsive: true });
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function initializePlots() {
  window.Plotly.newPlot(state.dom.frequencyChart, [], {});
  window.Plotly.newPlot(state.dom.modeDistribution, [], {});
}

function addSubwoofer() {
  const segments = getSegments();
  const seg = segments[segments.length - 1];
  const newSub = {
    id: generateId(),
    x: seg.origin.x + seg.length * 0.5,
    y: seg.origin.y + seg.width * 0.7,
  };
  if (!pointInsideRoom(newSub.x, newSub.y, segments)) {
    const fallback = clampPointToRoom(newSub.x, newSub.y, segments);
    newSub.x = fallback.x;
    newSub.y = fallback.y;
  }
  state.subwoofers.push(newSub);
  updateSubwooferList();
  renderTopView();
  scheduleRecompute();
}

function initializeThree() {
  const container = state.dom.threeContainer;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(6, 4, 6);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.minDistance = 2;
  controls.maxDistance = 40;
  controls.target.set(3, 1, 2);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.7);
  directional.position.set(5, 8, 5);
  scene.add(directional);

  const floorGroup = new THREE.Group();
  scene.add(floorGroup);

  const subGroup = new THREE.Group();
  scene.add(subGroup);

  const listenerMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x0f766e, emissive: 0x0f766e, emissiveIntensity: 0.3 }),
  );
  scene.add(listenerMarker);

  state.three = {
    initialized: true,
    renderer,
    scene,
    camera,
    controls,
    container,
    floorGroup,
    subGroup,
    listenerMarker,
  };

  animateThree();
}

function resizeThree() {
  if (!state.three.initialized) return;
  const { container, renderer, camera } = state.three;
  const width = container.clientWidth;
  const height = container.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animateThree() {
  if (!state.three.initialized) return;
  const { renderer, scene, camera, controls } = state.three;
  controls.update();
  renderer.render(scene, camera);
  state.three.animationHandle = requestAnimationFrame(animateThree);
}

function updateThreeScene() {
  if (!state.three.initialized) return;
  const { floorGroup, subGroup, listenerMarker } = state.three;
  floorGroup.clear();

  const segments = getSegments();
  segments.forEach((seg, index) => {
    const geometry = new THREE.BoxGeometry(seg.length, 0.1, seg.width);
    const material = new THREE.MeshStandardMaterial({
      color: index === 0 ? 0x2563eb : 0x818cf8,
      opacity: 0.55,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(seg.origin.x + seg.length / 2, 0, seg.origin.y + seg.width / 2);
    floorGroup.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(seg.length, state.room.height, seg.width)),
      new THREE.LineBasicMaterial({ color: 0x1e3a8a }),
    );
    edges.position.set(seg.origin.x + seg.length / 2, state.room.height / 2, seg.origin.y + seg.width / 2);
    floorGroup.add(edges);
  });

  subGroup.clear();
  state.subwoofers.forEach((sub, idx) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, emissive: 0x1d4ed8, emissiveIntensity: 0.2 }),
    );
    mesh.position.set(sub.x, 0.15, sub.y);
    subGroup.add(mesh);
    const label = createTextSprite(`S${idx + 1}`);
    label.position.set(sub.x, 0.5, sub.y);
    subGroup.add(label);
  });

  listenerMarker.position.set(state.listener.x, state.listener.z, state.listener.y);
}

function createTextSprite(text) {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 48px Inter";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.4, 0.4, 0.4);
  return sprite;
}

async function exportPdfReport() {
  try {
    updateStatus("Erstelle PDF …", "processing");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const margin = 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Raummoden Analysebericht", margin, margin);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");

    const segments = getSegments();
    const infoY = margin + 12;
    doc.text(`Raumtyp: ${state.room.type === "lshape" ? "L-förmig" : "Rechteckig"}`, margin, infoY);
    doc.text(`Abmessungen Segment A: ${state.room.lengthA.toFixed(2)} m × ${state.room.widthA.toFixed(2)} m × ${state.room.height.toFixed(2)} m`, margin, infoY + 6);
    if (state.room.type === "lshape") {
      doc.text(`Segment B (${state.room.orientation.toUpperCase()}): ${state.room.lengthB.toFixed(2)} m × ${state.room.widthB.toFixed(2)} m`, margin, infoY + 12);
    }
    doc.text(`Ohrhöhe: ${state.listener.z.toFixed(2)} m`, margin, infoY + 18);

    const sketchY = infoY + 28;
    drawRoomSketchOnPdf(doc, segments, { x: margin, y: sketchY, width: 80, height: 80 });
    const subInfoY = sketchY + 88;
    doc.setFont("helvetica", "bold");
    doc.text("Subwoofer-Positionen:", margin, subInfoY);
    doc.setFont("helvetica", "normal");
    state.subwoofers.forEach((sub, idx) => {
      doc.text(`Sub ${idx + 1}: x=${sub.x.toFixed(2)} m, y=${sub.y.toFixed(2)} m`, margin, subInfoY + 6 + idx * 6);
    });

    const heatmapImage = await generateHeatmapImage(1400);
    doc.addImage(heatmapImage, "PNG", margin + 90, sketchY, 100, 70);
    doc.setFont("helvetica", "bold");
    doc.text("Moden (20-200 Hz)", margin, 210);
    doc.setFont("helvetica", "normal");
    const modes = state.modes.filter((mode) => mode.frequency >= FREQ_MIN && mode.frequency <= FREQ_MAX);
    const limitedModes = modes.slice(0, 25);
    limitedModes.forEach((mode, idx) => {
      doc.text(
        `${mode.frequency.toFixed(1)} Hz · ${capitalize(mode.type)} (${mode.nx},${mode.ny},${mode.nz}) · Segment ${mode.segmentId}`,
        margin,
        210 + 6 + idx * 5,
      );
    });

    doc.save("raummoden-analyse.pdf");
    updateStatus("PDF erstellt", "ready");
  } catch (error) {
    console.error(error);
    updateStatus("Fehler beim PDF-Export", "error");
  }
}

function drawRoomSketchOnPdf(doc, segments, area) {
  const bounds = getRoomBounds(segments);
  const scaleX = area.width / (bounds.maxX - bounds.minX);
  const scaleY = area.height / (bounds.maxY - bounds.minY);
  const scale = Math.min(scaleX, scaleY);
  const offsetX = area.x + (area.width - (bounds.maxX - bounds.minX) * scale) / 2;
  const offsetY = area.y + (area.height - (bounds.maxY - bounds.minY) * scale) / 2;
  doc.setDrawColor(30, 64, 175);
  doc.setLineWidth(0.6);
  segments.forEach((seg, idx) => {
    const x = offsetX + (seg.origin.x - bounds.minX) * scale;
    const y = offsetY + (seg.origin.y - bounds.minY) * scale;
    const w = seg.length * scale;
    const h = seg.width * scale;
    const fillColor = idx === 0 ? [219, 234, 254] : [221, 214, 254];
    doc.setFillColor(...fillColor);
    doc.rect(x, y, w, h, "FD");
  });
  doc.setFillColor(37, 99, 235);
  state.subwoofers.forEach((sub) => {
    const x = offsetX + (sub.x - bounds.minX) * scale;
    const y = offsetY + (sub.y - bounds.minY) * scale;
    doc.circle(x, y, 1.5, "F");
  });
  doc.setFillColor(15, 118, 110);
  const listenerX = offsetX + (state.listener.x - bounds.minX) * scale;
  const listenerY = offsetY + (state.listener.y - bounds.minY) * scale;
  doc.circle(listenerX, listenerY, 1.2, "F");
}

async function generateHeatmapImage(pixels) {
  const offscreen = document.createElement("canvas");
  const size = pixels;
  offscreen.width = size;
  offscreen.height = size;
  const ctx = offscreen.getContext("2d");
  const resolution = Math.max(120, state.heatmap.resolution * 2);
  const segments = getSegments();
  const bounds = getRoomBounds(segments);
  const dx = (bounds.maxX - bounds.minX) / resolution;
  const dy = (bounds.maxY - bounds.minY) / resolution;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const values = new Float32Array(resolution * resolution);
  for (let iy = 0; iy < resolution; iy += 1) {
    for (let ix = 0; ix < resolution; ix += 1) {
      const x = bounds.minX + ix * dx + dx / 2;
      const y = bounds.minY + iy * dy + dy / 2;
      let value = Number.NaN;
      if (pointInsideRoom(x, y, segments)) {
        value = evaluatePressureAtPoint({ x, y }, state.listener.z, segments);
        if (Number.isFinite(value)) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
      values[iy * resolution + ix] = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-6) {
    min = -1;
    max = 1;
  }
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    const iy = Math.min(resolution - 1, Math.floor(v * resolution));
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const ix = Math.min(resolution - 1, Math.floor(u * resolution));
      const value = values[iy * resolution + ix];
      const index = (y * size + x) * 4;
      if (Number.isNaN(value)) {
        imageData.data[index + 3] = 0;
      } else {
        const [r, g, b] = interpolateColor(value, min, max);
        imageData.data[index] = r;
        imageData.data[index + 1] = g;
        imageData.data[index + 2] = b;
        imageData.data[index + 3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return offscreen.toDataURL("image/png", 1.0);
}

function pointInsideSegment2D(point, segment) {
  const { origin, dimensions } = segment;
  return (
    point.x >= origin.x &&
    point.x <= origin.x + dimensions.length &&
    point.y >= origin.y &&
    point.y <= origin.y + dimensions.width
  );
}
