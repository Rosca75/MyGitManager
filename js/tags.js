/**
 * tags.js — Tag and release API operations
 *
 * Lists tags (resolving annotated details), creates/deletes tags,
 * and creates GitHub Releases via the API.
 *
 * Depends on: semver.js (App.Semver)
 * Blueprint reference: §3.4 — Tag & Release Management
 */
(function () {
  'use strict';
  window.App = window.App || {};

  /** Fetch all tags, resolve details, sort by semver descending. */
  async function listTags() {
    const rs = App.State.get('repo');
    if (!rs) return [];
    const { owner, repo } = rs;
    const rawTags = await App.API.getTags(owner, repo);
    if (!rawTags || rawTags.length === 0) return [];

    let releases = [];
    try { releases = await App.API.getReleases(owner, repo); } catch (_) {}
    const relMap = {};
    (releases || []).forEach(r => { if (r.tag_name) relMap[r.tag_name] = r; });

    const enriched = await _enrichTags(rawTags, owner, repo, relMap);
    enriched.sort((a, b) => {
      if (a.semver && b.semver) return App.Semver.compareSemver(a.semver, b.semver);
      if (a.semver && !b.semver) return -1;
      if (!a.semver && b.semver) return 1;
      return a.name.localeCompare(b.name);
    });

    App.State.set('tags', enriched);
    App.State.set('releases', releases || []);
    return enriched;
  }

  async function _enrichTags(rawTags, owner, repo, relMap) {
    const settled = await Promise.allSettled(
      rawTags.map(t => _enrichOne(t, owner, repo, relMap))
    );
    return settled.map((r, i) => r.status === 'fulfilled' ? r.value : _fallback(rawTags[i], relMap));
  }

  async function _enrichOne(tag, owner, repo, relMap) {
    let type = 'lightweight', tagger = null, message = null, date = null;
    const sha = tag.commit?.sha || null;

    if (tag.commit?.url) {
      try {
        const ref = await App.API.ghFetch(
          `/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag.name)}`, { ttl: 30 }
        );
        if (ref?.object?.type === 'tag') {
          type = 'annotated';
          const obj = await App.API.ghFetch(ref.object.url, { ttl: 30 });
          if (obj) { tagger = obj.tagger?.name; message = obj.message; date = obj.tagger?.date; }
        }
      } catch (_) {}
    }

    if (!date && sha) {
      try {
        const c = await App.API.ghFetch(`/repos/${owner}/${repo}/commits/${sha}`, { ttl: 30 });
        date = c?.commit?.author?.date || c?.commit?.committer?.date || null;
      } catch (_) {}
    }

    return { name: tag.name, sha, type, tagger, message, date,
      semver: App.Semver.parseSemver(tag.name), release: relMap[tag.name] || null };
  }

  function _fallback(raw, relMap) {
    return { name: raw.name, sha: raw.commit?.sha || null, type: 'lightweight',
      tagger: null, message: null, date: null,
      semver: App.Semver.parseSemver(raw.name), release: relMap[raw.name] || null };
  }

  function _repo() {
    const r = App.State.get('repo');
    if (!r) throw new Error('Not connected');
    return r;
  }

  /** Create a tag (lightweight or annotated if message provided). */
  async function createTag(name, sha, message, annotated) {
    const { owner, repo } = _repo();
    if (annotated && message) {
      const obj = await App.API.ghFetch(`/repos/${owner}/${repo}/git/tags`,
        { method: 'POST', body: { tag: name, message, object: sha, type: 'commit' }, skipCache: true });
      return App.API.ghFetch(`/repos/${owner}/${repo}/git/refs`,
        { method: 'POST', body: { ref: `refs/tags/${name}`, sha: obj.sha }, skipCache: true });
    }
    return App.API.ghFetch(`/repos/${owner}/${repo}/git/refs`,
      { method: 'POST', body: { ref: `refs/tags/${name}`, sha }, skipCache: true });
  }

  /** Delete a tag. */
  async function deleteTag(name) {
    const { owner, repo } = _repo();
    return App.API.ghFetch(`/repos/${owner}/${repo}/git/refs/tags/${encodeURIComponent(name)}`,
      { method: 'DELETE', skipCache: true });
  }

  /** Create a GitHub Release. */
  async function createRelease(tag, title, body, draft, prerelease) {
    const { owner, repo } = _repo();
    return App.API.ghFetch(`/repos/${owner}/${repo}/releases`,
      { method: 'POST', body: { tag_name: tag, name: title || tag, body: body || '',
        draft: !!draft, prerelease: !!prerelease }, skipCache: true });
  }

  window.App.Tags = {
    listTags, createTag, deleteTag, createRelease,
    parseSemver: (...a) => App.Semver.parseSemver(...a),
    compareSemver: (...a) => App.Semver.compareSemver(...a),
    getLatestVersion: () => App.Semver.getLatestVersion(),
    suggestNextVersion: () => App.Semver.suggestNextVersion(),
    computeNextVersion: (t) => App.Semver.computeNextVersion(t)
  };
})();
