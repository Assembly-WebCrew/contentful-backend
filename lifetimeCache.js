class LifetimeCache {

  constructor(defaultLifetime = 60000) {
    this.defaultLifetime = defaultLifetime;
    this._valueMap = new Map();
    this._timerMap = new Map();
  }

  has(key) {
    return this._valueMap.has(key);
  }

  get(key, defaultValue = undefined) {
    if (this._valueMap.has(key)) {
      return this._valueMap.get(key);
    }
    return defaultValue;
  }

  set(key, value, lifetime = undefined) {
    this._valueMap.set(key, value);
    lifetime = !!lifetime ? lifetime : this.defaultLifetime;
    this._setTimer(key, lifetime);
  }

  delete(key) {
    if (this._valueMap.has(key)) {
      this._valueMap.delete(key);
      this._clearTimer(key);
    }
  }

  _setTimer(key, lifetime) {
    this._clearTimer(key);
    this._timerMap.set(key, setTimeout(() => {
      if (this._valueMap.has(key)) {
        this._valueMap.delete(key)
      }
    }, lifetime));
  }

  _clearTimer(key) {
    if (this._timerMap.has(key)) {
      clearTimeout(this._timerMap.get(key));
    }
  }

}

module.exports = LifetimeCache;
