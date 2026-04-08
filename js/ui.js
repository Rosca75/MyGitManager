/**
 * ui.js — DOM rendering helpers and navigation
 *
 * Why: Centralizing DOM manipulation prevents scattered innerHTML
 * calls and enforces the "no innerHTML with dynamic data" rule.
 * All helpers here use textContent or the DOM API for dynamic content.
 *
 * Provides:
 *  - renderPanel(panelId, contentFn)
 *  - showToast(message, type)
 *  - showLoading(panelId) / hideLoading(panelId)
 *  - formatDate(iso) / formatRelativeDate(iso)
 *  - createBadge(text, type)
 *  - createTable(headers, rows)
 *  - Sidebar navigation click handlers
 *  - Theme toggle handler
 *  - Rate limit display updates
 */
(function () {
  'use strict';

  window.App = window.App || {};

  // ─── Date formatting ────────────────────────────────────────────────────

  /**
   * Format an ISO date string for display.
   * @param {string|null} iso   ISO 8601 string
   * @returns {string}
   */
  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  /**
   * Format an ISO date as a relative human-readable string.
   * e.g. "3 days ago", "2 months ago"
   * @param {string|null} iso
   * @returns {string}
   */
  function formatRelativeDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;

    const diffMs   = Date.now() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs  = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);
    const diffMos  = Math.floor(diffDays / 30);
    const diffYrs  = Math.floor(diffDays / 365);

    if (diffMins < 1)   return 'just now';
    if (diffMins < 60)  return `${diffMins}m ago`;
    if (diffHrs  < 24)  return `${diffHrs}h ago`;
    if (diffDays < 30)  return `${diffDays}d ago`;
    if (diffMos  < 12)  return `${diffMos} month${diffMos !== 1 ? 's' : ''} ago`;
    return `${diffYrs} year${diffYrs !== 1 ? 's' : ''} ago`;
  }

  /**
   * Return a number of days since a date.
   * @param {string|null} iso
   * @returns {number}
   */
  function daysSince(iso) {
    if (!iso) return Infinity;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  // ─── Badge creation ─────────────────────────────────────────────────────

  /**
   * Create a <span> badge element.
   * @param {string} text
   * @param {string} [type]  'default' | 'stale' | 'active' | 'merged' | 'protected' | 'primary' | 'success' | 'danger'
   * @returns {HTMLSpanElement}
   */
  function createBadge(text, type = 'default') {
    const span = document.createElement('span');
    span.className = `badge badge--${type}`;
    span.textContent = text;
    return span;
  }

  /**
   * Create a commit-type pill element.
   * @param {string} type  e.g. 'feat', 'fix', 'docs'
   * @returns {HTMLSpanElement}
   */
  function createPill(type) {
    const span = document.createElement('span');
    span.className = `pill pill--${type}`;
    span.textContent = type;
    return span;
  }

  // ─── Table creation ─────────────────────────────────────────────────────

  /**
   * Create a <table> element from headers and row data.
   * Cells with a `html: false` flag use textContent (safe default).
   * Cells can be strings, numbers, or DOM nodes.
   *
   * @param {string[]} headers        Column header labels
   * @param {Array<Array<*>>} rows    Array of rows; each row is an array of cell values
   * @param {object} [options]
   * @param {string[]} [options.cellClasses]  Per-column extra CSS class
   * @returns {HTMLDivElement}  Wrapper div with .table-wrapper > table.data-table
   */
  function createTable(headers, rows, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';

    const table = document.createElement('table');
    table.className = 'data-table';

    // Header row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      row.forEach((cell, colIdx) => {
        const td = document.createElement('td');
        if (options.cellClasses?.[colIdx]) {
          td.className = options.cellClasses[colIdx];
        }
        if (cell instanceof Node) {
          td.appendChild(cell);
        } else if (cell === null || cell === undefined) {
          td.textContent = '—';
        } else {
          td.textContent = String(cell);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrapper.appendChild(table);
    return wrapper;
  }

  // ─── Panel helpers ──────────────────────────────────────────────────────

  /**
   * Render a panel's content by calling contentFn with the panel element.
   * Clears existing content first.
   * @param {string} panelId       The panel's id attribute
   * @param {Function} contentFn   Called with (panelBodyEl) to populate it
   */
  function renderPanel(panelId, contentFn) {
    const panel = document.getElementById(panelId);
    if (!panel) {
      console.warn(`[UI] Panel not found: #${panelId}`);
      return;
    }
    const body = panel.querySelector('.panel__body');
    if (!body) return;

    // Clear existing content safely
    while (body.firstChild) body.removeChild(body.firstChild);

    try {
      contentFn(body);
    } catch (err) {
      console.error(`[UI] renderPanel error in #${panelId}:`, err);
      const errMsg = document.createElement('p');
      errMsg.className = 'text-muted text-sm';
      errMsg.textContent = `Error rendering panel: ${err.message}`;
      body.appendChild(errMsg);
    }
  }

  /**
   * Show a loading skeleton inside a panel body.
   * @param {string} panelId
   * @param {number} [rows=5]  Number of skeleton rows
   */
  function showLoading(panelId, rows = 5) {
    renderPanel(panelId, (body) => {
      const wrap = document.createElement('div');
      wrap.className = 'panel-loading';
      wrap.setAttribute('aria-label', 'Loading…');
      wrap.setAttribute('role', 'status');

      // One heading skeleton + N row skeletons
      const heading = document.createElement('div');
      heading.className = 'skeleton skeleton--heading';
      wrap.appendChild(heading);

      for (let i = 0; i < rows; i++) {
        const row = document.createElement('div');
        row.className = 'skeleton skeleton--row';
        // Vary widths slightly so it looks natural
        row.style.width = `${85 + (i % 3) * 5}%`;
        wrap.appendChild(row);
      }

      body.appendChild(wrap);
    });
  }

  /**
   * Remove loading state (alias: renders nothing, contentFn will replace).
   * Not strictly needed — renderPanel clears automatically — but provides
   * a symmetrical hideLoading() call to pair with showLoading().
   * @param {string} panelId
   */
  function hideLoading(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const body = panel.querySelector('.panel__body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  // ─── Toast notifications ─────────────────────────────────────────────────

  /**
   * Show a non-blocking toast notification.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type='info']
   * @param {number} [duration=4000]  ms before auto-dismiss (0 = manual only)
   */
  function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.style.setProperty('--toast-duration', `${Math.max(duration - 200, 0)}ms`);

    // Icon
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast__icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icons[type] || 'ℹ';

    // Message body
    const body = document.createElement('div');
    body.className = 'toast__body';
    body.textContent = message; // textContent — no XSS

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast__close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => removeToast(toast));

    toast.appendChild(iconSpan);
    toast.appendChild(body);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }
  }

  function removeToast(toastEl) {
    if (!toastEl.parentElement) return;
    toastEl.style.animation = 'toast-out 160ms ease forwards';
    setTimeout(() => {
      if (toastEl.parentElement) toastEl.parentElement.removeChild(toastEl);
    }, 160);
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  /**
   * Show a panel and update sidebar active state.
   * @param {string} panelId   id of the panel to activate
   */
  function showPanel(panelId) {
    // Deactivate all panels
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.remove('panel--active');
    });

    // Activate target panel
    const target = document.getElementById(panelId);
    if (target) {
      target.classList.add('panel--active');
    }

    // Update sidebar nav active state
    document.querySelectorAll('.sidebar-nav__item').forEach(item => {
      item.classList.remove('sidebar-nav__item--active');
      item.setAttribute('aria-selected', 'false');
    });

    const activeNavItem = document.querySelector(
      `.sidebar-nav__item[data-panel="${panelId}"]`
    );
    if (activeNavItem) {
      activeNavItem.classList.add('sidebar-nav__item--active');
      activeNavItem.setAttribute('aria-selected', 'true');
    }

    // Store current panel in state
    if (window.App?.State) {
      window.App.State.set('currentPanel', panelId);
    }
  }

  /**
   * Wire up sidebar navigation click handlers.
   * Must be called after DOM is ready.
   */
  function initNavigation() {
    document.querySelectorAll('.sidebar-nav__item[data-panel]').forEach(item => {
      item.addEventListener('click', () => {
        const panelId = item.getAttribute('data-panel');
        if (panelId) showPanel(panelId);
      });

      // Keyboard: Enter / Space trigger click
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        }
      });
    });
  }

  // ─── Theme toggle ─────────────────────────────────────────────────────────

  /**
   * Toggle dark/light theme and persist preference.
   */
  function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);

    try {
      // Persist preference (just the theme preference, not the token)
      localStorage.setItem('gri_theme', newTheme);
    } catch (_) {}

    updateThemeToggleIcon(newTheme);
  }

  /**
   * Apply the stored theme preference on load.
   */
  function applyStoredTheme() {
    let theme = 'light';
    try {
      theme = localStorage.getItem('gri_theme') || 'light';
    } catch (_) {}
    // Also respect OS preference if no stored choice
    if (!localStorage.getItem('gri_theme')) {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        theme = 'dark';
      }
    }
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeToggleIcon(theme);
  }

  function updateThemeToggleIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    // Unicode sun/moon as accessible text — icon font not used (zero-dep)
    btn.textContent = theme === 'dark' ? '☀' : '☾';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }

  /**
   * Wire up the theme toggle button.
   */
  function initThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', toggleTheme);
  }

  // ─── Rate limit display ───────────────────────────────────────────────────

  /**
   * Update the rate limit display in the header.
   * @param {{ remaining: number, limit: number, reset: Date|null }} data
   */
  function updateRateLimitDisplay(data) {
    const el = document.getElementById('rate-limit-display');
    if (!el) return;

    if (!data) {
      el.textContent = '';
      return;
    }

    const { remaining, limit, reset } = data;
    const pct = limit > 0 ? remaining / limit : 1;

    // Update dot color
    const dot = document.getElementById('rate-limit-dot');
    if (dot) {
      dot.className = 'app-header__rate-limit-dot';
      if (pct < 0.1)       dot.classList.add('app-header__rate-limit-dot--crit');
      else if (pct < 0.25) dot.classList.add('app-header__rate-limit-dot--warn');
      else                 dot.classList.add('app-header__rate-limit-dot--ok');
    }

    // Update text
    const resetStr = reset
      ? `resets ${formatRelativeDate(reset.toISOString())}`
      : '';

    el.textContent = `${remaining.toLocaleString()} / ${limit.toLocaleString()} ${resetStr}`.trim();
    el.title = reset ? `Rate limit resets at ${reset.toLocaleTimeString()}` : '';
  }

  /**
   * Wire up the rate limit subscription after State is available.
   */
  function initRateLimitDisplay() {
    if (window.App?.State) {
      window.App.State.subscribe('rateLimits', updateRateLimitDisplay);
    }
  }

  // ─── Operation log ────────────────────────────────────────────────────────

  /**
   * Wire up the collapsible operation log footer.
   */
  function initOpLog() {
    const header = document.querySelector('.op-log__header');
    const opLog  = document.querySelector('.op-log');
    if (!header || !opLog) return;

    header.addEventListener('click', () => {
      opLog.classList.toggle('op-log--expanded');
    });

    // Subscribe to state updates
    if (window.App?.State) {
      window.App.State.subscribe('operationLog', (entries) => {
        if (!entries || !entries.length) return;
        renderOpLog(entries);
      });
    }
  }

  /**
   * Render entries into the operation log.
   * @param {object[]} entries
   */
  function renderOpLog(entries) {
    const container = document.getElementById('op-log-entries');
    const countEl   = document.getElementById('op-log-count');
    if (!container) return;

    // Update count badge
    if (countEl) countEl.textContent = entries.length;

    // Only re-render if expanded (for performance)
    const opLog = document.querySelector('.op-log');
    if (!opLog?.classList.contains('op-log--expanded') && entries.length > 1) return;

    while (container.firstChild) container.removeChild(container.firstChild);

    entries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'op-log__entry';

      const time = document.createElement('span');
      time.className = 'op-log__entry-time';
      time.textContent = entry.time;

      const method = document.createElement('span');
      method.className = `op-log__entry-method op-log__entry-method--${entry.method.toLowerCase()}`;
      method.textContent = entry.method;

      const status = document.createElement('span');
      const statusClass = entry.status >= 400 ? 'err' : entry.status >= 300 ? 'warn' : 'ok';
      status.className = `op-log__entry-status op-log__entry-status--${statusClass}`;
      status.textContent = entry.status || 'ERR';

      const urlSpan = document.createElement('span');
      urlSpan.className = 'op-log__entry-url';
      // Strip base URL for readability
      urlSpan.textContent = entry.url.replace('https://api.github.com', '');
      urlSpan.title = entry.url;

      const dur = document.createElement('span');
      dur.className = 'op-log__entry-duration';
      dur.textContent = entry.ms ? `${entry.ms}ms` : '';

      row.appendChild(time);
      row.appendChild(method);
      row.appendChild(status);
      row.appendChild(urlSpan);
      row.appendChild(dur);
      container.appendChild(row);
    });
  }

  // ─── Repo metadata display ────────────────────────────────────────────────

  /**
   * Render the Overview panel with repository metadata.
   * @param {object} repo  GitHub API repo object
   */
  function renderRepoOverview(repo) {
    renderPanel('panel-overview', (body) => {
      // Repo header card
      const card = document.createElement('div');
      card.className = 'card mb-5';

      const cardHeader = document.createElement('div');
      cardHeader.className = 'card__header';

      const titleLink = document.createElement('a');
      titleLink.className = 'card__title';
      titleLink.href = repo.html_url;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = repo.full_name;
      cardHeader.appendChild(titleLink);

      // Visibility badge
      const visBadge = createBadge(
        repo.private ? 'Private' : 'Public',
        repo.private ? 'stale' : 'active'
      );
      cardHeader.appendChild(visBadge);

      if (repo.fork) {
        cardHeader.appendChild(createBadge('Fork', 'default'));
      }

      card.appendChild(cardHeader);

      const cardBody = document.createElement('div');
      cardBody.className = 'card__body';

      // Description
      if (repo.description) {
        const desc = document.createElement('p');
        desc.className = 'text-sm text-muted mb-4';
        desc.textContent = repo.description;
        cardBody.appendChild(desc);
      }

      // Meta grid
      const grid = document.createElement('div');
      grid.className = 'meta-grid';

      const metaFields = [
        { label: 'Default Branch', value: repo.default_branch },
        { label: 'Language',       value: repo.language || '—' },
        { label: 'License',        value: repo.license?.name || '—' },
        { label: 'Created',        value: formatDate(repo.created_at) },
        { label: 'Updated',        value: formatRelativeDate(repo.updated_at) },
        { label: 'Stars',          value: (repo.stargazers_count || 0).toLocaleString() },
        { label: 'Forks',          value: (repo.forks_count || 0).toLocaleString() },
        { label: 'Open Issues',    value: (repo.open_issues_count || 0).toLocaleString() },
      ];

      metaFields.forEach(({ label, value }) => {
        const item = document.createElement('div');
        item.className = 'meta-item';

        const lbl = document.createElement('div');
        lbl.className = 'meta-item__label';
        lbl.textContent = label;

        const val = document.createElement('div');
        val.className = 'meta-item__value';
        val.textContent = value;

        item.appendChild(lbl);
        item.appendChild(val);
        grid.appendChild(item);
      });

      cardBody.appendChild(grid);

      // Topics
      if (repo.topics && repo.topics.length > 0) {
        const topicsLabel = document.createElement('div');
        topicsLabel.className = 'meta-item__label mb-4';
        topicsLabel.textContent = 'Topics';
        cardBody.appendChild(topicsLabel);

        const topicsList = document.createElement('ul');
        topicsList.className = 'topics-list mb-4';
        repo.topics.forEach(topic => {
          const li = document.createElement('li');
          const chip = document.createElement('span');
          chip.className = 'topic-chip';
          chip.textContent = topic;
          li.appendChild(chip);
          topicsList.appendChild(li);
        });
        cardBody.appendChild(topicsList);
      }

      card.appendChild(cardBody);
      body.appendChild(card);
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  window.App.UI = {
    // Date helpers
    formatDate,
    formatRelativeDate,
    daysSince,

    // Element factories
    createBadge,
    createPill,
    createTable,

    // Panel helpers
    renderPanel,
    showLoading,
    hideLoading,
    showPanel,

    // Notifications
    showToast,

    // Init functions (called by app.js on DOMContentLoaded)
    initNavigation,
    initThemeToggle,
    applyStoredTheme,
    initRateLimitDisplay,
    initOpLog,

    // Higher-level renderers
    renderRepoOverview
  };

})();
