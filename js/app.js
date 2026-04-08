/**
 * app.js — Bootstrap and top-level orchestration
 *
 * Responsibilities:
 *  1. Wire all event listeners on DOMContentLoaded
 *  2. Drive the connect flow:
 *       validate inputs → testReadAccess → load repo metadata
 *       → populate Overview panel
 *  3. Render the API connectivity test panel
 *  4. Handle disconnect / reset
 *
 * All other panels are populated by their respective modules (Phase 2+).
 *
 * Blueprint reference: §14 Phase 1
 */
(function () {
  'use strict';

  // Ensure top-level namespace exists.
  // Other modules attach to window.App.{name}; this module owns window.App itself.
  window.App = window.App || {};

  // ─── Parse repo input ──────────────────────────────────────────────────

  /**
   * Parse a user-supplied repo identifier into { owner, repo }.
   * Accepts:
   *   - 'owner/repo'
   *   - 'https://github.com/owner/repo'
   *   - 'https://api.github.com/repos/owner/repo'
   * @param {string} input
   * @returns {{ owner: string, repo: string } | null}
   */
  function parseRepoInput(input) {
    if (!input) return null;
    const s = input.trim();

    // API URL format
    const apiMatch = s.match(/api\.github\.com\/repos\/([^/]+)\/([^/?\s]+)/);
    if (apiMatch) return { owner: apiMatch[1], repo: apiMatch[2] };

    // GitHub URL format
    const urlMatch = s.match(/github\.com\/([^/]+)\/([^/?\s#]+)/);
    if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };

    // owner/repo shorthand
    const shortMatch = s.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };

    return null;
  }

  // ─── Connect flow ──────────────────────────────────────────────────────

  /**
   * Main connect handler. Called when user clicks "Connect".
   */
  async function handleConnect() {
    const repoInput  = document.getElementById('repo-input');
    const patInput   = document.getElementById('pat-input');
    const connectBtn = document.getElementById('connect-btn');

    const rawRepo = repoInput?.value?.trim() || '';
    const rawPat  = patInput?.value?.trim()  || '';

    // ── Input validation ─────────────────────────────────────────────────
    const parsed = parseRepoInput(rawRepo);

    if (!parsed) {
      App.UI.showToast(
        'Invalid repository format. Use "owner/repo" or a GitHub URL.',
        'error'
      );
      repoInput?.focus();
      return;
    }

    if (!rawPat) {
      App.UI.showToast(
        'A Personal Access Token is required. Enter your PAT above.',
        'warning'
      );
      patInput?.focus();
      return;
    }

    const { owner, repo } = parsed;

    // ── Update UI to loading state ───────────────────────────────────────
    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.classList.add('btn--loading');
      connectBtn.textContent = '';
    }

    App.UI.showPanel('panel-overview');
    App.UI.showLoading('panel-overview', 6);

    // Store token (memory only)
    App.API.setToken(rawPat);

    try {
      // ── Step 1: Test READ access ────────────────────────────────────────
      const readResult = await App.API.testReadAccess(owner, repo);

      if (!readResult.ok) {
        let errMsg = `Cannot access repository: ${readResult.error}`;
        if (readResult.status === 401) {
          errMsg = 'Invalid token. Check your PAT is correct and not expired.';
        } else if (readResult.status === 403) {
          errMsg = 'Access denied. Your token may lack the "repo" scope.';
        } else if (readResult.status === 404) {
          errMsg = `Repository "${owner}/${repo}" not found. Check spelling and token scope.`;
        }

        App.UI.showToast(errMsg, 'error', 8000);
        resetConnectButton(connectBtn);
        App.API.clearToken();
        App.UI.showPanel('panel-overview');
        renderWelcome();
        return;
      }

      const repoData = readResult.data;

      // ── Step 2: Store in State ──────────────────────────────────────────
      App.State.set('repo', {
        owner,
        repo,
        data: repoData,
        scopes: readResult.scopes
      });

      // ── Step 3: Render Overview ─────────────────────────────────────────
      App.UI.renderRepoOverview(repoData);

      // Append connectivity section to overview
      renderConnectivityResults(repoData, readResult.scopes, readResult.scopesHeader, owner, repo);

      // Update sidebar counter badge if any data
      updateSidebarCounters();

      App.UI.showToast(`Connected to ${owner}/${repo}`, 'success');

      // Enable sidebar navigation
      enableSidebar();

      // ── Phase 2: Trigger branch loading ──────────────────────────────────
      // branches.js enriches each branch with last-commit data, computes
      // activity metrics (written to State), and updates the sidebar counter.
      // heatmap.js and health.js subscribe to currentPanel and self-activate.
      if (window.App.Branches) {
        App.Branches.loadBranches();
      }

    } catch (err) {
      let msg = `Connection failed: ${err.message}`;

      if (err instanceof App.API.RateLimitError) {
        msg = err.message;
        App.UI.showToast(msg, 'warning', 8000);
      } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
        // Network / CORS error
        msg = 'Network error. Check your internet connection. '
            + 'If running from file://, try serving via a local HTTP server.';
        App.UI.showToast(msg, 'error', 10000);
      } else {
        App.UI.showToast(msg, 'error');
      }

      App.API.clearToken();
      renderWelcome();
    } finally {
      resetConnectButton(connectBtn);
    }
  }

  function resetConnectButton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('btn--loading');
    btn.textContent = 'Connect';
  }

  // ─── Connectivity results panel ─────────────────────────────────────────

  /**
   * Append the API connectivity section to the overview panel.
   * Shows READ ✓, WRITE status, rate limit, and scopes.
   */
  async function renderConnectivityResults(repoData, scopes, scopesHeader, owner, repo) {
    const panel  = document.getElementById('panel-overview');
    if (!panel) return;
    const body   = panel.querySelector('.panel__body');
    if (!body) return;

    // Section divider
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.textContent = 'API Connectivity';
    body.appendChild(divider);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'connectivity-grid mb-5';
    body.appendChild(grid);

    // ── READ card (already confirmed) ─────────────────────────────────────
    addConnectivityCard(grid, 'READ Access', '✓ Confirmed', 'success',
      `GET /repos/${owner}/${repo}`);

    // ── Scope card ────────────────────────────────────────────────────────
    // Fine-grained PATs never send X-OAuth-Scopes (header is absent, scopesHeader === null).
    // Classic tokens always send it (possibly empty string if no scopes granted).
    // Only warn when we can confirm a classic token is missing the required scope.
    const isFineGrained = scopesHeader === null;
    const hasRepoScope  = scopes.includes('repo') || scopes.includes('public_repo');

    let scopeStatusText, scopeType, scopeDetail;
    if (isFineGrained) {
      scopeStatusText = 'Fine-grained token';
      scopeType       = 'primary';   // info-style blue — not a warning
      scopeDetail     = 'Permissions are resource-specific; X-OAuth-Scopes not applicable';
    } else if (hasRepoScope) {
      scopeStatusText = scopes.join(', ');
      scopeType       = 'success';
      scopeDetail     = 'Scopes sufficient';
    } else {
      scopeStatusText = scopes.length > 0 ? scopes.join(', ') : '(no scopes)';
      scopeType       = 'warning';
      scopeDetail     = 'Add "repo" scope (or "public_repo" for public repos) for full access';
    }

    addConnectivityCard(grid, 'Token Scopes', scopeStatusText, scopeType, scopeDetail);

    // ── Rate limit card ───────────────────────────────────────────────────
    const rateLimits = App.State.get('rateLimits');
    if (rateLimits) {
      addConnectivityCard(
        grid, 'Rate Limit',
        `${rateLimits.remaining.toLocaleString()} remaining`,
        rateLimits.remaining < 100 ? 'warning' : 'success',
        `of ${rateLimits.limit.toLocaleString()} total`
      );
    }

    // ── WRITE test (async) ─────────────────────────────────────────────────
    // Add placeholder card first, then update after test completes
    const writeCard = document.createElement('div');
    writeCard.className = 'connectivity-card';
    const writeLabel = document.createElement('div');
    writeLabel.className = 'connectivity-card__label';
    writeLabel.textContent = 'WRITE Access';
    const writeStatus = document.createElement('div');
    writeStatus.className = 'connectivity-card__status';
    const writeSpinner = document.createElement('span');
    writeSpinner.className = 'spinner spinner--sm';
    const writeStatusText = document.createElement('span');
    writeStatusText.textContent = 'Testing…';
    writeStatus.appendChild(writeSpinner);
    writeStatus.appendChild(writeStatusText);
    const writeDetail = document.createElement('div');
    writeDetail.className = 'connectivity-card__detail';
    writeDetail.textContent = 'Creating and deleting test file…';
    writeCard.appendChild(writeLabel);
    writeCard.appendChild(writeStatus);
    writeCard.appendChild(writeDetail);
    grid.appendChild(writeCard);

    // Only run write test if token likely has write scope
    try {
      const writeResult = await App.API.testWriteAccess(
        owner, repo, repoData.default_branch
      );

      // Clear spinner
      while (writeStatus.firstChild) writeStatus.removeChild(writeStatus.firstChild);

      const icon = document.createElement('span');
      icon.textContent = writeResult.ok ? '✓' : '✕';
      writeStatus.appendChild(icon);

      const txt = document.createElement('span');
      txt.textContent = writeResult.ok ? 'Confirmed' : `Failed: ${writeResult.error}`;
      writeStatus.appendChild(txt);

      writeDetail.textContent = writeResult.ok
        ? 'PUT + DELETE /contents/.git-insight-test'
        : writeResult.error || 'Insufficient permissions';

    } catch (err) {
      while (writeStatus.firstChild) writeStatus.removeChild(writeStatus.firstChild);
      const icon = document.createElement('span');
      icon.textContent = '✕';
      writeStatus.appendChild(icon);
      const txt = document.createElement('span');
      txt.textContent = 'Not available';
      writeStatus.appendChild(txt);
      writeDetail.textContent = err.message;
    }
  }

  /**
   * Add a connectivity card to a grid element.
   */
  function addConnectivityCard(grid, label, statusText, statusType, detail) {
    const card = document.createElement('div');
    card.className = 'connectivity-card';

    const lbl = document.createElement('div');
    lbl.className = 'connectivity-card__label';
    lbl.textContent = label;

    const status = document.createElement('div');
    status.className = 'connectivity-card__status';

    const icon = document.createElement('span');
    icon.textContent = statusType === 'success' ? '✓'
                     : statusType === 'warning'  ? '⚠'
                     : '✕';
    const txt = document.createElement('span');
    txt.textContent = statusText;
    status.appendChild(icon);
    status.appendChild(txt);

    const det = document.createElement('div');
    det.className = 'connectivity-card__detail';
    det.textContent = detail;

    card.appendChild(lbl);
    card.appendChild(status);
    card.appendChild(det);
    grid.appendChild(card);
  }

  // ─── Welcome state (before connect) ────────────────────────────────────

  /**
   * Render the welcome / empty state in the overview panel.
   */
  function renderWelcome() {
    App.UI.renderPanel('panel-overview', (body) => {
      // Security notice
      const notice = document.createElement('div');
      notice.className = 'security-notice';

      const noticeIcon = document.createElement('span');
      noticeIcon.setAttribute('aria-hidden', 'true');
      noticeIcon.textContent = 'ℹ';

      const noticeText = document.createElement('span');
      noticeText.textContent =
        'Your Personal Access Token is stored in memory only and is never '
        + 'saved to disk, cookies, or localStorage. It is cleared on page refresh.';

      notice.appendChild(noticeIcon);
      notice.appendChild(noticeText);
      body.appendChild(notice);

      // Empty state
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';

      const svgIcon = createGitHubIcon();
      svgIcon.className = 'empty-state__icon';
      emptyState.appendChild(svgIcon);

      const title = document.createElement('h2');
      title.className = 'empty-state__title';
      title.textContent = 'Connect to a GitHub Repository';

      const desc = document.createElement('p');
      desc.className = 'empty-state__description';
      desc.textContent =
        'Enter a repository (e.g. "owner/repo") and your Personal Access Token '
        + 'above, then click Connect to load the dashboard.';

      const hint = document.createElement('p');
      hint.className = 'empty-state__description text-xs';
      hint.textContent =
        'Required token scopes: repo (for private repos) or public_repo (for public repos only). '
        + 'Create a fine-grained token at github.com/settings/tokens.';

      emptyState.appendChild(title);
      emptyState.appendChild(desc);
      emptyState.appendChild(hint);
      body.appendChild(emptyState);
    });
  }

  /**
   * Create a simple GitHub-style octicon SVG for the empty state.
   * Inline SVG avoids external asset dependency.
   * @returns {SVGElement}
   */
  function createGitHubIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '48');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // GitHub octocat mark simplified path
    path.setAttribute('d',
      'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 '
      + '0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13'
      + '-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66'
      + '.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15'
      + '-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27'
      + '.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12'
      + '.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 '
      + '0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'
    );
    svg.appendChild(path);
    return svg;
  }

  // ─── Sidebar state management ───────────────────────────────────────────

  /**
   * After a successful connect, make sidebar items navigable.
   */
  function enableSidebar() {
    document.querySelectorAll('.sidebar-nav__item').forEach(item => {
      item.removeAttribute('disabled');
      item.style.opacity = '';
      item.style.pointerEvents = '';
    });
  }

  /**
   * Before connect, dim non-overview sidebar items.
   */
  function disableSidebar() {
    document.querySelectorAll('.sidebar-nav__item').forEach(item => {
      const panelId = item.getAttribute('data-panel');
      if (panelId !== 'panel-overview') {
        item.style.opacity = '0.4';
        item.style.pointerEvents = 'none';
      }
    });
  }

  /**
   * Update sidebar nav counter badges from state.
   */
  function updateSidebarCounters() {
    const repo = App.State.get('repo');
    if (!repo?.data) return;

    // We'll update these as phases load actual data
    // For now just clear the placeholder counts
    const branchCount = document.getElementById('nav-count-branches');
    if (branchCount) branchCount.textContent = '';
  }

  // ─── PAT file input ──────────────────────────────────────────────────────

  /**
   * Load PAT from a text file selected via file input.
   * Reads only the first line (token), strips whitespace.
   */
  function handlePatFileLoad(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result || '';
      const token = text.split('\n')[0].trim();
      const patInput = document.getElementById('pat-input');
      if (patInput && token) {
        patInput.value = token;
        App.UI.showToast('Token loaded from file', 'success');
      } else {
        App.UI.showToast('File appears empty. No token loaded.', 'warning');
      }
    };
    reader.onerror = () => {
      App.UI.showToast('Error reading file', 'error');
    };
    reader.readAsText(file);

    // Reset file input so the same file can be re-selected if needed
    event.target.value = '';
  }

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────

  /**
   * Wire global keyboard shortcuts.
   */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + Enter = Connect
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleConnect();
      }
    });
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────

  /**
   * Entry point — called once DOM is ready.
   */
  function init() {
    // Apply stored theme preference before rendering anything
    App.UI.applyStoredTheme();

    // Wire navigation
    App.UI.initNavigation();
    App.UI.initThemeToggle();
    App.UI.initRateLimitDisplay();
    App.UI.initOpLog();

    // Subscribe to activityMetrics — renders the Branch Activity section
    // in the Overview panel whenever branches.js updates the data.
    App.State.subscribe('activityMetrics', renderActivityMetrics);

    // Wire connect button
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', handleConnect);
    }

    // Wire repo input: Enter key triggers connect
    const repoInput = document.getElementById('repo-input');
    if (repoInput) {
      repoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleConnect();
      });
    }

    // Wire PAT input: Enter key triggers connect
    const patInput = document.getElementById('pat-input');
    if (patInput) {
      patInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleConnect();
      });
    }

    // Wire PAT file input
    const patFile = document.getElementById('pat-file');
    if (patFile) {
      patFile.addEventListener('change', handlePatFileLoad);
    }

    // Wire PAT file button (label click triggers hidden file input)
    // No additional handler needed — the <label for="pat-file"> handles it

    // Global keyboard shortcuts
    initKeyboardShortcuts();

    // Disable sidebar until connected
    disableSidebar();

    // Show overview panel with welcome state
    App.UI.showPanel('panel-overview');
    renderWelcome();

    // Clear stale cache entries on startup
    if (window.App?.Cache) {
      App.Cache.clearStale();
    }

    console.log('[App] Git Repo Insight initialized');
  }

  // Wait for DOM before bootstrapping
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOMContentLoaded already fired (script is deferred or at bottom of body)
    init();
  }

  // ─── Activity metrics for Overview panel ────────────────────────────────────

  /**
   * Append (or replace) the activity metrics section in the Overview panel.
   * Subscribed to the 'activityMetrics' State key; called whenever
   * branches.js computes or updates metrics.
   * @param {{ totalBranches, staleBranches, latestCommit, mostActiveBranch }} metrics
   */
  function renderActivityMetrics(metrics) {
    if (!metrics) return;

    // Only append to Overview if it is currently showing a connected repo
    const repoState = App.State.get('repo');
    if (!repoState) return;

    const panel = document.getElementById('panel-overview');
    if (!panel) return;
    const body = panel.querySelector('.panel__body');
    if (!body) return;

    // Remove stale section if present
    const existing = document.getElementById('overview-activity-section');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.id = 'overview-activity-section';

    // Section divider
    const divider = document.createElement('div');
    divider.className   = 'section-divider';
    divider.textContent = 'Branch Activity';
    section.appendChild(divider);

    // Metrics grid
    const grid = document.createElement('div');
    grid.className = 'activity-grid';

    const metricItems = [
      {
        label: 'Total Branches',
        value: String(metrics.totalBranches ?? '—')
      },
      {
        label: 'Stale Branches',
        value: String(metrics.staleBranches ?? '—'),
        note:  'no commits in 90+ days'
      },
      {
        label: 'Most Active Branch',
        value: metrics.mostActiveBranch
          ? _truncateName(metrics.mostActiveBranch, 22)
          : '—',
        mono:  true
      },
      {
        label: 'Last Commit (any branch)',
        value: metrics.latestCommit
          ? App.UI.formatRelativeDate(metrics.latestCommit.date)
          : '—',
        note: metrics.latestCommit
          ? _truncateName(metrics.latestCommit.branch, 28)
          : null
      }
    ];

    metricItems.forEach(({ label, value, note, mono }) => {
      const card = document.createElement('div');
      card.className = 'activity-metric';

      const valEl = document.createElement('div');
      valEl.className   = 'activity-metric__value' + (mono ? ' mono' : '');
      valEl.textContent = value;
      if (value.length > 14) {
        // Use smaller font for long names
        valEl.style.fontSize = 'var(--font-size-sm)';
        valEl.style.wordBreak = 'break-all';
      }
      card.appendChild(valEl);

      const lblEl = document.createElement('div');
      lblEl.className   = 'activity-metric__label';
      lblEl.textContent = label;
      card.appendChild(lblEl);

      if (note) {
        const noteEl = document.createElement('div');
        noteEl.className   = 'activity-metric__note';
        noteEl.textContent = note;
        card.appendChild(noteEl);
      }

      grid.appendChild(card);
    });

    section.appendChild(grid);
    body.appendChild(section);
  }

  /** Truncate a branch name in the middle for display */
  function _truncateName(name, max) {
    if (!name) return '—';
    if (name.length <= max) return name;
    const half = Math.floor((max - 1) / 2);
    return name.slice(0, half) + '…' + name.slice(-half);
  }

  // Expose top-level utilities
  window.App.parseRepoInput = parseRepoInput;

})();
