/**
 * Minimal Philips Hue bridge client (API v1) built on fetch, plus a demo
 * bridge that serves canned data so the app can run without hardware.
 */

export class HueError extends Error {
  /** Error type 1: unauthorized user. */
  static UNAUTHORIZED = 1;
  /** Error type 101: link button not pressed. */
  static LINK_BUTTON = 101;

  constructor({ type, description, address }) {
    super(description);
    this.name = 'HueError';
    this.type = type;
    this.address = address;
  }
}

async function request(url, { method = 'GET', body, timeout = 8000 } = {}) {
  const response = await fetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  // The bridge reports errors as [{ error: { type, description } }].
  const failure = Array.isArray(data) ? data.find((entry) => entry.error) : null;
  if (failure) throw new HueError(failure.error);
  return data;
}

/** Asks Philips' discovery service for bridges on this network. */
export async function discoverBridges() {
  const bridges = await request('https://discovery.meethue.com/');
  return bridges.map((bridge) => bridge.internalipaddress).filter(Boolean);
}

export class HueBridge {
  /**
   * @param {string} ip
   * @param {string|null} username
   * @param {object} [options]
   * @param {boolean} [options.secure] talk to the bridge over https. Needed
   *   when the app itself is served over https, since browsers block plain
   *   http requests from https pages. The bridge's certificate is not
   *   trusted by browsers, so the user must accept it once.
   */
  constructor(ip, username = null, { secure = false } = {}) {
    this.ip = ip;
    this.username = username;
    this.secure = secure;
  }

  get demo() {
    return false;
  }

  get url() {
    return `${this.secure ? 'https' : 'http'}://${this.ip}/api`;
  }

  /**
   * Registers a new app user. Only succeeds within 30 seconds of the link
   * button being pressed; otherwise throws HueError with type LINK_BUTTON.
   */
  async createUser(devicetype) {
    const [result] = await request(this.url, { method: 'POST', body: { devicetype } });
    this.username = result.success.username;
    return this.username;
  }

  getFullState() {
    return request(`${this.url}/${this.username}`);
  }

  setLightState(id, state) {
    return request(`${this.url}/${this.username}/lights/${id}/state`, {
      method: 'PUT',
      body: state,
      timeout: 4000,
    });
  }
}

/** A stand-in bridge that loads demo data and swallows writes. */
export class DemoBridge {
  #state = null;

  constructor(source = 'demo.json') {
    this.source = source;
    this.username = 'demo';
  }

  get demo() {
    return true;
  }

  async createUser() {
    return this.username;
  }

  async getFullState() {
    if (!this.#state) {
      const response = await fetch(this.source);
      this.#state = await response.json();
    }
    return structuredClone(this.#state);
  }

  async setLightState(id, state) {
    const light = this.#state?.lights[id];
    if (light) Object.assign(light.state, state);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return [{ success: state }];
  }
}
