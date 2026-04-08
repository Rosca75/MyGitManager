/**
 * cache.js — localStorage cache layer with TTL
 *
 * Why: The GitHub API has a rate limit of 5000 req/hour for authenticated
 * requests. Caching avoids redundant calls when data hasn't changed.
 * ETag-based conditional requests (If-None-Match) allow us to "check"
 * freshness cheaply — a 304 Not Modified doesn't count against rate limit
 * in the same way, and we still serve cached data.
 *
 * TTL defaults (from blueprint §6.3):
 *   - branches:  5 minutes  (volatile)
 *   - tags:      30 minutes (semi-stable)
 *   - releases:  30 minutes (semi-stable)
 *   - repo:      10 minutes
 *
 * Storage format: JSON with { value, expiresAt, etag? }
 *
 * Note: Token is NEVER stored in cache. Only API response data.
 */
(function () {
  'use strict';

  window.App = window.App || {};

  // Prefix all keys to avoid colliding with other apps on the same origin
  const CACHE_PREFIX = 'gri_cache_';

  /**
   * Build the full localStorage key.
   * @param {string} key
   * @returns {string}
   */
  function storageKey(key) {
    return CACHE_PREFIX + key;
  }

  /**
   * Retrieve a cached value. Returns null if missing or expired.
   * Also returns the stored ETag so callers can send If-None-Match.
   * @param {string} key
   * @returns {{ value: *, etag: string|null } | null}
   */
  function cacheGet(key) {
    let raw;
    try {
      raw = localStorage.getItem(storageKey(key));
    } catch (_) {
      // localStorage can throw in private browsing / quota exceeded
      return null;
    }

    if (!raw) return null;

    let entry;
    try {
      entry = JSON.parse(raw);
    } catch (_) {
      // Corrupt data — remove it
      cacheInvalidate(key);
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      // Expired but keep it around so we can send If-None-Match.
      // Caller decides whether to serve stale data on network failure.
      return { value: entry.value, etag: entry.etag || null, stale: true };
    }

    return { value: entry.value, etag: entry.etag || null, stale: false };
  }

  /**
   * Store a value in cache with a TTL.
   * @param {string} key
   * @param {*} value          The data to store (must be JSON-serialisable)
   * @param {number} ttlMinutes  Minutes until expiry (default: 5)
   * @param {string} [etag]    ETag header value from the API response
   */
  function cacheSet(key, value, ttlMinutes = 5, etag = null) {
    const entry = {
      value,
      expiresAt: Date.now() + ttlMinutes * 60 * 1000,
      etag,
      cachedAt: Date.now()
    };

    try {
      localStorage.setItem(storageKey(key), JSON.stringify(entry));
    } catch (err) {
      // Storage quota exceeded — attempt to clear old entries and retry once
      if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        console.warn('[Cache] Quota exceeded — clearing old entries');
        cacheClearStale();
        try {
          localStorage.setItem(storageKey(key), JSON.stringify(entry));
        } catch (_) {
          console.error('[Cache] Still cannot write after clearing stale entries');
        }
      }
    }
  }

  /**
   * Remove a specific cache entry.
   * @param {string} key
   */
  function cacheInvalidate(key) {
    try {
      localStorage.removeItem(storageKey(key));
    } catch (_) { /* ignore */ }
  }

  /**
   * Remove all cache entries created by this app.
   */
  function cacheClear() {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
  }

  /**
   * Remove only expired cache entries (free up space without losing fresh data).
   */
  function cacheClearStale() {
    try {
      const toRemove = [];
      const now = Date.now();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(CACHE_PREFIX)) continue;
        try {
          const entry = JSON.parse(localStorage.getItem(k));
          if (entry && entry.expiresAt < now) toRemove.push(k);
        } catch (_) {
          toRemove.push(k); // corrupt — remove it
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
  }

  /**
   * Build a namespaced cache key for a GitHub endpoint.
   * Example: cacheKeyFor('owner/repo', '/branches') → 'owner/repo:/branches'
   * @param {string} repo  'owner/repo'
   * @param {string} path  API path or logical identifier
   * @returns {string}
   */
  function cacheKeyFor(repo, path) {
    return `${repo}:${path}`;
  }

  // Default TTLs exposed so api.js can reference them without magic numbers
  const TTL = {
    REPO:      10,   // repository metadata
    BRANCHES:   5,   // branch list — changes often
    TAGS:      30,   // tags — relatively stable
    RELEASES:  30,   // releases — relatively stable
    COMMITS:    5,   // recent commits
    CONTENTS:  15,   // file existence checks
    RATE_LIMIT: 1    // rate limit — checked frequently
  };

  // Expose public API
  window.App.Cache = {
    get:         cacheGet,
    set:         cacheSet,
    invalidate:  cacheInvalidate,
    clear:       cacheClear,
    clearStale:  cacheClearStale,
    keyFor:      cacheKeyFor,
    TTL
  };

})();
