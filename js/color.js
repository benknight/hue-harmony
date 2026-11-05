/**
 * Color math: HSV <-> RGB <-> hex, CIE 1931 xy (the Hue bridge's color
 * space) and the "artistic" hue mapping used by the wheel.
 *
 * Hue values are degrees [0, 360). Saturation and value are [0, 1].
 * RGB components are integers [0, 255].
 */

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function hsvToRgb({ h, s, v }) {
  const hue = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(hue);
  const f = hue - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const [r, g, b] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ][i % 6];
  return [r, g, b].map((c) => Math.round(clamp(c, 0, 1) * 255));
}

export function rgbToHsv([r, g, b]) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hsvToHex = (hsv) => rgbToHex(hsvToRgb(hsv));

// --- Artistic (RYB-ish) wheel <-> scientific (HSV) hue -------------------
// Adapted from Adobe Kuler. The wheel the user sees spreads warm hues out
// and squeezes greens and blues, the way a painter's color wheel does.

const mapRange = (value, fromLower, fromUpper, toLower, toUpper) =>
  toLower + (value - fromLower) * ((toUpper - toLower) / (fromUpper - fromLower));

export function artisticToScientific(hue) {
  return (
    hue < 60  ? hue * (35 / 60) :
    hue < 122 ? mapRange(hue, 60, 122, 35, 60) :
    hue < 165 ? mapRange(hue, 122, 165, 60, 120) :
    hue < 218 ? mapRange(hue, 165, 218, 120, 180) :
    hue < 275 ? mapRange(hue, 218, 275, 180, 240) :
    hue < 330 ? mapRange(hue, 275, 330, 240, 300) :
                mapRange(hue, 330, 360, 300, 360)
  );
}

export function scientificToArtistic(hue) {
  return (
    hue < 35  ? hue * (60 / 35) :
    hue < 60  ? mapRange(hue, 35, 60, 60, 122) :
    hue < 120 ? mapRange(hue, 60, 120, 122, 165) :
    hue < 180 ? mapRange(hue, 120, 180, 165, 218) :
    hue < 240 ? mapRange(hue, 180, 240, 218, 275) :
    hue < 300 ? mapRange(hue, 240, 300, 275, 330) :
                mapRange(hue, 300, 360, 330, 360)
  );
}

// --- CIE 1931 xy -----------------------------------------------------------
// Based on the Philips Hue developer documentation and Q42.HueApi.

/** Gamut B, the classic Hue bulb gamut. Used when a light reports none. */
export const DEFAULT_GAMUT = [[0.675, 0.322], [0.4091, 0.518], [0.167, 0.04]];

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function inGamut(p, [red, green, blue]) {
  const v1 = sub(green, red);
  const v2 = sub(blue, red);
  const q = sub(p, red);
  const s = cross(q, v2) / cross(v1, v2);
  const t = cross(v1, q) / cross(v1, v2);
  return s >= 0 && t >= 0 && s + t <= 1;
}

function closestPointOnSegment(a, b, p) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2), 0, 1);
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

function closestPointInGamut(p, [red, green, blue]) {
  return [
    closestPointOnSegment(red, green, p),
    closestPointOnSegment(blue, red, p),
    closestPointOnSegment(green, blue, p),
  ].reduce((best, candidate) =>
    distance(p, candidate) < distance(p, best) ? candidate : best);
}

const gammaExpand = (c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
const gammaCompress = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToXy([r, g, b], gamut = DEFAULT_GAMUT) {
  const [lr, lg, lb] = [r, g, b].map((c) => gammaExpand(c / 255));
  const X = lr * 0.4360747 + lg * 0.3850649 + lb * 0.0930804;
  const Y = lr * 0.2225045 + lg * 0.7168786 + lb * 0.0406169;
  const Z = lr * 0.0139322 + lg * 0.0971045 + lb * 0.7141733;
  const sum = X + Y + Z;
  const p = sum === 0 ? [0, 0] : [X / sum, Y / sum];
  const [x, y] = inGamut(p, gamut) ? p : closestPointInGamut(p, gamut);
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

export function xyToRgb([x, y], brightness = 1, gamut = DEFAULT_GAMUT) {
  const p = inGamut([x, y], gamut) ? [x, y] : closestPointInGamut([x, y], gamut);
  if (p[1] === 0) return [0, 0, 0];
  const Y = brightness;
  const X = (Y / p[1]) * p[0];
  const Z = (Y / p[1]) * (1 - p[0] - p[1]);
  let rgb = [
    X * 1.612 - Y * 0.203 - Z * 0.302,
    -X * 0.509 + Y * 1.412 + Z * 0.066,
    X * 0.026 - Y * 0.072 + Z * 0.962,
  ].map((c) => Math.max(0, gammaCompress(Math.max(0, c))));
  const max = Math.max(...rgb);
  if (max > 1) rgb = rgb.map((c) => c / max);
  return rgb.map((c) => Math.round(c * 255));
}

export const hsvToXy = (hsv, gamut) => rgbToXy(hsvToRgb(hsv), gamut);
export const xyToHsv = (xy, gamut) => rgbToHsv(xyToRgb(xy, 1, gamut));
