/** A single status message with an optional action button. */
export class Toast {
  #timer = null;
  #onAction = null;

  constructor(element) {
    this.el = element;
    this.text = element.querySelector('.toast__text');
    this.action = element.querySelector('.toast__action');
    this.action.addEventListener('click', () => this.#onAction?.());
  }

  /**
   * @param {string} message
   * @param {object} [options]
   * @param {string} [options.action] label for the action button
   * @param {Function} [options.onAction]
   * @param {number} [options.duration] ms before auto-hiding; 0 keeps it open
   */
  show(message, { action, onAction, duration = 0 } = {}) {
    clearTimeout(this.#timer);
    this.text.textContent = message;
    this.#onAction = onAction ?? null;
    this.action.textContent = action ?? '';
    this.action.hidden = !action;
    this.el.hidden = false;
    this.el.classList.add('is-visible');
    if (duration > 0) {
      this.#timer = setTimeout(() => this.hide(), duration);
    }
  }

  hide() {
    clearTimeout(this.#timer);
    this.el.classList.remove('is-visible');
    this.#onAction = null;
    // Keep the element in the accessibility tree until the exit transition ends.
    this.#timer = setTimeout(() => { this.el.hidden = true; }, 250);
  }
}
