/**
 * heatmap.js — Branch Divergence Heatmap
 *
 * Renders a Canvas NxN grid showing pairwise commit divergence between
 * the top N branches (default 15, sorted by most recent commit date).
 *
 * Each cell [row][col] shows: how many commits row-branch is ahead of
 * col-branch, plus how many it is behind. Color is by total divergence:
 *   Green  (--heatmap-sync)     → 0   total divergence
 *   Yellow (--heatmap-minor)    → 1–10
 *   Orange (--heatmap-moderate) → 11–50
 *   Red    (--heatmap-severe)   → 50+
 *   Gray   (--heatmap-self)     → diagonal (same branch)
 *
 * Hover tooltip: "{branchA} vs {branchB}: ↑ X ahead, ↓ Y behind"
 * Click cell: shows commit list for that comparison in a modal dialog.
 *
 * Blueprint reference: §3.3 — Divergence Analysis
 */
(function () {
  'use strict';

  window.App = window.App || {};

  // ─── Configuration ──────────────────────────────────────────────────────────

  const MAX_BRANCHES = 15;  // Maximum branches shown in the heatmap
  const CELL_SIZE    = 34;  // Pixels per cell (square)
  const LABEL_SIZE   = 110; // Pixels reserved for row/column labels
  const FONT_SIZE    = 11;  // px for label text
  const MIN_FONT     = 9;   // Minimum px before labels are omitted

  // ─── Module state ────────────────────────────────────────────────────────────

  /** Branches selected for the heatmap (subset of enriched list) */
  let _heatmapBranches = [];

  /**
   * Sparse divergence matrix.
   * _matrix[i][j] = { ahead, behind } | null (not yet fetched) | 'loading'
   * Diagonal entries are skipped.
   */
  let _matrix = [];

  /** Currently selected cell (for the comparison panel) */
  let _selectedCell = null; // { i, j }

  /** Canvas element reference */
  let _canvas = null;

  /** Tooltip element reference */
  let _tooltip = null;

  /** Whether a full heatmap load is in progress */
  let _loading = false;

  /**
   * Monotonically-increasing counter that is bumped each time _initHeatmap()
   * runs.  Async callbacks capture the generation at call-site and bail if it
   * no longer matches the module-level counter, preventing stale fetches from
   * a previous repo connect from polluting a fresh one.
   */
  let _fetchGeneration = 0;

  // ─── Panel activation ────────────────────────────────────────────────────────

  /**
   * Called when the user navigates to the Divergence panel.
   */
  function onPanelActivate() {
    const repoState = App.State.get('repo');
    if (!repoState) {
      _renderNotConnected();
      return;
    }

    // Wait for branches to be enriched (loadBranches runs async after connect)
    const enriched = App.Branches?.getEnriched() ?? [];

    if (enriched.length === 0) {
      _renderWaitingForBranches();
      return;
    }

    _initHeatmap(enriched, repoState.owner, repoState.repo);
  }

  // Auto-subscribe to panel navigation
  if (window.App.State) {
    window.App.State.subscribe('currentPanel', (panelId) => {
      if (panelId === 'panel-divergence') onPanelActivate();
    });

    // Refresh when enrichment completes (branches.js sets activityMetrics after
    // _enrichedBranches is fully populated — avoids firing on raw branch list)
    window.App.State.subscribe('activityMetrics', () => {
      if (App.State.get('currentPanel') === 'panel-divergence') {
        onPanelActivate();
      }
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  /**
   * Select top N branches, build the panel, and start lazy matrix fetch.
   * @param {object[]} enriched  All enriched branches from branches.js
   * @param {string}   owner
   * @param {string}   repo
   */
  function _initHeatmap(enriched, owner, repo) {
    // Pick top MAX_BRANCHES branches by most-recent commit date
    // Always include the default branch if present
    const sorted = [...enriched].sort((a, b) => {
      const da = new Date(a.lastCommit?.date || 0).getTime();
      const db = new Date(b.lastCommit?.date || 0).getTime();
      return db - da;
    });

    _heatmapBranches = sorted.slice(0, MAX_BRANCHES);
    const N          = _heatmapBranches.length;

    // Reset matrix
    _matrix = Array.from({ length: N }, () => new Array(N).fill(null));
    _selectedCell = null;

    // Bump generation so any in-flight fetches from a previous connect bail out
    _fetchGeneration++;
    const myGeneration = _fetchGeneration;

    // Always reset loading flag so a reconnect can start fresh
    _loading = false;

    // Build the panel skeleton
    App.UI.renderPanel('panel-divergence', (body) => {
      _buildPanelDOM(body, N, owner, repo);
    });

    // Start fetching comparisons (lazy — upper triangle)
    _loading = true;
    _fetchAllComparisons(owner, repo, N, myGeneration).finally(() => {
      // Only clear loading flag if still our generation
      if (_fetchGeneration === myGeneration) _loading = false;
    });
  }

  /**
   * Build the panel DOM: legend, canvas wrapper, progress, comparison detail.
   */
  function _buildPanelDOM(body, N, owner, repo) {
    // ── Legend ──────────────────────────────────────────────────────────────
    const legend = document.createElement('div');
    legend.className = 'heatmap-legend';
    legend.setAttribute('aria-label', 'Heatmap colour legend');

    [
      { cls: 'heatmap-sync',     label: 'In sync (0)'    },
      { cls: 'heatmap-minor',    label: 'Minor (1–10)'   },
      { cls: 'heatmap-moderate', label: 'Moderate (11–50)' },
      { cls: 'heatmap-severe',   label: 'Severe (50+)'   }
    ].forEach(({ cls, label }) => {
      const item    = document.createElement('div');
      item.className = 'heatmap-legend-item';

      const swatch  = document.createElement('span');
      swatch.className = 'heatmap-legend-swatch';
      swatch.style.backgroundColor = `var(--${cls})`;

      const lbl = document.createElement('span');
      lbl.textContent = label;

      item.appendChild(swatch);
      item.appendChild(lbl);
      legend.appendChild(item);
    });

    body.appendChild(legend);

    // ── Progress indicator ───────────────────────────────────────────────────
    const progress = document.createElement('div');
    progress.className = 'heatmap-progress';
    progress.id = 'heatmap-progress';

    const spinner = document.createElement('span');
    spinner.className = 'spinner spinner--sm';
    progress.appendChild(spinner);

    const progressText = document.createElement('span');
    progressText.id          = 'heatmap-progress-text';
    progressText.textContent = `Fetching comparisons (0 / ${_totalPairs(N)})…`;
    progress.appendChild(progressText);

    body.appendChild(progress);

    // ── Canvas wrapper ───────────────────────────────────────────────────────
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'heatmap-canvas-wrapper';
    body.appendChild(canvasWrap);

    const canvasSize = LABEL_SIZE + N * CELL_SIZE;

    _canvas        = document.createElement('canvas');
    _canvas.width  = canvasSize;
    _canvas.height = canvasSize;
    _canvas.className = 'heatmap-canvas';
    _canvas.setAttribute('aria-label', 'Branch divergence heatmap');
    canvasWrap.appendChild(_canvas);

    // Draw initial empty grid (cells show as "loading")
    _drawHeatmap();

    // ── Tooltip ──────────────────────────────────────────────────────────────
    // Reuse existing tooltip or create it
    _tooltip = document.getElementById('heatmap-tooltip');
    if (!_tooltip) {
      _tooltip = document.createElement('div');
      _tooltip.id        = 'heatmap-tooltip';
      _tooltip.className = 'heatmap-tooltip';
      _tooltip.setAttribute('role', 'tooltip');
      _tooltip.setAttribute('aria-live', 'polite');
      document.body.appendChild(_tooltip);
    }

    // Mouse events on canvas
    _canvas.addEventListener('mousemove',  (e) => _onCanvasMousemove(e));
    _canvas.addEventListener('mouseleave', ()  => _hideTooltip());
    _canvas.addEventListener('click',      (e) => _onCanvasClick(e, owner, repo));

    // ── Comparison detail panel ───────────────────────────────────────────────
    const detail = document.createElement('div');
    detail.id        = 'heatmap-comparison-detail';
    detail.className = 'comparison-detail';
    detail.style.display = 'none';
    body.appendChild(detail);
  }

  // ─── Matrix fetching ─────────────────────────────────────────────────────────

  /**
   * Number of unique pairs (upper triangle) for N branches.
   */
  function _totalPairs(N) {
    return N * (N - 1) / 2;
  }

  /**
   * Fetch all pairwise comparisons for the upper triangle.
   * Each result fills both matrix[i][j] and matrix[j][i].
   * @param {string} owner
   * @param {string} repo
   * @param {number} N           Number of branches in this run
   * @param {number} generation  Snapshot of _fetchGeneration at call time;
   *                             batches bail early if generation has advanced.
   */
  async function _fetchAllComparisons(owner, repo, N, generation) {
    let fetched = 0;
    const total = _totalPairs(N);

    // Build list of (i,j) pairs for upper triangle
    const pairs = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        pairs.push([i, j]);
      }
    }

    // Fetch in batches of 4 to avoid saturating the queue
    const BATCH = 4;
    for (let b = 0; b < pairs.length; b += BATCH) {
      // Bail if a newer repo connect has started
      if (_fetchGeneration !== generation) return;

      const batch = pairs.slice(b, b + BATCH);
      await Promise.allSettled(
        batch.map(async ([i, j]) => {
          const baseName = _heatmapBranches[i].name;
          const headName = _heatmapBranches[j].name;
          try {
            const result = await App.API.compareBranches(owner, repo, baseName, headName);
            // base (i) is result.behind_by commits behind head (j)
            // base (i) is result.ahead_by commits ahead of head — wait, that's backwards.
            // compareBranches(base, head) returns:
            //   ahead_by  = head is ahead_by commits ahead of base  (i.e., base missing these)
            //   behind_by = head is behind_by commits behind base   (i.e., base has these extra)
            // So from base's (i's) perspective vs head (j):
            //   i is behind_by commits behind j  (j has behind_by commits i doesn't)
            //   i is ahead_by commits ahead of j (i has ahead_by commits j doesn't)
            // Wait — GitHub API: compare(base, head):
            //   ahead_by  = number of commits in head NOT in base
            //   behind_by = number of commits in base NOT in head
            // So matrix[i][j] = { ahead: result.behind_by, behind: result.ahead_by }
            // (i is "ahead" of j by behind_by commits, "behind" j by ahead_by commits)
            _matrix[i][j] = {
              ahead:  result.behind_by, // commits i has that j doesn't
              behind: result.ahead_by   // commits j has that i doesn't
            };
            // Mirror for lower triangle
            _matrix[j][i] = {
              ahead:  result.ahead_by,   // commits j has that i doesn't
              behind: result.behind_by   // commits i has that j doesn't
            };
          } catch (_) {
            _matrix[i][j] = { ahead: 0, behind: 0, error: true };
            _matrix[j][i] = { ahead: 0, behind: 0, error: true };
          }

          fetched++;
          _updateProgress(fetched, total);
          _drawHeatmap();
        })
      );
    }

    // Hide progress once done
    _hideProgress();
    _drawHeatmap();
  }

  function _updateProgress(fetched, total) {
    const el = document.getElementById('heatmap-progress-text');
    if (el) el.textContent = `Fetching comparisons (${fetched} / ${total})…`;
  }

  function _hideProgress() {
    const el = document.getElementById('heatmap-progress');
    if (el) el.style.display = 'none';
  }

  // ─── Canvas drawing ──────────────────────────────────────────────────────────

  /**
   * Get CSS variable colours for the current theme.
   * @returns {{ sync, minor, moderate, severe, self, text, border }}
   */
  function _getColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      sync:     s.getPropertyValue('--heatmap-sync').trim()     || '#1a7f37',
      minor:    s.getPropertyValue('--heatmap-minor').trim()    || '#eac54f',
      moderate: s.getPropertyValue('--heatmap-moderate').trim() || '#d4813a',
      severe:   s.getPropertyValue('--heatmap-severe').trim()   || '#d1242f',
      self:     s.getPropertyValue('--heatmap-self').trim()     || '#eaeef2',
      text:     s.getPropertyValue('--color-text').trim()       || '#1f2328',
      muted:    s.getPropertyValue('--color-text-muted').trim() || '#848d97',
      bg:       s.getPropertyValue('--color-bg').trim()         || '#ffffff',
      border:   s.getPropertyValue('--color-border').trim()     || '#d0d7de',
      accent:   s.getPropertyValue('--color-accent').trim()     || '#0969da'
    };
  }

  /**
   * Map total divergence (ahead+behind) to a canvas fill colour.
   * @param {{ ahead, behind, error }|null} cell
   * @param {{ sync, minor, moderate, severe, self }} colors
   * @returns {string}
   */
  function _cellColor(cell, colors) {
    if (!cell)              return colors.self;   // not yet fetched — show as self
    if (cell.error)         return colors.self;
    const total = cell.ahead + cell.behind;
    if (total === 0)        return colors.sync;
    if (total <= 10)        return colors.minor;
    if (total <= 50)        return colors.moderate;
    return colors.severe;
  }

  /**
   * Draw the full heatmap canvas.
   */
  function _drawHeatmap() {
    if (!_canvas) return;
    const N   = _heatmapBranches.length;
    if (N === 0) return;

    const ctx    = _canvas.getContext('2d');
    const colors = _getColors();
    const W      = _canvas.width;
    const H      = _canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    // Determine if we can fit labels
    const fontSize  = Math.max(MIN_FONT, Math.min(FONT_SIZE, CELL_SIZE * 0.32));
    const showLabels = CELL_SIZE >= 20;

    // ── Column labels (rotated 45°) ──────────────────────────────────────────
    if (showLabels) {
      ctx.save();
      ctx.font          = `${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle     = colors.text;
      ctx.textBaseline  = 'middle';
      ctx.textAlign     = 'left';

      _heatmapBranches.forEach((b, j) => {
        const x = LABEL_SIZE + j * CELL_SIZE + CELL_SIZE / 2;
        const y = LABEL_SIZE - 8;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 4);
        const label = _truncateLabel(b.name, 18);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      });

      ctx.restore();
    }

    // ── Row labels ────────────────────────────────────────────────────────────
    if (showLabels) {
      ctx.font         = `${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle    = colors.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'right';

      _heatmapBranches.forEach((b, i) => {
        const y = LABEL_SIZE + i * CELL_SIZE + CELL_SIZE / 2;
        const label = _truncateLabel(b.name, 18);
        ctx.fillText(label, LABEL_SIZE - 8, y);
      });
    }

    // ── Grid cells ────────────────────────────────────────────────────────────
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = LABEL_SIZE + j * CELL_SIZE;
        const y = LABEL_SIZE + i * CELL_SIZE;

        // Determine fill colour
        let fillColor;
        if (i === j) {
          fillColor = colors.self;
        } else {
          fillColor = _cellColor(_matrix[i]?.[j] ?? null, colors);
        }

        // Cell background
        ctx.fillStyle = fillColor;
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

        // Cell border
        ctx.strokeStyle = colors.bg;
        ctx.lineWidth   = 1;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);

        // Highlight selected cell
        if (_selectedCell && _selectedCell.i === i && _selectedCell.j === j) {
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth   = 2;
          ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        }

        // Show divergence number if cell is large enough and data is available
        if (CELL_SIZE >= 28 && _matrix[i]?.[j] && !_matrix[i][j].error && i !== j) {
          const total = (_matrix[i][j].ahead || 0) + (_matrix[i][j].behind || 0);
          if (total > 0) {
            ctx.font          = `bold ${Math.max(8, fontSize - 1)}px -apple-system, sans-serif`;
            ctx.fillStyle     = colors.bg;
            ctx.textAlign     = 'center';
            ctx.textBaseline  = 'middle';
            ctx.fillText(
              total > 999 ? '999+' : String(total),
              x + CELL_SIZE / 2,
              y + CELL_SIZE / 2
            );
          }
        }
      }
    }

    // ── Outer border ──────────────────────────────────────────────────────────
    ctx.strokeStyle = colors.border;
    ctx.lineWidth   = 1;
    ctx.strokeRect(LABEL_SIZE, LABEL_SIZE, N * CELL_SIZE, N * CELL_SIZE);
  }

  /**
   * Truncate a branch name to at most maxChars characters.
   */
  function _truncateLabel(name, maxChars) {
    if (name.length <= maxChars) return name;
    return '…' + name.slice(-(maxChars - 1));
  }

  // ─── Mouse interaction ───────────────────────────────────────────────────────

  /**
   * Given a mouse event on the canvas, return { i, j } cell indices or null.
   */
  function _hitTest(e) {
    const rect = _canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    const N = _heatmapBranches.length;
    const j = Math.floor((mx - LABEL_SIZE) / CELL_SIZE);
    const i = Math.floor((my - LABEL_SIZE) / CELL_SIZE);

    if (i >= 0 && i < N && j >= 0 && j < N) return { i, j };
    return null;
  }

  function _onCanvasMousemove(e) {
    const cell = _hitTest(e);
    if (!cell) { _hideTooltip(); return; }

    const { i, j } = cell;
    const branchA  = _heatmapBranches[i];
    const branchB  = _heatmapBranches[j];

    let tooltipText;
    if (i === j) {
      tooltipText = branchA.name;
    } else {
      const data = _matrix[i]?.[j];
      if (!data) {
        tooltipText = `${branchA.name} vs ${branchB.name}: loading…`;
      } else {
        tooltipText = `${branchA.name} vs ${branchB.name}: ↑ ${data.ahead} ahead, ↓ ${data.behind} behind`;
      }
    }

    _showTooltip(e.clientX, e.clientY, tooltipText);
  }

  async function _onCanvasClick(e, owner, repo) {
    const cell = _hitTest(e);
    if (!cell || cell.i === cell.j) return;

    _selectedCell = cell;
    _drawHeatmap(); // Redraw to show selection highlight

    const { i, j } = cell;
    await _showComparisonDetail(i, j, owner, repo);
  }

  // ─── Tooltip ─────────────────────────────────────────────────────────────────

  function _showTooltip(x, y, text) {
    if (!_tooltip) return;
    _tooltip.textContent = text;
    _tooltip.classList.add('heatmap-tooltip--visible');

    // Position near cursor, keeping inside viewport
    const tw = _tooltip.offsetWidth  || 200;
    const th = _tooltip.offsetHeight || 30;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let tx = x + 14;
    let ty = y + 14;
    if (tx + tw > vw - 8) tx = x - tw - 14;
    if (ty + th > vh - 8) ty = y - th - 14;

    _tooltip.style.left = tx + 'px';
    _tooltip.style.top  = ty + 'px';
  }

  function _hideTooltip() {
    if (_tooltip) _tooltip.classList.remove('heatmap-tooltip--visible');
  }

  // ─── Comparison detail ───────────────────────────────────────────────────────

  /**
   * Show the comparison detail panel below the heatmap for cell [i][j].
   */
  async function _showComparisonDetail(i, j, owner, repo) {
    const detail = document.getElementById('heatmap-comparison-detail');
    if (!detail) return;

    const branchA = _heatmapBranches[i];
    const branchB = _heatmapBranches[j];
    const data    = _matrix[i]?.[j];

    detail.style.display = '';
    while (detail.firstChild) detail.removeChild(detail.firstChild);

    // Title
    const title = document.createElement('div');
    title.className = 'comparison-detail__title';

    const titleText = document.createElement('span');
    titleText.textContent = `${branchA.name}  vs  ${branchB.name}`;
    title.appendChild(titleText);

    if (data && !data.error) {
      const aheadBadge  = App.UI.createBadge(`↑ ${data.ahead} ahead`,  'active');
      const behindBadge = App.UI.createBadge(`↓ ${data.behind} behind`, 'stale');
      title.appendChild(aheadBadge);
      title.appendChild(behindBadge);
    }

    detail.appendChild(title);

    // Commits in branchA not in branchB (using ahead count)
    if (!data || data.error) {
      const note = document.createElement('p');
      note.className   = 'text-muted text-sm';
      note.textContent = 'Comparison data not available.';
      detail.appendChild(note);
      return;
    }

    if (data.ahead === 0 && data.behind === 0) {
      const note = document.createElement('p');
      note.className   = 'text-sm';
      note.textContent = 'These branches are in sync — no divergence.';
      detail.appendChild(note);
      return;
    }

    // Fetch commits unique to branchA (ahead of branchB)
    const loadNote = document.createElement('p');
    loadNote.className   = 'text-muted text-sm';
    loadNote.textContent = 'Loading unique commits…';
    detail.appendChild(loadNote);

    try {
      // compareBranches(base, head) — commits in head NOT in base
      // To get commits in branchA but not branchB: compare(branchB, branchA)
      const comparison = await App.API.compareBranches(owner, repo, branchB.name, branchA.name);
      detail.removeChild(loadNote);

      const uniqueCommits = comparison?.commits?.slice(0, 10) ?? [];

      if (uniqueCommits.length === 0) {
        const note = document.createElement('p');
        note.className   = 'text-muted text-sm';
        note.textContent = `No commits found that are unique to ${branchA.name}.`;
        detail.appendChild(note);
        return;
      }

      const subLabel = document.createElement('p');
      subLabel.className   = 'text-xs text-muted';
      subLabel.textContent = `Commits in ${branchA.name} not in ${branchB.name} (showing up to 10):`;
      detail.appendChild(subLabel);

      const list = document.createElement('ul');
      list.className = 'mini-commit-list';

      uniqueCommits.forEach(c => {
        const li = document.createElement('li');
        li.className = 'mini-commit';

        const sha = document.createElement('span');
        sha.className   = 'mini-commit__sha mono';
        sha.textContent = (c.sha || '').slice(0, 7);

        const rawMsg  = (c.commit?.message || '').split('\n')[0];
        const msg     = document.createElement('span');
        msg.className   = 'mini-commit__msg';
        msg.textContent = rawMsg.length > 72 ? rawMsg.slice(0, 72) + '…' : rawMsg;

        const date = document.createElement('span');
        date.className   = 'mini-commit__date';
        date.textContent = App.UI.formatRelativeDate(c.commit?.author?.date);

        const author = document.createElement('span');
        author.className   = 'mini-commit__author';
        author.textContent = c.commit?.author?.name || c.author?.login || '—';

        li.appendChild(sha);
        li.appendChild(msg);
        li.appendChild(date);
        li.appendChild(author);
        list.appendChild(li);
      });

      detail.appendChild(list);

    } catch (err) {
      // Guard: loadNote may have already been removed in the try block if the
      // API threw after the successful removeChild (e.g., commit parsing error)
      if (loadNote.parentNode) detail.removeChild(loadNote);
      const errMsg = document.createElement('p');
      errMsg.className   = 'text-muted text-sm';
      errMsg.textContent = 'Failed to fetch comparison: ' + err.message;
      detail.appendChild(errMsg);
    }
  }

  // ─── Empty / not-connected states ────────────────────────────────────────────

  function _renderNotConnected() {
    App.UI.renderPanel('panel-divergence', (body) => {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const msg = document.createElement('p');
      msg.className   = 'empty-state__description';
      msg.textContent = 'Connect to a repository to view the divergence heatmap.';
      empty.appendChild(msg);
      body.appendChild(empty);
    });
  }

  function _renderWaitingForBranches() {
    App.UI.renderPanel('panel-divergence', (body) => {
      const wrap = document.createElement('div');
      wrap.className = 'heatmap-progress';
      const spinner = document.createElement('span');
      spinner.className = 'spinner spinner--sm';
      const txt = document.createElement('span');
      txt.textContent = 'Loading branches — please wait…';
      wrap.appendChild(spinner);
      wrap.appendChild(txt);
      body.appendChild(wrap);
    });
  }

  // ─── Expose public API ───────────────────────────────────────────────────────

  window.App.Heatmap = {
    onPanelActivate
  };

})();
