/**
 * health.js — Repository Health Checker
 *
 * Checks for the presence of key community / maintenance files and
 * computes a health score (0–100%). Files are fetched via getContents()
 * in a single batched round — one API call per file / directory.
 *
 * Health score = (present or optional present) / total required × 100.
 * Required files count toward the denominator; optional files are
 * displayed but do not penalise the score.
 *
 * Blueprint reference: §3.5 — Repository Health Dashboard
 */
(function () {
  'use strict';

  window.App = window.App || {};

  // ─── Health file manifest ────────────────────────────────────────────────────

  /**
   * Each entry defines a file / directory to check.
   * @type {Array<{
   *   path: string,
   *   label: string,
   *   required: boolean,   // false = optional; doesn't penalise score
   *   dir: boolean,        // true = check directory listing
   *   licenseDetect: boolean  // true = try to read license type from content
   * }>}
   */
  const HEALTH_FILES = [
    { path: 'README.md',                          label: 'README.md',                 required: true,  dir: false, licenseDetect: false },
    { path: 'LICENSE',                            label: 'LICENSE',                   required: true,  dir: false, licenseDetect: true  },
    { path: '.gitignore',                         label: '.gitignore',                required: true,  dir: false, licenseDetect: false },
    { path: 'CONTRIBUTING.md',                    label: 'CONTRIBUTING.md',           required: false, dir: false, licenseDetect: false },
    { path: 'CODE_OF_CONDUCT.md',                 label: 'CODE_OF_CONDUCT.md',        required: false, dir: false, licenseDetect: false },
    { path: 'CHANGELOG.md',                       label: 'CHANGELOG.md',              required: false, dir: false, licenseDetect: false },
    { path: 'SECURITY.md',                        label: 'SECURITY.md',               required: false, dir: false, licenseDetect: false },
    { path: '.github/workflows',                  label: '.github/workflows/ (CI/CD)',required: false, dir: true,  licenseDetect: false },
    { path: '.github/CODEOWNERS',                 label: '.github/CODEOWNERS',        required: false, dir: false, licenseDetect: false },
    { path: '.github/ISSUE_TEMPLATE',             label: '.github/ISSUE_TEMPLATE/',   required: false, dir: true,  licenseDetect: false },
    { path: '.github/PULL_REQUEST_TEMPLATE.md',   label: '.github/PULL_REQUEST_TEMPLATE.md', required: false, dir: false, licenseDetect: false },
    { path: '.github/dependabot.yml',             label: '.github/dependabot.yml',    required: false, dir: false, licenseDetect: false },
    { path: 'CLAUDE.md',                          label: 'CLAUDE.md (AI guidance)',   required: false, dir: false, licenseDetect: false }
  ];

  // ─── License keyword detection ───────────────────────────────────────────────

  /**
   * Scan decoded license text for common license identifiers.
   * Returns a short label like "MIT", "Apache-2.0", etc., or null.
   * @param {string} text
   * @returns {string|null}
   */
  function _detectLicenseType(text) {
    const t = text.toLowerCase();
    if (t.includes('mit license') || t.includes('permission is hereby granted'))  return 'MIT';
    if (t.includes('apache license') && t.includes('2.0'))                        return 'Apache-2.0';
    if (t.includes('gnu general public license') && t.includes('version 3'))      return 'GPL-3.0';
    if (t.includes('gnu general public license') && t.includes('version 2'))      return 'GPL-2.0';
    if (t.includes('gnu lesser general public license'))                          return 'LGPL';
    if (t.includes('mozilla public license'))                                     return 'MPL-2.0';
    if (t.includes('bsd 2-clause') || t.includes('simplified bsd'))              return 'BSD-2-Clause';
    if (t.includes('bsd 3-clause') || t.includes('new bsd'))                     return 'BSD-3-Clause';
    if (t.includes('isc license') || t.includes('permission to use, copy'))       return 'ISC';
    if (t.includes('creative commons'))                                           return 'Creative Commons';
    if (t.includes('unlicense') || t.includes('this is free and unencumbered'))   return 'Unlicense';
    return null;
  }

  /**
   * Decode base64 content returned by the GitHub contents API.
   * @param {string} encoded  base64 string (may have newlines)
   * @returns {string}
   */
  function _decodeBase64(encoded) {
    try {
      return atob(encoded.replace(/\n/g, ''));
    } catch (_) {
      return '';
    }
  }

  // ─── Panel activation ────────────────────────────────────────────────────────

  /**
   * Called when the user navigates to the Health panel.
   */
  async function onPanelActivate() {
    const repoState = App.State.get('repo');
    if (!repoState) {
      App.UI.renderPanel('panel-health', (body) => {
        const msg = document.createElement('p');
        msg.className   = 'empty-state__description';
        msg.textContent = 'Connect to a repository to run a health check.';
        body.appendChild(msg);
      });
      return;
    }

    await _runHealthCheck(repoState.owner, repoState.repo);
  }

  // Auto-subscribe to panel navigation
  if (window.App.State) {
    window.App.State.subscribe('currentPanel', (panelId) => {
      if (panelId === 'panel-health') onPanelActivate();
    });
  }

  // ─── Health check ────────────────────────────────────────────────────────────

  /**
   * Fetch all health files in parallel and render results.
   * @param {string} owner
   * @param {string} repo
   */
  async function _runHealthCheck(owner, repo) {
    // Show loading state
    App.UI.showLoading('panel-health', HEALTH_FILES.length);

    // Fetch each file / directory
    const results = await Promise.allSettled(
      HEALTH_FILES.map(async (file) => {
        try {
          const data = await App.API.getContents(owner, repo, file.path);

          let detail  = null;
          let present = true;

          // For directories, presence = non-empty array returned
          if (file.dir) {
            present = Array.isArray(data) && data.length > 0;
            detail  = present ? `${data.length} file${data.length !== 1 ? 's' : ''}` : null;
          } else if (file.licenseDetect && data?.content) {
            // Try to detect license type
            const decoded = _decodeBase64(data.content);
            const licType = _detectLicenseType(decoded);
            detail = licType || 'Unknown license type';
          }

          return { ...file, present, detail, status: present ? 'present' : 'missing' };

        } catch (err) {
          // 404 = file not present; anything else = unable to check
          const isNotFound = err?.status === 404 || err?.message?.includes('404')
            || (err?.name === 'ApiError' && err?.status === 404);

          return {
            ...file,
            present: false,
            detail:  null,
            status:  isNotFound ? 'missing' : 'error'
          };
        }
      })
    );

    // Extract values (Promise.allSettled always resolves)
    const items = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ...HEALTH_FILES[i], present: false, status: 'error', detail: null }
    );

    // Compute health score: required files only
    const required = items.filter(i => i.required);
    const presentRequired = required.filter(i => i.present);
    const score = required.length > 0
      ? Math.round((presentRequired.length / required.length) * 100)
      : 100;

    // Store in state for export
    App.State.set('healthReport', { items, score });

    // Render the panel
    _renderHealthPanel(items, score);
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  /**
   * Render the Health panel with a score ring and checklist.
   * @param {object[]} items  Resolved health items
   * @param {number}   score  0–100 health score
   */
  function _renderHealthPanel(items, score) {
    App.UI.renderPanel('panel-health', (body) => {
      // ── Score section ──────────────────────────────────────────────────────
      const scoreSection = document.createElement('div');
      scoreSection.className = 'health-score-section';

      // SVG ring indicator
      const ringSize = 72;
      const ringR    = 28;
      const circ     = 2 * Math.PI * ringR;
      const dash     = (score / 100) * circ;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width',  String(ringSize));
      svg.setAttribute('height', String(ringSize));
      svg.setAttribute('viewBox', `0 0 ${ringSize} ${ringSize}`);
      svg.setAttribute('aria-label', `Health score: ${score}%`);
      svg.className = 'health-score-ring';

      // Background circle
      const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bgCircle.setAttribute('cx', String(ringSize / 2));
      bgCircle.setAttribute('cy', String(ringSize / 2));
      bgCircle.setAttribute('r',  String(ringR));
      bgCircle.setAttribute('fill',   'none');
      bgCircle.setAttribute('stroke', 'var(--color-bg-tertiary)');
      bgCircle.setAttribute('stroke-width', '6');
      svg.appendChild(bgCircle);

      // Score arc
      const scoreColor = score >= 80 ? 'var(--color-success)'
                       : score >= 60 ? 'var(--color-accent)'
                       : score >= 40 ? 'var(--color-warning)'
                       :               'var(--color-danger)';

      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      arc.setAttribute('cx', String(ringSize / 2));
      arc.setAttribute('cy', String(ringSize / 2));
      arc.setAttribute('r',  String(ringR));
      arc.setAttribute('fill',             'none');
      arc.setAttribute('stroke',           scoreColor);
      arc.setAttribute('stroke-width',     '6');
      arc.setAttribute('stroke-linecap',   'round');
      arc.setAttribute('stroke-dasharray', `${dash} ${circ}`);
      // Start at the top (−90°)
      arc.setAttribute('transform', `rotate(-90 ${ringSize / 2} ${ringSize / 2})`);
      svg.appendChild(arc);

      // Center percentage text
      const scoreLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      scoreLabel.setAttribute('x',             String(ringSize / 2));
      scoreLabel.setAttribute('y',             String(ringSize / 2 + 5));
      scoreLabel.setAttribute('text-anchor',   'middle');
      scoreLabel.setAttribute('font-size',     '14');
      scoreLabel.setAttribute('font-weight',   '700');
      scoreLabel.setAttribute('fill',          scoreColor);
      scoreLabel.setAttribute('font-family',   '-apple-system, sans-serif');
      scoreLabel.textContent = `${score}%`;
      svg.appendChild(scoreLabel);

      scoreSection.appendChild(svg);

      // Score text
      const scoreText = document.createElement('div');
      scoreText.className = 'health-score-text';

      const scoreNum = document.createElement('div');
      const numClass = score >= 80 ? 'excellent'
                     : score >= 60 ? 'good'
                     : score >= 40 ? 'fair'
                     :               'poor';
      scoreNum.className   = `health-score-number health-score-number--${numClass}`;
      scoreNum.textContent = `${score}%`;

      const scoreDesc = document.createElement('div');
      scoreDesc.className   = 'health-score-label';
      scoreDesc.textContent = score >= 80 ? 'Repository health: Excellent'
                            : score >= 60 ? 'Repository health: Good'
                            : score >= 40 ? 'Repository health: Fair'
                            :               'Repository health: Needs attention';

      const required = items.filter(i => i.required);
      const present  = required.filter(i => i.present);
      const scoreSub = document.createElement('div');
      scoreSub.className   = 'health-score-label';
      scoreSub.textContent = `${present.length} / ${required.length} required files present`;

      scoreText.appendChild(scoreNum);
      scoreText.appendChild(scoreDesc);
      scoreText.appendChild(scoreSub);
      scoreSection.appendChild(scoreText);

      body.appendChild(scoreSection);

      // ── Checklist ──────────────────────────────────────────────────────────
      const checklist = document.createElement('div');
      checklist.className = 'health-checklist';

      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'health-item health-item--'
          + (item.present ? 'present'
             : item.required ? 'missing'
             : 'warning');

        // Icon
        const icon = document.createElement('div');
        icon.className   = 'health-item__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = item.present ? '✓'
                         : item.required ? '✗'
                         : '○';
        row.appendChild(icon);

        // Name + optional detail
        const nameWrap = document.createElement('div');

        const name = document.createElement('div');
        name.className   = 'health-item__name';
        name.textContent = item.label;
        nameWrap.appendChild(name);

        if (item.detail) {
          const detail = document.createElement('div');
          detail.className   = 'health-item__detail';
          detail.textContent = item.detail;
          nameWrap.appendChild(detail);
        } else if (!item.present && !item.required) {
          const hint = document.createElement('div');
          hint.className   = 'health-item__detail';
          hint.textContent = 'Optional — recommended for open source projects';
          nameWrap.appendChild(hint);
        }

        row.appendChild(nameWrap);

        // Status label
        const status = document.createElement('div');
        status.className   = 'health-item__status';
        status.textContent = item.present    ? 'Present'
                           : item.required   ? 'Missing'
                           : item.status === 'error' ? 'Error'
                           :                  'Not found';
        row.appendChild(status);

        checklist.appendChild(row);
      });

      body.appendChild(checklist);
    });
  }

  // ─── Expose public API ───────────────────────────────────────────────────────

  window.App.Health = {
    onPanelActivate,
    /** Force a fresh health check (bypasses cached results). */
    refresh: () => {
      const repoState = App.State.get('repo');
      if (repoState) _runHealthCheck(repoState.owner, repoState.repo);
    }
  };

})();
