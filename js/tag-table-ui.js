/**
 * tag-table-ui.js — Tag table rendering
 *
 * Renders the sortable tag table showing name, date, type,
 * release link, commit SHA, and delete action.
 *
 * Blueprint reference: §3.4 — Tag listing
 */
(function () {
  'use strict';

  window.App = window.App || {};

  /**
   * Render the tag table into a container.
   * @param {HTMLElement} container
   * @param {object[]} tags  Enriched tag objects
   */
  function renderTable(container, tags) {
    if (tags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const msg = document.createElement('p');
      msg.className = 'empty-state__description';
      msg.textContent = 'No tags found in this repository.';
      empty.appendChild(msg);
      container.appendChild(empty);
      return;
    }

    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.textContent = `All Tags (${tags.length})`;
    container.appendChild(divider);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    container.appendChild(wrapper);

    const table = document.createElement('table');
    table.className = 'data-table tag-table';
    wrapper.appendChild(table);

    // Header
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    ['Tag', 'Date', 'Type', 'Release', 'Commit', 'Actions'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    tags.forEach(tag => tbody.appendChild(_buildTagRow(tag)));
    table.appendChild(tbody);
  }

  /** Build a single tag table row */
  function _buildTagRow(tag) {
    const tr = document.createElement('tr');

    // Tag name + semver badge
    const tdName = document.createElement('td');
    tdName.className = 'tag-name-cell';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'mono';
    nameSpan.textContent = tag.name;
    tdName.appendChild(nameSpan);
    if (tag.semver) {
      tdName.appendChild(document.createTextNode(' '));
      tdName.appendChild(App.UI.createBadge('semver', 'primary'));
    }
    tr.appendChild(tdName);

    // Date
    const tdDate = document.createElement('td');
    tdDate.className = 'data-table__cell--muted';
    tdDate.textContent = tag.date ? App.UI.formatRelativeDate(tag.date) : '\u2014';
    if (tag.date) tdDate.title = App.UI.formatDate(tag.date);
    tr.appendChild(tdDate);

    // Type badge
    const tdType = document.createElement('td');
    tdType.appendChild(App.UI.createBadge(
      tag.type, tag.type === 'annotated' ? 'merged' : 'default'
    ));
    tr.appendChild(tdType);

    // Release link
    tr.appendChild(_buildReleaseCell(tag));

    // Commit SHA
    const tdSha = document.createElement('td');
    tdSha.className = 'data-table__cell--mono';
    const sha = document.createElement('span');
    sha.className = 'mono';
    sha.textContent = (tag.sha || '').slice(0, 7);
    sha.title = tag.sha || '';
    tdSha.appendChild(sha);
    tr.appendChild(tdSha);

    // Delete action
    const tdActions = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn--danger btn--sm';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (App.TagActionsUI) App.TagActionsUI.confirmDelete(tag.name);
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    return tr;
  }

  /** Build the release cell with link + badges */
  function _buildReleaseCell(tag) {
    const td = document.createElement('td');
    if (tag.release) {
      const link = document.createElement('a');
      link.href = tag.release.html_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = tag.release.name || tag.release.tag_name;
      link.className = 'tag-release-link';
      td.appendChild(link);
      if (tag.release.draft) {
        td.appendChild(document.createTextNode(' '));
        td.appendChild(App.UI.createBadge('draft', 'stale'));
      }
      if (tag.release.prerelease) {
        td.appendChild(document.createTextNode(' '));
        td.appendChild(App.UI.createBadge('pre-release', 'default'));
      }
    } else {
      td.className = 'data-table__cell--muted';
      td.textContent = 'none';
    }
    return td;
  }

  window.App.TagTableUI = { renderTable };

})();
