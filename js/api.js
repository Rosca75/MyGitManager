/**
 * api.js — GitHub REST API wrapper
 *
 * All GitHub API calls in the app MUST go through ghFetch().
 * This ensures:
 *  - Consistent Authorization header injection
 *  - Rate limit tracking on every response
 *  - ETag / If-None-Match conditional requests (saves rate limit on 304s)
 *  - Cache layer integration (check before fetch, store after)
 *  - Automatic pagination via Link headers
 *  - Consistent error handling (RateLimitError, ApiError)
 *  - Request queue: max 2 concurrent requests to avoid bursts
 *
 * Blueprint reference: §6.1 — Centralized Fetch Wrapper
 */
(function () {
  'use strict';

  window.App = window.App || {};

  // ─── Private state ─────────────────────────────────────────────────────

  /** PAT stored in memory only — never written to localStorage */
  let _token = null;

  /** Active request queue (Promise chain per slot) */
  const _queue = [Promise.resolve(), Promise.resolve()]; // 2 concurrent slots
  let _queueIndex = 0;

  // ─── Custom error classes ───────────────────────────────────────────────

  /**
   * Thrown when the API returns 403 with X-RateLimit-Remaining: 0.
   */
  class RateLimitError extends Error {
    /**
     * @param {number|string} resetTimestamp  Unix timestamp (seconds) when limit resets
     */
    constructor(resetTimestamp) {
      const resetDate = resetTimestamp
        ? new Date(Number(resetTimestamp) * 1000)
        : null;
      const msg = resetDate
        ? `Rate limit exceeded. Resets at ${resetDate.toLocaleTimeString()}`
        : 'Rate limit exceeded';
      super(msg);
      this.name = 'RateLimitError';
      this.resetAt = resetDate;
    }
  }

  /**
   * Thrown for all non-2xx responses that aren't rate limit errors.
   */
  class ApiError extends Error {
    /**
     * @param {number} status   HTTP status code
     * @param {object} body     Parsed JSON body (may be null)
     * @param {string} url      Request URL (for debugging)
     */
    constructor(status, body, url) {
      const msg = body?.message || `HTTP ${status}`;
      super(msg);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
      this.url = url;
    }
  }

  // ─── Token management ──────────────────────────────────────────────────

  /**
   * Store the PAT in memory.
   * @param {string} token
   */
  function setToken(token) {
    _token = token ? token.trim() : null;
  }

  /**
   * Clear the PAT from memory (e.g. on disconnect).
   */
  function clearToken() {
    _token = null;
  }

  /**
   * @returns {string|null}
   */
  function getToken() {
    return _token;
  }

  // ─── Rate limit helpers ─────────────────────────────────────────────────

  /**
   * Parse rate limit headers and push to State.
   * Called after every response from ghFetch.
   * @param {Headers} headers  Fetch response headers
   */
  function updateRateLimits(headers) {
    const remaining = headers.get('X-RateLimit-Remaining');
    const limit     = headers.get('X-RateLimit-Limit');
    const reset     = headers.get('X-RateLimit-Reset');
    const used      = headers.get('X-RateLimit-Used');

    if (remaining !== null) {
      const data = {
        remaining: parseInt(remaining, 10),
        limit:     parseInt(limit, 10) || 5000,
        reset:     reset ? new Date(parseInt(reset, 10) * 1000) : null,
        used:      used ? parseInt(used, 10) : null
      };
      // Avoid circular dependency — App.State is loaded before api.js
      if (window.App && window.App.State) {
        window.App.State.set('rateLimits', data);
      }
    }
  }

  // ─── Request queue ──────────────────────────────────────────────────────

  /**
   * Enqueue a fetch task in a round-robin slot.
   * Ensures max 2 concurrent requests to avoid API bursts.
   * @param {Function} task  Async function that performs the fetch
   * @returns {Promise}
   */
  function enqueue(task) {
    const slot = _queueIndex % _queue.length;
    _queueIndex++;
    // Chain onto the selected slot so tasks in that slot run sequentially
    const result = _queue[slot].then(() => task());
    // Store a "swallowed" version so the queue slot advances even on error
    _queue[slot] = result.catch(() => {});
    return result;
  }

  // ─── Operation log helper ───────────────────────────────────────────────

  /**
   * Append an entry to the operation log in State.
   * @param {string} method  HTTP verb
   * @param {string} url
   * @param {number} status  HTTP status code (0 = network error)
   * @param {number} ms      Round-trip duration in milliseconds
   */
  function logOperation(method, url, status, ms) {
    if (!window.App || !window.App.State) return;
    const log = window.App.State.get('operationLog') || [];
    // Cap log at 200 entries to avoid unbounded memory growth
    const entry = {
      time: new Date().toLocaleTimeString(),
      method: method.toUpperCase(),
      url,
      status,
      ms,
      ts: Date.now()
    };
    const updated = [entry, ...log].slice(0, 200);
    window.App.State.set('operationLog', updated);
  }

  // ─── Core fetch wrapper ─────────────────────────────────────────────────

  /**
   * Make an authenticated GitHub API request.
   *
   * @param {string} endpoint  Path like '/repos/owner/repo' or full URL
   * @param {object} [options]
   * @param {string}  [options.method]        HTTP verb (default: 'GET')
   * @param {object}  [options.body]          Request body (auto-stringified)
   * @param {object}  [options.headers]       Extra headers
   * @param {string}  [options.cacheKey]      Override cache key (default: endpoint)
   * @param {number}  [options.ttl]           Cache TTL in minutes (skip = no cache)
   * @param {boolean} [options.paginate]      Auto-follow Link headers (default: false)
   * @param {boolean} [options.skipCache]     Bypass cache for this request
   * @param {boolean} [options.skipQueue]     Skip the concurrency queue (for internal use)
   * @returns {Promise<object|object[]>}  Parsed JSON; array if paginate=true
   */
  async function ghFetch(endpoint, options = {}) {
    const task = () => _ghFetchSingle(endpoint, options);
    if (options.skipQueue) return task();
    return enqueue(task);
  }

  /**
   * Internal: actual fetch logic (no queuing).
   */
  async function _ghFetchSingle(endpoint, options = {}) {
    const {
      method = 'GET',
      body,
      headers: extraHeaders = {},
      cacheKey,
      ttl,
      paginate = false,
      skipCache = false
    } = options;

    const url = endpoint.startsWith('http')
      ? endpoint
      : `https://api.github.com${endpoint}`;

    // ── Cache check (GET-only) ────────────────────────────────────────────
    const ck = cacheKey || endpoint;
    let cached = null;

    if (method === 'GET' && !skipCache && window.App?.Cache) {
      cached = window.App.Cache.get(ck);
      if (cached && !cached.stale) {
        // Fresh cache hit — no network call needed
        return cached.value;
      }
    }

    // ── Build headers ─────────────────────────────────────────────────────
    const reqHeaders = {
      'Accept': 'application/vnd.github.v3+json',
      ...extraHeaders
    };

    // Inject token if available (public repos work without token but have lower rate limits)
    if (_token) {
      reqHeaders['Authorization'] = `token ${_token}`;
    }

    // Conditional request: if we have a stale cache entry with an ETag,
    // send If-None-Match — a 304 doesn't consume the response body.
    if (cached?.etag) {
      reqHeaders['If-None-Match'] = cached.etag;
    }

    const fetchOptions = {
      method,
      headers: reqHeaders
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
    }

    // ── Rate limit governor ───────────────────────────────────────────────
    // If remaining < 10, only allow cached-data reads
    const rateLimits = window.App?.State?.get('rateLimits');
    if (rateLimits && rateLimits.remaining < 10 && method === 'GET') {
      if (cached) {
        console.warn('[API] Rate limit critical — serving stale cache for:', url);
        return cached.value;
      }
      throw new RateLimitError(
        rateLimits.reset ? Math.floor(rateLimits.reset.getTime() / 1000) : null
      );
    }

    // ── Fetch ─────────────────────────────────────────────────────────────
    const startMs = Date.now();
    let response;

    try {
      response = await fetch(url, fetchOptions);
    } catch (networkErr) {
      // Network failure (offline, CORS, DNS)
      logOperation(method, url, 0, Date.now() - startMs);
      throw networkErr;
    }

    const durationMs = Date.now() - startMs;
    logOperation(method, url, response.status, durationMs);

    // Update rate limit display from response headers
    updateRateLimits(response.headers);

    // ── Handle 304 Not Modified ──────────────────────────────────────────
    if (response.status === 304) {
      // Refresh TTL on the cached entry so it stays alive
      if (cached && window.App?.Cache && ttl) {
        window.App.Cache.set(ck, cached.value, ttl, cached.etag);
      }
      return cached ? cached.value : null;
    }

    // ── Handle errors ─────────────────────────────────────────────────────
    if (!response.ok) {
      // Rate limit check
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get('X-RateLimit-Remaining');
        if (remaining === '0') {
          throw new RateLimitError(response.headers.get('X-RateLimit-Reset'));
        }
      }

      let errBody = null;
      try { errBody = await response.json(); } catch (_) {}
      throw new ApiError(response.status, errBody, url);
    }

    // ── Parse response ────────────────────────────────────────────────────
    // 204 No Content and DELETE responses have no body
    let data;
    if (response.status === 204 || method === 'DELETE') {
      data = null;
    } else {
      data = await response.json();
    }

    // ── Store in cache ────────────────────────────────────────────────────
    if (method === 'GET' && !skipCache && ttl && window.App?.Cache) {
      const etag = response.headers.get('ETag');
      window.App.Cache.set(ck, data, ttl, etag);
    }

    // ── Pagination ────────────────────────────────────────────────────────
    if (paginate && Array.isArray(data)) {
      const linkHeader = response.headers.get('Link');
      const nextUrl = parseLinkNext(linkHeader);
      if (nextUrl) {
        // Recursively fetch the next page and concatenate
        const nextPage = await ghFetch(nextUrl, {
          ...options,
          // Use full URL for next page — already absolute
          skipCache: true, // paginated results are assembled dynamically
          cacheKey: undefined
        });
        return data.concat(nextPage);
      }
    }

    return data;
  }

  /**
   * Parse GitHub's Link response header and return the 'next' URL, or null.
   * Format: <https://api.github.com/...?page=2>; rel="next", <...>; rel="last"
   * @param {string|null} linkHeader
   * @returns {string|null}
   */
  function parseLinkNext(linkHeader) {
    if (!linkHeader) return null;
    const parts = linkHeader.split(',');
    for (const part of parts) {
      const [urlPart, relPart] = part.split(';');
      if (relPart && relPart.trim() === 'rel="next"') {
        const match = urlPart.trim().match(/^<(.+)>$/);
        if (match) return match[1];
      }
    }
    return null;
  }

  // ─── High-level API methods ─────────────────────────────────────────────
  // These translate domain concepts to API calls and handle caching defaults.

  /**
   * Fetch repository metadata.
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<object>}
   */
  async function getRepo(owner, repo) {
    const endpoint = `/repos/${owner}/${repo}`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, 'repo');
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.REPO
    });
  }

  /**
   * Fetch all branches (auto-paginated).
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<object[]>}
   */
  async function getBranches(owner, repo) {
    const endpoint = `/repos/${owner}/${repo}/branches?per_page=100`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, 'branches');
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.BRANCHES,
      paginate: true
    });
  }

  /**
   * Fetch all tags (auto-paginated).
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<object[]>}
   */
  async function getTags(owner, repo) {
    const endpoint = `/repos/${owner}/${repo}/tags?per_page=100`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, 'tags');
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.TAGS,
      paginate: true
    });
  }

  /**
   * Fetch releases.
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<object[]>}
   */
  async function getReleases(owner, repo) {
    const endpoint = `/repos/${owner}/${repo}/releases?per_page=30`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, 'releases');
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.RELEASES,
      paginate: true
    });
  }

  /**
   * Compare two branches.
   * Returns { ahead_by, behind_by, commits, ... }
   * @param {string} owner
   * @param {string} repo
   * @param {string} base
   * @param {string} head
   * @returns {Promise<object>}
   */
  async function compareBranches(owner, repo, base, head) {
    // Encode branch names to handle slashes in names like 'feature/foo'
    const b = encodeURIComponent(base);
    const h = encodeURIComponent(head);
    const endpoint = `/repos/${owner}/${repo}/compare/${b}...${h}`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, `compare:${base}...${head}`);
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.BRANCHES
    });
  }

  /**
   * Get file/directory contents (for health checks).
   * @param {string} owner
   * @param {string} repo
   * @param {string} path  e.g. 'README.md' or '.github/workflows'
   * @param {string} [ref]  branch/tag/SHA (default: repo default branch)
   * @returns {Promise<object>}
   */
  async function getContents(owner, repo, path, ref) {
    let endpoint = `/repos/${owner}/${repo}/contents/${path}`;
    if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, `contents:${path}:${ref || ''}`);
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.CONTENTS
    });
  }

  /**
   * Fetch commit history for a branch (one page).
   * @param {string} owner
   * @param {string} repo
   * @param {string} branch
   * @param {number} [page=1]
   * @param {number} [perPage=20]
   * @returns {Promise<object[]>}
   */
  async function getCommits(owner, repo, branch, page = 1, perPage = 20) {
    const endpoint = `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}&page=${page}`;
    const C = window.App.Cache;
    const ck = C.keyFor(`${owner}/${repo}`, `commits:${branch}:p${page}`);
    return ghFetch(endpoint, {
      cacheKey: ck,
      ttl: C.TTL.COMMITS
    });
  }

  /**
   * Fetch current rate limit status.
   * @returns {Promise<object>}
   */
  async function getRateLimit() {
    return ghFetch('/rate_limit', {
      skipCache: true,
      skipQueue: true // rate limit checks should bypass the queue
    });
  }

  /**
   * Test READ access: fetch repo metadata.
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<{ ok: boolean, scopes: string[], data: object }>}
   */
  async function testReadAccess(owner, repo) {
    const endpoint = `/repos/${owner}/${repo}`;
    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers: {
        'Authorization': `token ${_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    updateRateLimits(response.headers);

    const scopeHeader = response.headers.get('X-OAuth-Scopes') || '';
    const scopes = scopeHeader.split(',').map(s => s.trim()).filter(Boolean);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: false, scopes, error: body.message || `HTTP ${response.status}`, status: response.status };
    }

    const data = await response.json();
    return { ok: true, scopes, data };
  }

  /**
   * Test WRITE access: create and immediately delete a test file.
   * Blueprint §3.9: PUT a temporary .git-insight-test file, then delete it.
   * @param {string} owner
   * @param {string} repo
   * @param {string} defaultBranch
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async function testWriteAccess(owner, repo, defaultBranch) {
    const path = '.git-insight-test';
    const endpoint = `/repos/${owner}/${repo}/contents/${path}`;
    const fullUrl = `https://api.github.com${endpoint}`;
    const headers = {
      'Authorization': `token ${_token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    // Create the test file
    let createRes;
    try {
      createRes = await fetch(fullUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: 'chore: connectivity test (auto-delete)',
          content: btoa(unescape(encodeURIComponent('Git Repo Insight connectivity test — safe to delete\n'))),
          branch: defaultBranch
        })
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      return { ok: false, error: body.message || `HTTP ${createRes.status}` };
    }

    // Get the SHA of the created file so we can delete it
    const created = await createRes.json();
    const sha = created?.content?.sha;

    if (!sha) {
      return { ok: false, error: 'Created file but could not get SHA for cleanup' };
    }

    // Delete the test file
    try {
      await fetch(fullUrl, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          message: 'chore: remove connectivity test file',
          sha,
          branch: defaultBranch
        })
      });
    } catch (_) {
      // Cleanup failure is non-critical — write access was confirmed
    }

    return { ok: true };
  }

  // ─── Expose public API ──────────────────────────────────────────────────

  window.App.API = {
    // Core wrapper
    ghFetch,

    // Token management
    setToken,
    clearToken,
    getToken,

    // Domain methods
    getRepo,
    getBranches,
    getTags,
    getReleases,
    compareBranches,
    getContents,
    getCommits,
    getRateLimit,
    testReadAccess,
    testWriteAccess,

    // Error classes (so callers can instanceof-check)
    RateLimitError,
    ApiError
  };

})();
