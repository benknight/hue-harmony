/**
 * An artist's color wheel with draggable markers and color-harmony modes.
 *
 * The disc itself is drawn with CSS gradients; markers and their trails are
 * SVG so they scale crisply. Markers hold HSV colors and are positioned by
 * "artistic" hue (angle) and saturation (distance from the center).
 *
 * Emits a `change` CustomEvent whose detail.final is false while a marker is
 * being dragged and true when an interaction has finished.
 */

import {
  artisticToScientific,
  hsvToHex,
  scientificToArtistic,
} from './color.js';

export const MODES = Object.freeze({
  CUSTOM: 'Custom',
  ANALOGOUS: 'Analogous',
  COMPLEMENTARY: 'Complementary',
  TRIAD: 'Triad',
  TETRAD: 'Tetrad',
  MONOCHROMATIC: 'Monochromatic',
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 100;
const MARGIN = 16;
const MARKER_RADIUS = 12;
const DEFAULT_SLICE = 20;
const TAU = Math.PI * 2;

/** Distance from the root marker by index: 0, 1, -1, 2, -2, ... */
const markerDistance = (i) => Math.ceil(i / 2) * (-1) ** (i + 1);

const mod360 = (deg) => ((deg % 360) + 360) % 360;

const preventDefault = (event) => event.preventDefault();

/** Signed shortest rotation from one angle to another, in (-180, 180]. */
const shortestDelta = (from, to) => mod360(to - from + 180) - 180;

const svgElement = (name, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
};

export class ColorWheel extends EventTarget {
  /** @type {Array<{id: string, name: string, h: number, s: number, v: number, visible: boolean}>} */
  #markers = [];
  #nodes = new Map();
  #mode = MODES.CUSTOM;
  #slice = DEFAULT_SLICE;
  #drag = null;

  constructor(container) {
    super();
    this.container = container;
    container.classList.add('wheel');

    this.disc = document.createElement('div');
    this.disc.className = 'wheel__disc';

    const size = (RADIUS + MARGIN) * 2;
    this.svg = svgElement('svg', {
      class: 'wheel__svg',
      viewBox: `${-RADIUS - MARGIN} ${-RADIUS - MARGIN} ${size} ${size}`,
    });
    this.trails = svgElement('g', { class: 'wheel__trails' });
    this.markerGroup = svgElement('g', { class: 'wheel__markers' });
    this.svg.append(this.trails, this.markerGroup);
    container.append(this.disc, this.svg);
    container.style.setProperty('--wheel-inset', `${(MARGIN / size) * 100}%`);

    this.svg.addEventListener('pointerdown', this.#onPointerDown);
    this.svg.addEventListener('pointermove', this.#onPointerMove);
    this.svg.addEventListener('pointerup', this.#onPointerEnd);
    this.svg.addEventListener('pointercancel', this.#onPointerEnd);
    this.svg.addEventListener('keydown', this.#onKeyDown);
    this.svg.addEventListener('keyup', this.#onKeyUp);
    this.#applyMode();
  }

  // --- Public API ---------------------------------------------------------

  get mode() {
    return this.#mode;
  }

  get markers() {
    return this.#markers;
  }

  get visibleMarkers() {
    return this.#markers.filter((m) => m.visible);
  }

  getMarker(id) {
    return this.#markers.find((m) => m.id === id);
  }

  /** Visible marker colors as hex strings, sorted by hue. */
  get colors() {
    return this.visibleMarkers
      .slice()
      .sort((a, b) => a.h - b.h)
      .map((m) => hsvToHex(m));
  }

  /** Replaces all markers. Each entry: { id, name, h, s, v, visible }. */
  setMarkers(markers) {
    this.#markers = markers.map((m) => ({ s: 1, v: 1, visible: true, ...m }));
    for (const node of this.#nodes.values()) {
      node.trail.remove();
      node.group.remove();
    }
    this.#nodes.clear();
    for (const marker of this.#markers) {
      const trail = svgElement('line', { class: 'wheel__trail', x1: 0, y1: 0 });
      const group = svgElement('g', { class: 'wheel__marker', tabindex: 0, role: 'slider' });
      group.dataset.id = marker.id;
      group.setAttribute('aria-valuemin', 0);
      group.setAttribute('aria-valuemax', 359);
      const title = svgElement('title');
      title.textContent = marker.name;
      group.append(title, svgElement('circle', { r: MARKER_RADIUS }));
      this.trails.append(trail);
      this.markerGroup.append(group);
      this.#nodes.set(marker.id, { trail, group });
    }
    this.render();
  }

  setMode(mode) {
    if (!Object.values(MODES).includes(mode)) {
      throw new Error(`Unknown color wheel mode: ${mode}`);
    }
    this.#mode = mode;
    this.#applyMode();
    this.applyHarmony();
    this.render();
    this.#emit(true);
  }

  setVisible(id, visible) {
    const marker = this.getMarker(id);
    if (!marker || marker.visible === visible) return;
    marker.visible = visible;
    this.applyHarmony();
    this.render();
    this.#emit(true);
  }

  /**
   * Reorders markers. The visible markers keep the colors of the positions
   * they occupy, so reordering moves lights between color "slots".
   */
  reorder(ids) {
    const slots = this.visibleMarkers.map(({ h, s, v }) => ({ h, s, v }));
    const byId = new Map(this.#markers.map((m) => [m.id, m]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const leftovers = this.#markers.filter((m) => !ordered.includes(m));
    this.#markers = [...ordered, ...leftovers];
    this.visibleMarkers.forEach((m, i) => Object.assign(m, slots[i]));
    for (const marker of this.#markers) {
      const node = this.#nodes.get(marker.id);
      this.trails.append(node.trail);
      this.markerGroup.append(node.group);
    }
    this.render();
    this.#emit(true);
  }

  /** Places the visible markers according to the current mode and root. */
  applyHarmony() {
    const visible = this.visibleMarkers;
    if (visible.length === 0) return;
    const rootHue = scientificToArtistic(visible[0].h);
    const spaced = (step, count) => visible.forEach((m, i) => {
      m.h = artisticToScientific(mod360(rootHue + (i % count) * step));
      m.s = 1 - 0.08 * Math.floor(i / count);
      m.v = 1;
    });
    switch (this.#mode) {
      case MODES.ANALOGOUS:
        visible.forEach((m, i) => {
          m.h = artisticToScientific(mod360(rootHue + markerDistance(i) * this.#slice));
          m.s = 1;
          m.v = 1;
        });
        break;
      case MODES.COMPLEMENTARY:
        spaced(180, 2);
        break;
      case MODES.TRIAD:
        spaced(120, 3);
        break;
      case MODES.TETRAD:
        spaced(90, 4);
        break;
      case MODES.MONOCHROMATIC:
        visible.forEach((m, i) => {
          m.h = visible[0].h;
          m.s = Math.max(0.25, 1 - 0.18 * i);
          m.v = 1;
        });
        break;
      default:
        break;
    }
  }

  render() {
    const visible = this.visibleMarkers;
    this.#markers.forEach((marker) => {
      const { trail, group } = this.#nodes.get(marker.id);
      const { x, y } = this.#pointFromHS(marker.h, marker.s);
      const hidden = !marker.visible;
      trail.classList.toggle('is-hidden', hidden);
      group.classList.toggle('is-hidden', hidden);
      group.classList.toggle('is-root', marker === visible[0]);
      group.setAttribute('tabindex', hidden ? -1 : 0);
      group.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      group.setAttribute('aria-label', marker.name);
      group.setAttribute('aria-valuenow', Math.round(marker.h));
      group.setAttribute('aria-valuetext',
        `hue ${Math.round(marker.h)} degrees, saturation ${Math.round(marker.s * 100)} percent`);
      group.querySelector('circle').setAttribute('fill', hsvToHex({ ...marker, v: 1 }));
      trail.setAttribute('x2', x.toFixed(2));
      trail.setAttribute('y2', y.toFixed(2));
    });
  }

  // --- Geometry -----------------------------------------------------------

  #pointFromHS(h, s) {
    const theta = (scientificToArtistic(h) / 360) * TAU;
    return { x: Math.cos(theta) * RADIUS * s, y: -Math.sin(theta) * RADIUS * s };
  }

  #hsFromPoint(x, y) {
    const artistic = mod360((Math.atan2(-y, x) / TAU) * 360);
    return {
      h: artisticToScientific(artistic),
      s: Math.min(1, Math.hypot(x, y) / RADIUS),
    };
  }

  #artisticAngle(x, y) {
    return mod360((Math.atan2(-y, x) / TAU) * 360);
  }

  /** Converts a pointer event into SVG user units centered on the wheel. */
  #pointFromEvent(event) {
    const rect = this.svg.getBoundingClientRect();
    const scale = ((RADIUS + MARGIN) * 2) / rect.width;
    return {
      x: (event.clientX - rect.left) * scale - RADIUS - MARGIN,
      y: (event.clientY - rect.top) * scale - RADIUS - MARGIN,
    };
  }

  // --- Interaction --------------------------------------------------------

  #beginInteraction(marker) {
    return {
      marker,
      startHues: new Map(this.visibleMarkers.map((m) => [m, scientificToArtistic(m.h)])),
    };
  }

  #endInteraction() {
    if (this.#mode === MODES.ANALOGOUS) {
      const [root, neighbor] = this.visibleMarkers;
      if (root && neighbor) {
        this.#slice = mod360(scientificToArtistic(neighbor.h) - scientificToArtistic(root.h));
      }
    }
    this.#emit(true);
  }

  /** Rotates the other visible markers to follow the one being moved. */
  #followHarmony(interaction, theta) {
    const { marker: target, startHues } = interaction;
    const visible = this.visibleMarkers;
    const targetDistance = markerDistance(visible.indexOf(target));
    visible.forEach((m, i) => {
      if (m === target) return;
      let rotation = theta;
      if (this.#mode === MODES.CUSTOM) return;
      if (this.#mode === MODES.ANALOGOUS && targetDistance !== 0) {
        rotation = (markerDistance(i) / targetDistance) * theta;
      }
      m.h = artisticToScientific(mod360(startHues.get(m) + rotation));
    });
  }

  #onPointerDown = (event) => {
    const group = event.target.closest('.wheel__marker');
    if (!group || this.#drag) return;
    const marker = this.getMarker(group.dataset.id);
    if (!marker?.visible) return;
    event.preventDefault();
    group.setPointerCapture(event.pointerId);
    group.focus({ preventScroll: true });
    this.#drag = { ...this.#beginInteraction(marker), pointerId: event.pointerId, group };
    group.classList.add('is-dragging');
    this.container.classList.add('is-dragging');
    // Browsers that ignore touch-action on SVG would otherwise scroll the page.
    document.addEventListener('touchmove', preventDefault, { passive: false });
  };

  #onPointerMove = (event) => {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
    const { marker, startHues } = this.#drag;
    const point = this.#pointFromEvent(event);
    const radius = Math.hypot(point.x, point.y);
    const clamped = radius > RADIUS
      ? { x: (point.x / radius) * RADIUS, y: (point.y / radius) * RADIUS }
      : point;
    Object.assign(marker, this.#hsFromPoint(clamped.x, clamped.y));
    const theta = shortestDelta(startHues.get(marker), this.#artisticAngle(point.x, point.y));
    this.#followHarmony(this.#drag, theta);
    this.render();
    this.#emit(false);
  };

  #onPointerEnd = (event) => {
    if (!this.#drag || event.pointerId !== this.#drag.pointerId) return;
    this.#drag.group.classList.remove('is-dragging');
    this.container.classList.remove('is-dragging');
    this.#drag = null;
    document.removeEventListener('touchmove', preventDefault);
    this.#endInteraction();
  };

  #keyboardInteraction = null;

  #onKeyDown = (event) => {
    const group = event.target.closest('.wheel__marker');
    if (!group) return;
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const marker = this.getMarker(group.dataset.id);
    if (!marker?.visible) return;
    const interaction = this.#beginInteraction(marker);
    const theta = step * (event.shiftKey ? 10 : 2);
    marker.h = artisticToScientific(mod360(interaction.startHues.get(marker) + theta));
    this.#followHarmony(interaction, theta);
    this.render();
    this.#emit(false);
    this.#keyboardInteraction = interaction;
  };

  #onKeyUp = (event) => {
    if (!this.#keyboardInteraction || !event.key.startsWith('Arrow')) return;
    this.#keyboardInteraction = null;
    this.#endInteraction();
  };

  #applyMode() {
    this.container.dataset.mode = this.#mode;
  }

  #emit(final) {
    this.dispatchEvent(new CustomEvent('change', { detail: { final } }));
  }
}
