/**
 * releases-ui.js — Releases panel orchestration and list
 *
 * Loads releases, renders the panel layout and release table.
 * Form rendering delegated to release-form-ui.js.
 *
 * Blueprint reference: §3.4 — Release operations
 */
(function () {
  'use strict';
  window.App = window.App || {};

  let _loading = false;

  /** Load releases and render the panel */
  async function loadAndRender() {
    if (_loading) return;
    _loading = true;
    App.UI.showLoading('panel-releases', 6);
    try {
      let releases = App.State.get('releases');
      if (!releases) {
        const rs = App.State.get('repo');
        if (!rs) return;
        releases = await App.API.getReleases(rs.owner, rs.repo);
        App.State.set('releases', releases || []);
      }
      const ct = document.getElementById('nav-count-releases');
      if (ct) ct.textContent = (releases || []).length;
      _renderPanel(releases || []);
    } catch (err) {
      console.error('[ReleasesUI] failed:', err);
      App.UI.showToast('Failed to load releases: ' + err.message, 'error');
      App.UI.renderPanel('panel-releases', (body) => {
        const p = document.createElement('p');
        p.className = 'text-muted text-sm';
        p.textContent = 'Failed to load releases. ' + err.message;
        body.appendChild(p);
      });
    } finally { _loading = false; }
  }

  function _renderPanel(releases) {
    App.UI.renderPanel('panel-releases', (body) => {
      if (App.ReleaseFormUI) App.ReleaseFormUI.renderForm(body);
      _renderList(body, releases);
    });
  }

  function _renderList(container, releases) {
    if (releases.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const p = document.createElement('p');
      p.className = 'empty-state__description';
      p.textContent = 'No releases found in this repository.';
      empty.appendChild(p);
      container.appendChild(empty);
      return;
    }

    const div = document.createElement('div');
    div.className = 'section-divider';
    div.textContent = `All Releases (${releases.length})`;
    container.appendChild(div);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrapper';
    container.appendChild(wrap);

    const table = document.createElement('table');
    table.className = 'data-table';
    wrap.appendChild(table);

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    ['Name', 'Tag', 'Date', 'Status', 'Assets'].forEach(h => {
      const th = document.createElement('th'); th.textContent = h; hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    releases.forEach(r => {
      const tr = document.createElement('tr');
      // Name
      const tdN = document.createElement('td');
      const a = document.createElement('a');
      a.href = r.html_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = r.name || r.tag_name; a.className = 'tag-release-link';
      tdN.appendChild(a); tr.appendChild(tdN);
      // Tag
      const tdT = document.createElement('td');
      tdT.className = 'data-table__cell--mono'; tdT.textContent = r.tag_name;
      tr.appendChild(tdT);
      // Date
      const tdD = document.createElement('td');
      tdD.className = 'data-table__cell--muted';
      tdD.textContent = App.UI.formatRelativeDate(r.published_at || r.created_at);
      tr.appendChild(tdD);
      // Status
      const tdS = document.createElement('td');
      if (r.draft) tdS.appendChild(App.UI.createBadge('draft', 'stale'));
      if (r.prerelease) { if (r.draft) tdS.appendChild(document.createTextNode(' ')); tdS.appendChild(App.UI.createBadge('pre-release', 'default')); }
      if (!r.draft && !r.prerelease) tdS.appendChild(App.UI.createBadge('published', 'active'));
      tr.appendChild(tdS);
      // Assets
      const tdA = document.createElement('td');
      tdA.className = 'data-table__cell--muted';
      const n = r.assets?.length || 0;
      tdA.textContent = n > 0 ? `${n} asset${n !== 1 ? 's' : ''}` : '\u2014';
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // Panel activation + refresh
  if (window.App.State) {
    window.App.State.subscribe('currentPanel', (id) => {
      if (id === 'panel-releases') {
        const r = App.State.get('releases');
        if (r) _renderPanel(r);
        else if (App.State.get('repo')) loadAndRender();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-refresh-releases');
    if (btn) btn.addEventListener('click', () => {
      if (App.State.get('repo')) { App.State.set('releases', null); loadAndRender(); }
    });
  });

  window.App.ReleasesUI = { loadAndRender };
})();
