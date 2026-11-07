/**
 * Harmony for Philips Hue: wires the color wheel and light list to a Hue
 * bridge (or the demo bridge) and keeps settings in sync.
 */

import { hsvToHex, hsvToXy, xyToHsv } from './color.js';
import { DemoBridge, discoverBridges, HueBridge, HueError } from './hue.js';
import { LightList } from './lights.js';
import { clearSettings, defaultSettings, loadSettings, saveSettings } from './settings.js';
import { Toast } from './toast.js';
import { ColorWheel, MODES } from './wheel.js';

const DEVICE_TYPE = 'harmony#web';
const STALE_AFTER_MS = 10 * 60 * 1000;

const MSG = {
  CONNECTING: 'Connecting to your Hue bridge…',
  LOADING_DEMO: 'Loading the demo…',
  CONNECTED: 'Connected to your Hue bridge.',
  DEMO: 'Demo mode: these lights are make-believe.',
  NO_BRIDGE: 'No Hue bridge was found on your network. Set its IP address in Settings, or try the demo.',
  DISCOVERY_FAILED: 'Could not reach the Hue discovery service. Set the bridge IP address in Settings, or try the demo.',
  PRESS_BUTTON: 'Press the link button on your Hue bridge, then retry.',
  BRIDGE_UNREACHABLE: 'Could not reach the Hue bridge. Check the IP address in Settings.',
  CERTIFICATE: (ip) => `Your browser does not trust the bridge's certificate yet. Open https://${ip}/ once, accept the warning, then come back.`,
  NO_LIGHTS: 'No lights are enabled. Pick some in Settings.',
};

/** An error the user can act on; `action` names which toast action to offer. */
class AppError extends Error {
  constructor(message, action) {
    super(message);
    this.action = action;
  }
}

/**
 * Coalesces light state changes and sends them to the bridge one at a time,
 * so dragging a slider or marker never floods the bridge.
 */
class LightSync {
  #pending = new Map();
  #timer = null;
  #busy = false;
  #disposed = false;

  constructor(bridge, onError) {
    this.bridge = bridge;
    this.onError = onError;
  }

  set(id, patch) {
    const current = this.#pending.get(id) ?? {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete current[key];
      else current[key] = value;
    }
    this.#pending.set(id, current);
    this.#schedule();
  }

  dispose() {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#pending.clear();
  }

  #schedule() {
    if (this.#timer || this.#busy || this.#disposed) return;
    this.#timer = setTimeout(() => this.#flush(), 50);
  }

  async #flush() {
    this.#timer = null;
    this.#busy = true;
    try {
      while (this.#pending.size > 0 && !this.#disposed) {
        const [id, patch] = this.#pending.entries().next().value;
        this.#pending.delete(id);
        try {
          await this.bridge.setLightState(id, patch);
        } catch (error) {
          this.#pending.clear();
          this.onError(error);
        }
      }
    } finally {
      this.#busy = false;
      if (this.#pending.size > 0) this.#schedule();
    }
  }
}

class App {
  settings = loadSettings();
  /** @type {Map<string, {id, uid, name, color, on, bri, xy, gamut}>} */
  lights = new Map();
  /** Light ids in list order. */
  order = [];
  demo = new URLSearchParams(location.search).has('demo');
  bridge = null;
  sync = null;
  /** Served over https: the bridge must be reached over https too. */
  #secure = location.protocol === 'https:';
  #lastIp = null;
  #retryOnReturn = false;
  #generation = 0;
  #hiddenAt = 0;

