/**
 * The list of lights: an on/off switch, brightness slider and color swatch
 * per light, with drag handles for reordering the lights that are on.
 *
 * Events: `toggle` { id, on }, `brightness` { id, bri, final },
 * `reorder` { ids } (the ids of the lights that are on, in their new order).
 */

export class LightList extends EventTarget {
  #rows = new Map();
  #drag = null;

  constructor(listElement, template) {
    super();
    this.el = listElement;
    this.template = template;
    this.el.addEventListener('pointerdown', this.#onHandleDown);
    this.el.addEventListener('pointermove', this.#onHandleMove);
    this.el.addEventListener('pointerup', this.#onHandleEnd);
    this.el.addEventListener('pointercancel', this.#onHandleEnd);
  }

  /**
   * Renders the given lights, lights that are on first. Existing rows are
   * reused so an in-progress slider drag is never interrupted.
   * @param {Array<{id, name, on, bri, hex, color}>} lights
   */
  render(lights) {
    const ordered = [...lights.filter((l) => l.on), ...lights.filter((l) => !l.on)];
    const seen = new Set();
    const previousOrder = [...this.el.children].map((row) => row.dataset.id).join();
    for (const light of ordered) {
      seen.add(light.id);
      let row = this.#rows.get(light.id);
      if (!row) {
        row = this.#createRow(light);
        this.#rows.set(light.id, row);
      }
      this.#updateRow(row, light);
    }
    for (const [id, row] of this.#rows) {
      if (!seen.has(id)) {
        row.remove();
        this.#rows.delete(id);
      }
    }
    const nextOrder = ordered.map((l) => l.id).join();
    const place = () => this.el.append(...ordered.map((l) => this.#rows.get(l.id)));
    if (previousOrder !== nextOrder && previousOrder && document.startViewTransition
      && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(place);
    } else {
      place();
    }
    this.el.classList.toggle('is-empty', ordered.length === 0);
  }

  #createRow(light) {
    const row = this.template.content.firstElementChild.cloneNode(true);
    row.dataset.id = light.id;
    row.style.viewTransitionName = `light-${light.id.replace(/[^\w-]/g, '_')}`;
    const slider = row.querySelector('.light__brightness');
    const toggle = row.querySelector('.light__switch');
    slider.id = `brightness-${light.id}`;
    row.querySelector('.light__name').htmlFor = slider.id;

    slider.addEventListener('input', () => {
      row.style.setProperty('--level', slider.value / slider.max);
      this.#emit('brightness', { id: light.id, bri: Number(slider.value), final: false });
    });
    slider.addEventListener('change', () => {
      this.#emit('brightness', { id: light.id, bri: Number(slider.value), final: true });
    });
    toggle.addEventListener('change', () => {
      this.#emit('toggle', { id: light.id, on: toggle.checked });
    });
    return row;
  }

  #updateRow(row, light) {
    const slider = row.querySelector('.light__brightness');
    const toggle = row.querySelector('.light__switch');
    row.querySelector('.light__name').textContent = light.name;
    row.querySelector('.light__swatch').style.setProperty('--swatch', light.hex ?? 'transparent');
    row.classList.toggle('is-off', !light.on);
    row.classList.toggle('is-color', Boolean(light.color));
    toggle.checked = light.on;
    toggle.setAttribute('aria-label', `${light.name} on`);
    slider.disabled = !light.on;
    slider.setAttribute('aria-label', `${light.name} brightness`);
    if (!slider.matches(':active') && document.activeElement !== slider) {
      slider.value = light.bri;
    }
    row.style.setProperty('--level', slider.value / slider.max);
    row.querySelector('.light__handle').disabled = !(light.on && light.color);
  }

  // --- Reordering by dragging the handle ---------------------------------

  #onHandleDown = (event) => {
    const handle = event.target.closest('.light__handle');
    if (!handle || handle.disabled || this.#drag) return;
    event.preventDefault();
    const row = handle.closest('.light');
    const siblings = [...this.el.querySelectorAll('.light:not(.is-off)')];
    const rect = row.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(this.el).rowGap) || 0;
    handle.setPointerCapture(event.pointerId);
    this.#drag = {
      pointerId: event.pointerId,
      handle,
      row,
      siblings,
      from: siblings.indexOf(row),
      to: siblings.indexOf(row),
      startY: event.clientY,
      step: rect.height + gap,
    };
    row.classList.add('is-dragging');
    this.el.classList.add('is-sorting');
  };

  #onHandleMove = (event) => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;
    drag.row.style.translate = `0 ${dy}px`;
    const last = drag.siblings.length - 1;
    drag.to = Math.min(last, Math.max(0, Math.round(drag.from + dy / drag.step)));
    drag.siblings.forEach((sibling, index) => {
      if (sibling === drag.row) return;
      let shift = 0;
      if (index > drag.from && index <= drag.to) shift = -drag.step;
      if (index < drag.from && index >= drag.to) shift = drag.step;
      sibling.style.translate = shift ? `0 ${shift}px` : '';
    });
  };

  #onHandleEnd = (event) => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#drag = null;
    for (const sibling of drag.siblings) sibling.style.translate = '';
    drag.row.classList.remove('is-dragging');
    this.el.classList.remove('is-sorting');
    if (drag.to === drag.from) return;
    const ids = drag.siblings.map((row) => row.dataset.id);
    ids.splice(drag.from, 1);
    ids.splice(drag.to, 0, drag.row.dataset.id);
    this.#emit('reorder', { ids });
  };

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
