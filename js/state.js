/**
 * state.js — Central pub/sub state store
 *
 * Why: A single source of truth prevents UI components from holding
 * stale local copies of data. Pub/sub lets panels reactively update
 * without components needing to know about each other.
 *
 * Usage:
 *   App.State.set('branches', [...]);
 *   App.State.subscribe('branches', (value) => renderBranchList(value));
 *   const branches = App.State.get('branches');
 *
 * State keys (from blueprint §5.3):
 *   repo, branches, tags, releases, commits, divergenceMatrix,
 *   healthReport, activityMetrics, rateLimits, operationLog
 */
(function () {
  'use strict';

  // Ensure the namespace exists
  window.App = window.App || {};

  const State = {
    // Private: holds current values
    _data: {},

    // Private: map of key → [callbacks]
    _listeners: new Map(),

    /**
     * Set a state key and notify all subscribers.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      this._data[key] = value;
      const callbacks = this._listeners.get(key);
      if (callbacks) {
        // Notify in insertion order; copy array first so a subscriber
        // that calls unsubscribe() during iteration doesn't skip others.
        [...callbacks].forEach(fn => {
          try {
            fn(value);
          } catch (err) {
            // A subscriber throwing must not break other subscribers
            console.error(`[State] Subscriber for "${key}" threw:`, err);
          }
        });
      }
    },

    /**
     * Get current value for a key (or undefined if not yet set).
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      return this._data[key];
    },

    /**
     * Subscribe to changes on a key.
     * Returns an unsubscribe function for cleanup.
     * @param {string} key
     * @param {Function} callback  called with (newValue) on every set()
     * @returns {Function} unsubscribe
     */
    subscribe(key, callback) {
      if (!this._listeners.has(key)) {
        this._listeners.set(key, []);
      }
      this._listeners.get(key).push(callback);

      // Return unsubscribe so callers can clean up
      return () => {
        const list = this._listeners.get(key);
        if (list) {
          const idx = list.indexOf(callback);
          if (idx !== -1) list.splice(idx, 1);
        }
      };
    },

    /**
     * Emit a one-time event that doesn't persist as state.
     * Useful for transient signals (e.g. 'connectClicked').
     * @param {string} event
     * @param {*} data
     */
    emit(event, data) {
      // Use a special prefix so event keys don't clash with state keys
      const key = `@@event:${event}`;
      const callbacks = this._listeners.get(key);
      if (callbacks) {
        [...callbacks].forEach(fn => {
          try { fn(data); } catch (err) {
            console.error(`[State] Event handler for "${event}" threw:`, err);
          }
        });
      }
    },

    /**
     * Subscribe to a one-time event (see emit()).
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} unsubscribe
     */
    on(event, callback) {
      return this.subscribe(`@@event:${event}`, callback);
    },

    /**
     * Reset all state (e.g. on disconnect).
     */
    reset() {
      const keys = Object.keys(this._data);
      this._data = {};
      // Notify subscribers that each key is now undefined
      keys.forEach(key => {
        const callbacks = this._listeners.get(key);
        if (callbacks) {
          [...callbacks].forEach(fn => {
            try { fn(undefined); } catch (_) { /* ignore */ }
          });
        }
      });
    }
  };

  // Expose on global namespace
  window.App.State = State;

})();