  constructor() {
    const $ = (selector) => document.querySelector(selector);
    this.toast = new Toast($('#toast'));
    this.wheel = new ColorWheel($('#wheel'));
    this.list = new LightList($('#lights'), $('#light-template'));
    this.backdrop = $('#backdrop');
    this.modes = $('#modes');
    this.dialog = $('#settings');
    this.form = this.dialog.querySelector('form');

    this.#buildModeControls();
    this.wheel.addEventListener('change', this.#onWheelChange);
    this.list.addEventListener('toggle', this.#onToggle);
    this.list.addEventListener('brightness', this.#onBrightness);
    this.list.addEventListener('reorder', this.#onReorder);

    $('#settings-button').addEventListener('click', () => this.openSettings());
    this.dialog.addEventListener('close', this.#onSettingsClosed);
    this.form.elements.autoDiscover.addEventListener('change', this.#syncSettingsForm);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.#hiddenAt = Date.now();
      } else if (this.#retryOnReturn) {
        this.#retryOnReturn = false;
        this.start();
      } else if (this.bridge && Date.now() - this.#hiddenAt > STALE_AFTER_MS) {
        this.start({ quiet: true });
      }
    });
    window.addEventListener('focus', () => {
      if (this.#retryOnReturn) {
        this.#retryOnReturn = false;
        this.start();
      }
    });
  }

  // --- Lifecycle ----------------------------------------------------------

  async start({ quiet = false } = {}) {
    const generation = ++this.#generation;
    this.sync?.dispose();
    if (!quiet) this.toast.show(this.demo ? MSG.LOADING_DEMO : MSG.CONNECTING);
    try {
      const [bridge, state] = await this.#connect();
      if (generation !== this.#generation) return;
      this.bridge = bridge;
      this.sync = new LightSync(bridge, this.#onSyncError);
      this.#adoptState(state);
      document.body.classList.toggle('is-demo', bridge.demo);
      // The demo has no Custom mode: its pretend lights have no colors
      // worth preserving, so start it on a harmony instead.
      if (bridge.demo && this.wheel.mode === MODES.CUSTOM) {
        this.modes.querySelector(`input[value="${MODES.ANALOGOUS}"]`).checked = true;
        this.wheel.setMode(MODES.ANALOGOUS);
      }
      if (this.lights.size === 0) {
        this.toast.show(MSG.NO_LIGHTS, { action: 'Settings', onAction: () => this.openSettings() });
      } else if (!quiet) {
        this.toast.show(bridge.demo ? MSG.DEMO : MSG.CONNECTED, { duration: 4000 });
      }
    } catch (error) {
      if (generation === this.#generation) this.#reportError(error);
    }
  }

  /** Finds the bridge, registers with it if needed and loads its state. */
  async #connect() {
    if (this.demo) {
      const bridge = new DemoBridge();
      return [bridge, await bridge.getFullState()];
    }
    const { bridgeIp, autoDiscover } = this.settings;
    let storedError = null;
    if (bridgeIp) {
      try {
        return await this.#loadFrom(bridgeIp);
      } catch (error) {
        // A stored address that no longer answers: fall back to discovery.
        if (!autoDiscover || error instanceof AppError) throw error;
        storedError = error;
      }
    }
    let bridges;
    try {
      bridges = await discoverBridges();
    } catch {
      throw storedError ?? new AppError(MSG.DISCOVERY_FAILED, 'demo');
    }
    if (bridges.length === 0) throw storedError ?? new AppError(MSG.NO_BRIDGE, 'demo');
    // Discovery found the same bridge that already failed: report that failure.
    if (storedError && bridges[0] === bridgeIp) throw storedError;
    return this.#loadFrom(bridges[0]);
  }

  async #loadFrom(ip) {
    this.#lastIp = ip;
    const bridge = new HueBridge(ip, this.settings.username || null, { secure: this.#secure });
    const load = async () => [bridge, await bridge.getFullState()];
    if (!bridge.username) await this.#register(bridge);
    try {
      return await load();
    } catch (error) {
      if (error instanceof HueError && error.type === HueError.UNAUTHORIZED) {
        await this.#register(bridge);
        return load();
      }
      throw error;
    }
  }

  async #register(bridge) {
    try {
      await bridge.createUser(DEVICE_TYPE);
    } catch (error) {
      if (error instanceof HueError && error.type === HueError.LINK_BUTTON) {
        throw new AppError(MSG.PRESS_BUTTON, 'retry');
      }
      throw error;
    }
    Object.assign(this.settings, { bridgeIp: bridge.ip, username: bridge.username });
    saveSettings(this.settings);
  }

  /** Builds the light model, wheel markers and list from a bridge state. */
  #adoptState(state) {
    const known = this.settings.lights;
    const prefs = {};
    this.lights.clear();
    for (const [id, light] of Object.entries(state.lights ?? {})) {
      const uid = light.uniqueid ?? `${id}:${light.name}`;
      prefs[uid] = { name: light.name, active: known[uid]?.active ?? true };
      if (!prefs[uid].active) continue;
      this.lights.set(id, {
        id,
        uid,
        name: light.name,
        color: Array.isArray(light.state.xy),
        on: Boolean(light.state.on),
        bri: light.state.bri ?? 254,
        xy: light.state.xy,
        gamut: light.capabilities?.control?.colorgamut,
      });
    }
    const lights = [...this.lights.values()];
    const uids = lights.map((l) => l.uid);
    this.settings.lights = prefs;
    this.settings.order = [
      ...this.settings.order.filter((uid) => uids.includes(uid)),
      ...uids.filter((uid) => !this.settings.order.includes(uid)),
    ];
    saveSettings(this.settings);
    this.order = this.settings.order.map((uid) => lights.find((l) => l.uid === uid).id);

    this.wheel.setMarkers(this.order
      .map((id) => this.lights.get(id))
      .filter((light) => light.color)
      .map((light) => ({
        id: light.id,
        name: light.name,
        h: xyToHsv(light.xy, light.gamut).h,
        s: 1,
        v: 1,
        visible: light.on,
      })));
    // Baseline each light's color to its marker so lights the user has not
    // touched are never rewritten by the first interaction.
    for (const marker of this.wheel.markers) {
      const light = this.lights.get(marker.id);
      light.xy = hsvToXy(marker, light.gamut);
    }
    this.modes.querySelector(`input[value="${this.wheel.mode}"]`).checked = true;
    this.#renderList();
    this.#renderBackdrop();
  }

  // --- Rendering ----------------------------------------------------------

  #renderList() {
    this.list.render(this.order.map((id) => {
      const light = this.lights.get(id);
      const marker = this.wheel.getMarker(id);
      return {
        id,
        name: light.name,
        on: light.on,
        bri: light.bri,
        color: light.color,
        hex: marker ? hsvToHex({ ...marker, v: 1 }) : null,
      };
    }));
  }

  #renderBackdrop() {
    const colors = this.wheel.colors;
    this.backdrop.classList.toggle('is-empty', colors.length === 0);
    if (colors.length === 0) return;
    const stops = colors.length === 1 ? [colors[0], colors[0]] : colors;
    this.backdrop.style.setProperty('--stops', stops.join(', '));
  }

  #buildModeControls() {
    for (const mode of Object.values(MODES)) {
      const label = document.createElement('label');
      label.className = 'modes__option';
      label.dataset.mode = mode;
      const input = Object.assign(document.createElement('input'), {
        type: 'radio',
        name: 'mode',
        value: mode,
        checked: mode === this.wheel.mode,
      });
      input.addEventListener('change', () => this.wheel.setMode(mode));
      label.append(input, document.createTextNode(mode));
      this.modes.append(label);
    }
  }

  // --- Event handlers -----------------------------------------------------

  #onWheelChange = ({ detail: { final } }) => {
    for (const marker of this.wheel.visibleMarkers) {
      const light = this.lights.get(marker.id);
      if (!light?.on) continue;
      const xy = hsvToXy(marker, light.gamut);
      if (light.xy && xy[0] === light.xy[0] && xy[1] === light.xy[1]) continue;
      light.xy = xy;
      // Short transitions keep live dragging responsive; final updates use
      // the bridge's gentler default.
      this.sync?.set(light.id, { xy, transitiontime: final ? undefined : 1 });
    }
    this.#renderList();
    this.#renderBackdrop();
  };

