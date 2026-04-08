/**
 * semver.js — Semantic versioning parser and utilities
 *
 * Parses semver tags, compares versions, and suggests
 * the next version based on conventional commit analysis.
 *
 * Blueprint reference: §10 — Semantic Versioning Strategy
 */
(function () {
  'use strict';
  window.App = window.App || {};

  /** Parse "v1.2.3", "1.2.3", "v1.0.0-rc.1" into components. Returns null if invalid. */
  function parseSemver(tagName) {
    if (!tagName) return null;
    const m = tagName.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/);
    if (!m) return null;
    return {
      major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10),
      prerelease: m[4] || null, original: tagName.trim()
    };
  }

  /** Compare two parsed semver objects (descending: negative if a > b). */
  function compareSemver(a, b) {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    if (a.patch !== b.patch) return b.patch - a.patch;
    if (a.prerelease && !b.prerelease) return 1;
    if (!a.prerelease && b.prerelease) return -1;
    if (a.prerelease && b.prerelease) return a.prerelease.localeCompare(b.prerelease);
    return 0;
  }

  /** Return the highest semver tag from current state. */
  function getLatestVersion() {
    const tags = (App.State.get('tags') || []).filter(t => t.semver);
    if (tags.length === 0) return null;
    return { tag: tags[0], version: tags[0].semver };
  }

  /** Compute next version string for a given bump type. */
  function computeNextVersion(bumpType) {
    const v = getLatestVersion()?.version || { major: 0, minor: 0, patch: 0 };
    if (bumpType === 'major') return `v${v.major + 1}.0.0`;
    if (bumpType === 'minor') return `v${v.major}.${v.minor + 1}.0`;
    return `v${v.major}.${v.minor}.${v.patch + 1}`;
  }

  /** Analyze commits since last tag and suggest next version bump. */
  async function suggestNextVersion() {
    const rs = App.State.get('repo');
    if (!rs) return null;
    const { owner, repo, data } = rs;
    const branch = data?.default_branch || 'main';
    const latest = getLatestVersion();
    let commits = [];

    if (latest) {
      try {
        const cmp = await App.API.ghFetch(
          `/repos/${owner}/${repo}/compare/${encodeURIComponent(latest.tag.name)}...${encodeURIComponent(branch)}`,
          { ttl: 5 }
        );
        commits = cmp?.commits || [];
      } catch (_) { /* empty */ }
    } else {
      try { commits = await App.API.getCommits(owner, repo, branch, 1, 50); }
      catch (_) { /* empty */ }
    }
    return _analyzeBump(commits, latest);
  }

  /** Determine bump type from commit messages. */
  function _analyzeBump(commits, latest) {
    let hasBreaking = false, featCount = 0, fixCount = 0;
    commits.forEach(c => {
      const msg = c.commit?.message || '';
      const fl = msg.split('\n')[0];
      if (msg.includes('BREAKING CHANGE:') || msg.includes('BREAKING-CHANGE:') ||
          /^[a-z]+(\([^)]*\))?!:/.test(fl)) hasBreaking = true;
      if (/^feat(\([^)]*\))?[!]?:/.test(fl)) featCount++;
      if (/^fix(\([^)]*\))?[!]?:/.test(fl)) fixCount++;
    });

    const v = latest?.version || { major: 0, minor: 0, patch: 0 };
    let bump, reason, suggested;
    if (hasBreaking) {
      bump = 'major'; reason = 'BREAKING CHANGE detected';
      suggested = `v${v.major + 1}.0.0`;
    } else if (featCount > 0) {
      bump = 'minor'; reason = `${featCount} feat commit${featCount !== 1 ? 's' : ''} detected`;
      suggested = `v${v.major}.${v.minor + 1}.0`;
    } else {
      bump = 'patch';
      reason = fixCount > 0
        ? `${fixCount} fix commit${fixCount !== 1 ? 's' : ''} detected`
        : `${commits.length} commit${commits.length !== 1 ? 's' : ''} since last tag`;
      suggested = `v${v.major}.${v.minor}.${v.patch + 1}`;
    }
    return { suggested, reason, bump, commits };
  }

  window.App.Semver = { parseSemver, compareSemver, getLatestVersion, computeNextVersion, suggestNextVersion };
})();
