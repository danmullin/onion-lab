(function (SA) {
  const DEFAULT_KEY = 'sprite-anim-studio-v1'

  class SessionStore {
    /** @param {string} [key] */
    constructor(key = DEFAULT_KEY) {
      this.key = key
    }

    /** @param {any} payload */
    save(payload) {
      localStorage.setItem(this.key, JSON.stringify(payload))
    }

    /** @returns {any|null} */
    load() {
      const raw = localStorage.getItem(this.key)
      if (!raw) return null
      return JSON.parse(raw)
    }

    has() {
      return !!localStorage.getItem(this.key)
    }
  }

  SA.SessionStore = SessionStore
})(window.SpriteAnim)