  #onToggle = ({ detail: { id, on } }) => {
    const light = this.lights.get(id);
    light.on = on;
    this.sync?.set(id, { on });
    if (light.color) {
      this.wheel.setVisible(id, on); // emits `change`, which re-renders
    } else {
      this.#renderList();
    }
  };

  #onBrightness = ({ detail: { id, bri } }) => {
    this.lights.get(id).bri = bri;
    this.sync?.set(id, { bri });
  };

  #onReorder = ({ detail: { ids } }) => {
    const moving = new Set(ids);
    let next = 0;
    this.order = this.order.map((id) => (moving.has(id) ? ids[next++] : id));
    this.settings.order = this.order.map((id) => this.lights.get(id).uid);
    saveSettings(this.settings);
    this.wheel.reorder(this.order); // emits `change`, which re-renders
  };

  #onSyncError = (error) => {
    console.error(error);
    if (error instanceof HueError) {
      this.toast.show(`The bridge refused an update: ${error.message}`, { duration: 6000 });
    } else {
      this.toast.show(MSG.BRIDGE_UNREACHABLE, { action: 'Retry', onAction: () => this.start() });
    }
  };

  #reportError(error) {
    console.error(error);
    const actions = {
      demo: ['Try the demo', () => { this.demo = true; this.start(); }],
      retry: ['Retry', () => this.start()],
    };
    if (error instanceof AppError) {
      const [action, onAction] = actions[error.action];
      this.toast.show(error.message, { action, onAction });
    } else if (error instanceof HueError) {
      this.toast.show(`The bridge said: ${error.message}`, { action: 'Retry', onAction: () => this.start() });
    } else if (this.#secure && this.#lastIp) {
      // Over https the usual cause is the bridge's self-signed certificate.
      // Send the user to accept it and retry when they come back.
      const ip = this.#lastIp;
      this.toast.show(MSG.CERTIFICATE(ip), {
        action: 'Open bridge',
        onAction: () => {
          this.#retryOnReturn = true;
          window.open(`https://${ip}/`, '_blank', 'noopener');
        },
      });
    } else {
      this.toast.show(MSG.BRIDGE_UNREACHABLE, { action: 'Retry', onAction: () => this.start() });
    }
  }

  // --- Settings -----------------------------------------------------------

  openSettings() {
    const { elements } = this.form;
    elements.bridgeIp.value = this.settings.bridgeIp;
    elements.autoDiscover.checked = this.settings.autoDiscover;
    const container = this.form.querySelector('#settings-lights');
    const fieldset = container.closest('fieldset');
    container.replaceChildren();
    const known = Object.entries(this.settings.lights);
    fieldset.hidden = known.length === 0;
    for (const [uid, pref] of known) {
      const label = document.createElement('label');
      label.className = 'check';
      const input = Object.assign(document.createElement('input'), {
        type: 'checkbox', name: 'light', value: uid, checked: pref.active,
      });
      label.append(input, document.createTextNode(pref.name));
      container.append(label);
    }
    this.#syncSettingsForm();
    this.dialog.returnValue = '';
    this.dialog.showModal();
  }

  #syncSettingsForm = () => {
    const { elements } = this.form;
    elements.bridgeIp.readOnly = elements.autoDiscover.checked;
  };

  #onSettingsClosed = () => {
    if (this.dialog.returnValue === 'reset') {
      clearSettings();
      this.settings = defaultSettings();
      this.demo = false;
      this.start();
      return;
    }
    if (this.dialog.returnValue !== 'save') return;
    const { elements } = this.form;
    const next = {
      ...this.settings,
      bridgeIp: elements.bridgeIp.value.trim(),
      autoDiscover: elements.autoDiscover.checked,
      lights: Object.fromEntries(Object.entries(this.settings.lights).map(([uid, pref]) => [
        uid, { ...pref, active: this.form.querySelector(`input[name="light"][value="${uid}"]`)?.checked ?? pref.active },
      ])),
    };
    if (next.bridgeIp !== this.settings.bridgeIp) next.username = '';
    const changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    this.settings = next;
    saveSettings(this.settings);
    if (changed) {
      if (next.bridgeIp) this.demo = false;
      this.start();
    }
  };
}

const app = new App();
app.start();
window.app = app; // handy for poking at things from the console
