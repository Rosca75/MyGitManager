/**
 * tags-ui.js — Tags panel orchestration
 *
 * Loads tags, renders current version display and bump buttons.
 * Table and form rendering delegated to tag-table-ui.js / tag-create-ui.js.
 *
 * Blueprint reference: §3.4, §10 — Tags panel
 */
(function () {
  'use strict';
  window.App = window.App || {};

  let _suggestion = null;
  let _loading = false;

  /** Load all tags and render the panel */
  async function loadAndRender() {
    if (_loading) return;
    _loading = true;
    App.UI.showLoading('panel-tags', 6);
    try {
      const tags = await App.Tags.listTags();
      const ct = document.getElementById('nav-count-tags');
      if (ct) ct.textContent = tags.length;
      _suggestion = await App.Tags.suggestNextVersion();
      _renderPanel(tags);
    } catch (err) {
      console.error('[TagsUI] loadAndRender failed:', err);
      App.UI.showToast('Failed to load tags: ' + err.message, 'error');
      App.UI.renderPanel('panel-tags', (body) => {
        const p = document.createElement('p');
        p.className = 'text-muted text-sm';
        p.textContent = 'Failed to load tags. ' + err.message;
        body.appendChild(p);
      });
    } finally { _loading = false; }
  }

  function _renderPanel(tags) {
    App.UI.renderPanel('panel-tags', (body) => {
      _renderCurrentVersion(body);
      _renderBumpSection(body);
      if (App.TagCreateUI) App.TagCreateUI.renderForm(body);
      if (App.TagTableUI) App.TagTableUI.renderTable(body, tags);
    });
  }

  function _renderCurrentVersion(container) {
    const latest = App.Tags.getLatestVersion();
    const section = document.createElement('div');
    section.className = 'current-version-section';
    const label = document.createElement('div');
    label.className = 'current-version__label';
    label.textContent = 'Current Version';
    const value = document.createElement('div');
    value.className = 'current-version__value';
    value.textContent = latest ? latest.version.original : 'No version tags found';
    if (!latest) value.classList.add('current-version__value--none');
    section.appendChild(label);
    section.appendChild(value);
    if (_suggestion) {
      const hint = document.createElement('div');
      hint.className = 'current-version__hint';
      hint.textContent = `Suggested next: ${_suggestion.suggested} (${_suggestion.reason})`;
      section.appendChild(hint);
    }
    container.appendChild(section);
  }

  function _renderBumpSection(container) {
    const section = document.createElement('div');
    section.className = 'bump-section';
    const heading = document.createElement('div');
    heading.className = 'bump-section__heading';
    heading.textContent = 'Version Bump';
    section.appendChild(heading);

    const group = document.createElement('div');
    group.className = 'bump-btn-group';
    ['patch', 'minor', 'major'].forEach(type => {
      const ver = App.Tags.computeNextVersion(type);
      const is = _suggestion?.bump === type;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn bump-btn' + (is ? ' bump-btn--suggested' : ' btn--secondary');
      const lbl = document.createElement('span');
      lbl.className = 'bump-btn__label';
      lbl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      const vSpan = document.createElement('span');
      vSpan.className = 'bump-btn__version';
      vSpan.textContent = ver;
      btn.appendChild(lbl);
      btn.appendChild(vSpan);
      if (is) btn.appendChild(App.UI.createBadge('suggested', 'active'));
      btn.addEventListener('click', () => App.TagCreateUI?.prefill(ver));
      group.appendChild(btn);
    });
    section.appendChild(group);

    if (_suggestion) {
      const r = document.createElement('div');
      r.className = 'bump-section__reason';
      r.textContent = _suggestion.reason + ` \u2014 ${_suggestion.commits.length} commit${_suggestion.commits.length !== 1 ? 's' : ''} since last tag`;
      section.appendChild(r);
    }
    container.appendChild(section);
  }

  // Panel activation + refresh
  if (window.App.State) {
    window.App.State.subscribe('currentPanel', (id) => {
      if (id === 'panel-tags') {
        const tags = App.State.get('tags');
        if (tags?.length > 0) _renderPanel(tags);
        else if (App.State.get('repo')) loadAndRender();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-refresh-tags');
    if (btn) btn.addEventListener('click', () => {
      if (App.State.get('repo')) { _suggestion = null; loadAndRender(); }
    });
  });

  window.App.TagsUI = { loadAndRender };
})();
