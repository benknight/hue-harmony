/** Persistent app settings, stored in localStorage. */

const STORAGE_KEY = 'harmony.settings';
const VERSION = 3;

export const defaultSettings = () => ({
  version: VERSION,
  bridgeIp: '',
  username: '',
  autoDiscover: true,
  /** Per-light preferences keyed by the light's unique id: { name, active }. */
  lights: {},
  /** Light unique ids in the order they appear in the list. */
  order: [],
});

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.version === VERSION) {
      return { ...defaultSettings(), ...stored };
    }
  } catch {
    // Corrupt or inaccessible storage: fall through to defaults.
  }
  return defaultSettings();
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, version: VERSION }));
  } catch {
    // Storage may be unavailable (private mode, quota); the app still works.
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
