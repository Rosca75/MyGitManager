/**
 * branches.js — Branch Analysis panel
 *
 * Responsibilities:
 *  - Load and enrich all branches with last-commit metadata
 *  - Classify branches with status badges:
 *      default (blue), most-recent (green), most-active (purple),
 *      stale (yellow, >90 days), protected (blue), merged-candidate (gray)
 *  - Render sortable / filterable branch table
 *  - Expand a row to show last 5 commits + divergence from default branch
 *  - Fetch 30-day activity counts in background for "most active" badge
 *  - Store activityMetrics in State for the Overview panel
 *
 * Blueprint reference: §3.2 — Branch Analysis
 */
(function () {
  'use strict';

  window.App = window.App || {};

  // ─── Constants ──────────────────────────────────────────────────────────────

  const STALE_DAYS  = 90;   // Branches with no commits in this many days are stale
  const MAX_MSG_LEN = 60;   // Truncate commit message preview to this length

  // ─── Module state ────────────────────────────────────────────────────────────

  /** Enriched branch objects populated by loadBranches() */
  let _enrichedBranches = [];

  /** Sort state */
  let _sortKey = 'date';   // 'name' | 'date' | 'author' | 'status'
  let _sortDir = 'desc';   // 'asc'  | 'desc'

  /** Live filter text (lowercased) */
  let _filterText = '';

  /** Currently expanded branch name, or null */
  let _expandedBranch = null;

  // ─── Public: load branches ───────────────────────────────────────────────────

  /**
   * Fetch all branches and enrich with last-commit data.
   * Called by app.js immediately after a successful repository connect.
   */
  async function loadBranches() {
    const repoState = App.State.get('repo');
    if (!repoState) return;
    const { owner, repo, data: repoData } = repoState;
    const defaultBranch = repoData?.default_branch || 'main';

    App.UI.showLoading('panel-branches', 8);
    _enrichedBranches = [];
    _expandedBranch   = null;

    // Reset UI state so switching repos starts with a clean table
    _filterText = '';
    _sortKey    = 'date';
    _sortDir    = 'desc';

    try {
      const branches = await App.API.getBranches(owner, repo);
      App.State.set('branches', branches);

      // Update sidebar counter badge
      const countEl = document.getElementById('nav-count-branches');
      if (countEl) countEl.textContent = branches.length;

      // Enrich each branch with its latest commit info
      _enrichedBranches = await _enrichBranches(branches, owner, repo, defaultBranch);

      // Write initial activity metrics (without 30d counts yet)
      _storeActivityMetrics(defaultBranch);

      // Re-render if the panel is currently visible
      if (App.State.get('currentPanel') === 'panel-branches') {
        _renderBranchPanel();
      }

      // Fetch 30-day activity counts in the background (non-blocking)
      _fetchBranchActivity(branches, owner, repo).catch(err => {
        console.warn('[Branches] Activity fetch failed:', err.message);
      });

    } catch (err) {
      console.error('[Branches] loadBranches failed:', err);
      App.UI.showToast('Failed to load branches: ' + err.message, 'error');
      App.UI.renderPanel('panel-branches', (body) => {
        const msg = document.createElement('p');
        msg.className = 'text-muted text-sm';
        msg.textContent = 'Failed to load branches. ' + err.message;
        body.appendChild(msg);
      });
    }
  }

  // ─── Private: enrichment ────────────────────────────────────────────────────

  /**
   * Enrich raw branch objects with last-commit metadata.
   * Fetches one commit per branch via getCommits(…, 1, 1).
   * @param {object[]} branches
   * @param {string} owner
   * @param {string} repo
   * @param {string} defaultBranch
   * @returns {Promise<object[]>}
   */
  async function _enrichBranches(branches, owner, repo, defaultBranch) {
    // Launch all fetches; the request queue already limits concurrency to 2
    const settled = await Promise.allSettled(
      branches.map(async (branch) => {
        let lastCommit = null;
        try {
          const commits = await App.API.getCommits(owner, repo, branch.name, 1, 1);
          if (commits && commits.length > 0) {
            const c = commits[0];
            lastCommit = {
              sha:     c.sha,
              date:    c.commit?.author?.date || c.commit?.committer?.date || null,
              author:  c.commit?.author?.name || c.author?.login || '—',
              message: c.commit?.message || '',
              url:     c.html_url || null
            };
          }
        } catch (_) {
          // Branch still appears, but without last-commit details
        }

        const days = lastCommit?.date ? App.UI.daysSince(lastCommit.date) : Infinity;

        return {
          name:        branch.name,
          sha:         branch.commit?.sha || null,
          isProtected: branch.protected  || false,
          isDefault:   branch.name === defaultBranch,
          lastCommit,
          daysSince:   days,
          commitCount30d: null // filled in later by _fetchBranchActivity
        };
      })
    );

    const enriched = settled.map((r, i) =>
      r.status === 'fulfilled' ? r.value : {
        name:        branches[i].name,
        sha:         branches[i].commit?.sha || null,
        isProtected: false,
        isDefault:   branches[i].name === defaultBranch,
        lastCommit:  null,
        daysSince:   Infinity,
        commitCount30d: null
      }
    );

    _assignBadges(enriched);
    return enriched;
  }

  /**
   * Assign status badges to each enriched branch.
   * Modifies the array in-place.
   * @param {object[]} enriched
   */
  function _assignBadges(enriched) {
    // Identify the non-default branch with the most recent commit
    let mostRecentName = null;
    let mostRecentDate = new Date(0);

    enriched.forEach(b => {
      if (!b.isDefault && b.lastCommit?.date) {
        const d = new Date(b.lastCommit.date);
        if (d > mostRecentDate) {
          mostRecentDate = d;
          mostRecentName = b.name;
        }
      }
    });

    enriched.forEach(b => {
      b.badges = [];

      if (b.isDefault) {
        b.badges.push({ text: 'default',   type: 'primary' });
      }
      if (b.name === mostRecentName) {
        b.badges.push({ text: 'most recent', type: 'active' });
      }
      if (!b.isDefault && b.daysSince >= STALE_DAYS) {
        b.badges.push({ text: 'stale',     type: 'stale' });
      }
      if (b.isProtected) {
        b.badges.push({ text: 'protected', type: 'protected' });
      }
    });
  }

  /**
   * Fetch 30-day commit counts for all branches.
   * Runs in background after initial load; updates badges and re-renders.
   * @param {object[]} rawBranches  Original branches array from API
   * @param {string} owner
   * @param {string} repo
   */
  async function _fetchBranchActivity(rawBranches, owner, repo) {
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const activityMap = {};

    // Throttle: fetch in small groups to avoid rate limit spikes
    const BATCH = 5;
    for (let i = 0; i < rawBranches.length; i += BATCH) {
      const batch = rawBranches.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (branch) => {
          try {
            const commits = await App.API.getCommitsSince(
              owner, repo, branch.name, since, 100
            );
            activityMap[branch.name] = commits?.length ?? 0;
          } catch (_) {
            activityMap[branch.name] = 0;
          }
        })
      );
    }

    // Apply "most active" badge
    _applyActivityBadges(activityMap);

    // Update metrics with most-active information
    const repoState = App.State.get('repo');
    const defaultBranch = repoState?.data?.default_branch || 'main';
    _storeActivityMetrics(defaultBranch, activityMap);
  }

  /**
   * Apply "most active" badge based on 30d commit counts.
   * Modifies _enrichedBranches in-place; refreshes table if panel is active.
   * @param {object} activityMap  { branchName: commitCount }
   */
  function _applyActivityBadges(activityMap) {
    if (!_enrichedBranches.length) return;

    // Find branch with highest 30d commit count
    let mostActiveName = null;
    let maxCount = 0;
    Object.entries(activityMap).forEach(([name, count]) => {
      if (count > maxCount) { maxCount = count; mostActiveName = name; }
    });

    _enrichedBranches.forEach(b => {
      b.commitCount30d = activityMap[b.name] ?? 0;
      // Remove stale "most active" badge, then re-add if applicable
      b.badges = b.badges.filter(badge => badge.text !== 'most active');
      if (b.name === mostActiveName && maxCount > 0) {
        // Insert after any "default" or "most recent" badges (manual lastIndex — ES2020 safe)
        let insertIdx = -1;
        for (let k = b.badges.length - 1; k >= 0; k--) {
          if (b.badges[k].text === 'default' || b.badges[k].text === 'most recent') {
            insertIdx = k;
            break;
          }
        }
        b.badges.splice(insertIdx + 1, 0, { text: 'most active', type: 'merged' });
      }
    });

    // Re-render the table if it's currently visible
    if (App.State.get('currentPanel') === 'panel-branches') {
      _renderBranchTable();
    }
  }

  // ─── Activity metrics ────────────────────────────────────────────────────────

  /**
   * Compute and write activity metrics to State for the Overview panel.
   * @param {string} defaultBranch
   * @param {object} [activityMap]  Optional 30d commit counts
   */
  function _storeActivityMetrics(defaultBranch, activityMap = null) {
    const total = _enrichedBranches.length;
    const stale = _enrichedBranches.filter(
      b => !b.isDefault && b.daysSince >= STALE_DAYS
    ).length;

    // Branch with 0 commits ahead of default = merged candidate
    // (We don't have divergence data here — that's lazily fetched on row expand)

    // Last commit across all branches
    let latestCommit = null;
    let latestDate   = new Date(0);
    _enrichedBranches.forEach(b => {
      if (b.lastCommit?.date) {
        const d = new Date(b.lastCommit.date);
        if (d > latestDate) {
          latestDate   = d;
          latestCommit = { branch: b.name, ...b.lastCommit };
        }
      }
    });

    // Most active branch (if activity data available)
    let mostActiveBranch = null;
    if (activityMap) {
      let max = 0;
      Object.entries(activityMap).forEach(([name, count]) => {
        if (count > max) { max = count; mostActiveBranch = name; }
      });
    }

    App.State.set('activityMetrics', {
      totalBranches: total,
      staleBranches: stale,
      latestCommit,
      mostActiveBranch
    });
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  /**
   * Render the full Branches panel body (controls + table).
   */
  function _renderBranchPanel() {
    App.UI.renderPanel('panel-branches', (body) => {
      if (_enrichedBranches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const msg = document.createElement('p');
        msg.className = 'empty-state__description';
        msg.textContent = 'No branches found in this repository.';
        empty.appendChild(msg);
        body.appendChild(empty);
        return;
      }

      // ── Filter input ──────────────────────────────────────────────────────
      const controls = document.createElement('div');
      controls.className = 'branch-controls';

      const filterInput = document.createElement('input');
      filterInput.type  = 'text';
      filterInput.className   = 'branch-filter-input';
      filterInput.placeholder = 'Filter branches…';
      filterInput.value       = _filterText;
      filterInput.setAttribute('aria-label', 'Filter branches by name');
      filterInput.addEventListener('input', (e) => {
        _filterText = e.target.value.trim().toLowerCase();
        _renderBranchTable();
      });
      controls.appendChild(filterInput);

      // ── Sort buttons ──────────────────────────────────────────────────────
      const sortGroup = document.createElement('div');
      sortGroup.className = 'branch-sort-group';

      const sortLabel = document.createElement('span');
      sortLabel.className = 'text-xs text-muted';
      sortLabel.textContent = 'Sort:';
      sortGroup.appendChild(sortLabel);

      [
        { key: 'name',   label: 'Name'   },
        { key: 'date',   label: 'Date'   },
        { key: 'author', label: 'Author' },
        { key: 'status', label: 'Status' }
      ].forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost btn--sm branch-sort-btn'
          + (_sortKey === key ? ' branch-sort-btn--active' : '');
        btn.textContent = label
          + (_sortKey === key ? (_sortDir === 'asc' ? ' ↑' : ' ↓') : '');
        btn.addEventListener('click', () => {
          if (_sortKey === key) {
            _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            _sortKey = key;
            _sortDir = (key === 'name' || key === 'author') ? 'asc' : 'desc';
          }
          _renderBranchTable();
        });
        sortGroup.appendChild(btn);
      });
      controls.appendChild(sortGroup);
      body.appendChild(controls);

      // ── Summary line ──────────────────────────────────────────────────────
      const summary = document.createElement('p');
      summary.className = 'branch-summary';
      const metrics = App.State.get('activityMetrics');
      summary.textContent = `${_enrichedBranches.length} branch${_enrichedBranches.length !== 1 ? 'es' : ''}`;
      if (metrics?.staleBranches > 0) {
        const stale = document.createElement('span');
        stale.className = 'text-muted';
        stale.textContent = ` · ${metrics.staleBranches} stale`;
        summary.appendChild(stale);
      }
      body.appendChild(summary);

      // ── Table container (re-rendered on sort/filter) ───────────────────────
      const tableContainer = document.createElement('div');
      tableContainer.id = 'branch-table-container';
      body.appendChild(tableContainer);

      _renderBranchTable();
    });
  }

  /**
   * Render (or re-render) just the branch table inside #branch-table-container.
   * Called on sort / filter changes without rebuilding the controls.
   */
  function _renderBranchTable() {
    const container = document.getElementById('branch-table-container');
    if (!container) return;

    while (container.firstChild) container.removeChild(container.firstChild);

    // Collapse any open expansion when table rebuilds
    _expandedBranch = null;

    // Apply filter
    const visible = _filterText
      ? _enrichedBranches.filter(b => b.name.toLowerCase().includes(_filterText))
      : _enrichedBranches;

    if (visible.length === 0) {
      const noMatch = document.createElement('p');
      noMatch.className = 'text-muted text-sm';
      noMatch.textContent = 'No branches match the filter.';
      container.appendChild(noMatch);
      return;
    }

    // Apply sort
    const sorted = [...visible].sort((a, b) => {
      let cmp = 0;
      switch (_sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        case 'date':
          cmp = (new Date(a.lastCommit?.date || 0)).getTime()
              - (new Date(b.lastCommit?.date || 0)).getTime();
          break;
        case 'author':
          cmp = (a.lastCommit?.author || '').localeCompare(b.lastCommit?.author || '');
          break;
        case 'status':
          // More badges = higher priority; default branch always first
          cmp = (b.badges?.length || 0) - (a.badges?.length || 0);
          break;
      }
      return _sortDir === 'asc' ? cmp : -cmp;
    });

    // Build table
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    container.appendChild(wrapper);

    const table = document.createElement('table');
    table.className = 'data-table branch-table';
    wrapper.appendChild(table);

    // Header
    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    ['Branch', 'Last Commit', 'Author', 'Message Preview', 'Status'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');

    sorted.forEach(branch => {
      // ── Expansion row (created first so closure captures it correctly) ────
      const expandRow  = document.createElement('tr');
      expandRow.className    = 'branch-expand-row';
      expandRow.style.display = 'none';

      const expandCell = document.createElement('td');
      expandCell.colSpan  = 5;
      expandCell.className = 'branch-expand-cell';
      expandRow.appendChild(expandCell);

      // ── Main data row ─────────────────────────────────────────────────────
      const tr = document.createElement('tr');
      tr.className = 'branch-row';
      tr.setAttribute('role',         'button');
      tr.setAttribute('tabindex',     '0');
      tr.setAttribute('aria-expanded','false');
      tr.title = 'Click to expand branch details';

      const toggle = () => _toggleExpansion(branch, tr, expandRow, expandCell);
      tr.addEventListener('click',   toggle);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });

      // Branch name
      const tdName = document.createElement('td');
      tdName.className = 'branch-name-cell';
      const nameSpan = document.createElement('span');
      nameSpan.className  = 'branch-name mono';
      nameSpan.textContent = branch.name;
      tdName.appendChild(nameSpan);
      tr.appendChild(tdName);

      // Last commit date
      const tdDate = document.createElement('td');
      tdDate.className    = 'data-table__cell--muted';
      tdDate.textContent  = branch.lastCommit?.date
        ? App.UI.formatRelativeDate(branch.lastCommit.date)
        : '—';
      if (branch.lastCommit?.date) {
        tdDate.title = App.UI.formatDate(branch.lastCommit.date);
      }
      tr.appendChild(tdDate);

      // Author
      const tdAuthor = document.createElement('td');
      tdAuthor.className   = 'data-table__cell--muted';
      tdAuthor.textContent = branch.lastCommit?.author || '—';
      tr.appendChild(tdAuthor);

      // Commit message preview (first line, truncated)
      const tdMsg = document.createElement('td');
      tdMsg.className = 'branch-msg-cell';
      const rawMsg   = (branch.lastCommit?.message || '').split('\n')[0];
      tdMsg.textContent = rawMsg.length > MAX_MSG_LEN
        ? rawMsg.slice(0, MAX_MSG_LEN) + '…'
        : (rawMsg || '—');
      if (rawMsg.length > MAX_MSG_LEN) tdMsg.title = branch.lastCommit.message;
      tr.appendChild(tdMsg);

      // Status badges
      const tdBadges = document.createElement('td');
      tdBadges.className = 'branch-badges-cell';
      (branch.badges || []).forEach((badge, idx) => {
        if (idx > 0) tdBadges.appendChild(document.createTextNode(' '));
        tdBadges.appendChild(App.UI.createBadge(badge.text, badge.type));
      });
      tr.appendChild(tdBadges);

      tbody.appendChild(tr);
      tbody.appendChild(expandRow);
    });

    table.appendChild(tbody);
  }

  // ─── Row expansion ───────────────────────────────────────────────────────────

  /**
   * Toggle the expansion drawer for a branch row.
   * @param {object}      branch     Enriched branch data
   * @param {HTMLElement} mainTr     The clickable data row
   * @param {HTMLElement} expandTr   The hidden expansion row
   * @param {HTMLElement} expandCell The td inside expandTr to populate
   */
  async function _toggleExpansion(branch, mainTr, expandTr, expandCell) {
    const wasExpanded = _expandedBranch === branch.name;

    // Collapse all open rows
    document.querySelectorAll('.branch-expand-row').forEach(r => {
      r.style.display = 'none';
    });
    document.querySelectorAll('.branch-row--expanded').forEach(r => {
      r.classList.remove('branch-row--expanded');
      r.setAttribute('aria-expanded', 'false');
    });

    if (wasExpanded) {
      _expandedBranch = null;
      return;
    }

    _expandedBranch = branch.name;
    mainTr.classList.add('branch-row--expanded');
    mainTr.setAttribute('aria-expanded', 'true');
    expandTr.style.display = '';

    // Show loading state while fetching
    while (expandCell.firstChild) expandCell.removeChild(expandCell.firstChild);
    const loadMsg = document.createElement('span');
    loadMsg.className   = 'text-muted text-xs';
    loadMsg.textContent = 'Loading branch details…';
    expandCell.appendChild(loadMsg);

    const repoState    = App.State.get('repo');
    if (!repoState) return;
    const { owner, repo, data: repoData } = repoState;
    const defaultBranch = repoData?.default_branch || 'main';

    try {
      // Fetch last-5 commits and divergence in parallel
      const [commitsResult, divResult] = await Promise.allSettled([
        App.API.getCommits(owner, repo, branch.name, 1, 5),
        branch.isDefault
          ? Promise.resolve(null)
          : App.API.compareBranches(owner, repo, defaultBranch, branch.name)
      ]);

      while (expandCell.firstChild) expandCell.removeChild(expandCell.firstChild);

      _renderExpandContent(
        expandCell,
        branch,
        commitsResult.value ?? [],
        divResult.value   ?? null,
        defaultBranch
      );
    } catch (err) {
      while (expandCell.firstChild) expandCell.removeChild(expandCell.firstChild);
      const errMsg = document.createElement('p');
      errMsg.className   = 'text-muted text-xs';
      errMsg.textContent = 'Failed to load details: ' + err.message;
      expandCell.appendChild(errMsg);
    }
  }

  /**
   * Populate the expansion cell with divergence stats and last-5 commits.
   * @param {HTMLElement} container
   * @param {object}      branch
   * @param {object[]}    commits
   * @param {object|null} divergence  API compare response, or null
   * @param {string}      defaultBranch
   */
  function _renderExpandContent(container, branch, commits, divergence, defaultBranch) {
    const inner = document.createElement('div');
    inner.className = 'branch-expand-inner';

    // ── Divergence section ────────────────────────────────────────────────
    const divSec = document.createElement('div');
    divSec.className = 'branch-expand-section';

    const divLabel = document.createElement('div');
    divLabel.className   = 'branch-expand-label';
    divLabel.textContent = `Divergence vs ${defaultBranch}`;
    divSec.appendChild(divLabel);

    if (branch.isDefault) {
      const note = document.createElement('span');
      note.className   = 'text-muted text-xs';
      note.textContent = 'This is the default branch.';
      divSec.appendChild(note);
    } else if (divergence) {
      const stat = document.createElement('div');
      stat.className = 'divergence-stat';

      const ahead = document.createElement('span');
      ahead.className   = 'divergence-stat__ahead';
      ahead.textContent = `↑ ${divergence.ahead_by} ahead`;

      const behind = document.createElement('span');
      behind.className   = 'divergence-stat__behind';
      behind.textContent = `↓ ${divergence.behind_by} behind`;

      stat.appendChild(ahead);
      stat.appendChild(behind);
      divSec.appendChild(stat);

      // Mark as merged candidate if 0 commits ahead
      if (divergence.ahead_by === 0) {
        const mergeNote = document.createElement('span');
        mergeNote.className   = 'text-xs text-muted';
        mergeNote.textContent = '0 commits ahead — likely merged into default branch.';
        divSec.appendChild(mergeNote);

        // Add the "merged" badge to the enriched branch if not already present
        const eb = _enrichedBranches.find(b => b.name === branch.name);
        if (eb && !eb.badges.some(b => b.text === 'merged')) {
          eb.badges.push({ text: 'merged', type: 'merged' });
        }
      }
    } else {
      const note = document.createElement('span');
      note.className   = 'text-muted text-xs';
      note.textContent = 'Divergence data unavailable.';
      divSec.appendChild(note);
    }

    inner.appendChild(divSec);

    // ── Last 5 commits section ─────────────────────────────────────────────
    const commitSec = document.createElement('div');
    commitSec.className = 'branch-expand-section';

    const commitLabel = document.createElement('div');
    commitLabel.className   = 'branch-expand-label';
    commitLabel.textContent = 'Last 5 commits';
    commitSec.appendChild(commitLabel);

    if (commits && commits.length > 0) {
      const list = document.createElement('ul');
      list.className = 'mini-commit-list';

      commits.forEach(c => {
        const li = document.createElement('li');
        li.className = 'mini-commit';

        const sha = document.createElement('span');
        sha.className   = 'mini-commit__sha mono';
        sha.textContent = (c.sha || '').slice(0, 7);

        const rawMsg  = (c.commit?.message || '').split('\n')[0];
        const msgSpan = document.createElement('span');
        msgSpan.className   = 'mini-commit__msg';
        msgSpan.textContent = rawMsg.length > 72 ? rawMsg.slice(0, 72) + '…' : rawMsg;

        const dateSpan = document.createElement('span');
        dateSpan.className   = 'mini-commit__date';
        dateSpan.textContent = App.UI.formatRelativeDate(c.commit?.author?.date);

        const authorSpan = document.createElement('span');
        authorSpan.className   = 'mini-commit__author';
        authorSpan.textContent = c.commit?.author?.name || c.author?.login || '—';

        li.appendChild(sha);
        li.appendChild(msgSpan);
        li.appendChild(dateSpan);
        li.appendChild(authorSpan);
        list.appendChild(li);
      });

      commitSec.appendChild(list);
    } else {
      const empty = document.createElement('p');
      empty.className   = 'text-muted text-xs';
      empty.textContent = 'No commits found.';
      commitSec.appendChild(empty);
    }

    inner.appendChild(commitSec);
    container.appendChild(inner);
  }

  // ─── Panel activation ────────────────────────────────────────────────────────

  /**
   * Called when the user navigates to the Branches panel.
   * Renders if enriched data exists; otherwise triggers a load.
   */
  function onPanelActivate() {
    if (_enrichedBranches.length > 0) {
      _renderBranchPanel();
    } else {
      const repoState = App.State.get('repo');
      if (repoState) loadBranches();
    }
  }

  // Auto-subscribe to panel navigation
  if (window.App.State) {
    window.App.State.subscribe('currentPanel', (panelId) => {
      if (panelId === 'panel-branches') onPanelActivate();
    });
  }

  // Refresh button in panel header
  document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('btn-refresh-branches');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        if (App.State.get('repo')) {
          // Force re-load by clearing state
          _enrichedBranches = [];
          loadBranches();
        }
      });
    }
  });

  // ─── Expose public API ───────────────────────────────────────────────────────

  window.App.Branches = {
    loadBranches,
    onPanelActivate,
    /** Return current enriched branch list (read-only; used by heatmap.js) */
    getEnriched: () => _enrichedBranches
  };

})();
