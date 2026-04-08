/**
 * release-form-ui.js — Release creation form
 *
 * Tag selector, Markdown body editor, auto-generate notes,
 * pre-release / draft toggles, and create button.
 *
 * Blueprint reference: §3.4 — Release creation
 */
(function () {
  'use strict';
  window.App = window.App || {};

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function renderForm(container) {
    const form = _el('div', 'release-create-form card');
    const hdr = _el('div', 'card__header');
    hdr.appendChild(_el('span', 'card__title', 'Create Release'));
    form.appendChild(hdr);

    const body = _el('div', 'card__body');
    _addTagSelector(body);
    _addTitleInput(body);
    _addBodyEditor(body);
    _addToggles(body);

    const row = _el('div', 'tag-form-actions');
    const btn = _el('button', 'btn btn--primary', 'Create Release');
    btn.type = 'button'; btn.id = 'btn-create-release';
    btn.addEventListener('click', _handleCreate);
    row.appendChild(btn);
    body.appendChild(row);

    form.appendChild(body);
    container.appendChild(form);
  }

  function _addTagSelector(p) {
    const g = _el('div', 'form-group');
    g.appendChild(_el('label', 'form-label', 'Tag'));
    const sel = _el('select', 'form-input');
    sel.id = 'release-tag-select';
    const def = _el('option', null, 'Select a tag\u2026'); def.value = '';
    sel.appendChild(def);
    (App.State.get('tags') || []).forEach(t => {
      const o = _el('option', null, t.name + (t.release ? ' (has release)' : ''));
      o.value = t.name; if (t.release) o.disabled = true; sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      const ti = document.getElementById('release-title-input');
      if (sel.value && ti && !ti.value) ti.value = sel.value;
    });
    g.appendChild(sel); p.appendChild(g);
  }

  function _addTitleInput(p) {
    const g = _el('div', 'form-group');
    g.appendChild(_el('label', 'form-label', 'Release Title'));
    const i = _el('input', 'form-input');
    i.type = 'text'; i.id = 'release-title-input'; i.placeholder = 'v1.2.3';
    g.appendChild(i); p.appendChild(g);
  }

  function _addBodyEditor(p) {
    const g = _el('div', 'form-group');
    const r = _el('div', 'release-body-label-row');
    r.appendChild(_el('label', 'form-label', 'Release Notes (Markdown)'));
    const ab = _el('button', 'btn btn--secondary btn--sm', 'Auto-generate notes');
    ab.type = 'button'; ab.addEventListener('click', _handleAutoGen);
    r.appendChild(ab);
    const ta = _el('textarea', 'form-input release-body-textarea');
    ta.id = 'release-body-textarea'; ta.rows = 8; ta.placeholder = 'Describe this release\u2026';
    const pv = _el('div', 'release-preview'); pv.id = 'release-preview'; pv.style.display = 'none';
    const pb = _el('button', 'btn btn--ghost btn--sm', 'Preview');
    pb.type = 'button';
    pb.addEventListener('click', () => { if (App.MdPreview) App.MdPreview.toggle(ta, pv); });
    g.appendChild(r); g.appendChild(ta); g.appendChild(pb); g.appendChild(pv);
    p.appendChild(g);
  }

  function _addToggles(p) {
    const r = _el('div', 'release-toggles');
    [['release-prerelease-check', 'Pre-release'], ['release-draft-check', 'Draft']].forEach(([id, t]) => {
      const l = _el('label', 'release-toggle-label');
      const c = document.createElement('input'); c.type = 'checkbox'; c.id = id;
      l.appendChild(c); l.appendChild(document.createTextNode(' ' + t)); r.appendChild(l);
    });
    p.appendChild(r);
  }

  async function _handleAutoGen() {
    const tag = document.getElementById('release-tag-select')?.value;
    if (!tag) { App.UI.showToast('Select a tag first.', 'warning'); return; }
    App.UI.showToast('Generating release notes\u2026', 'info', 2000);
    const tags = App.State.get('tags') || [];
    const idx = tags.findIndex(t => t.name === tag);
    const prev = (idx >= 0 && idx + 1 < tags.length) ? tags[idx + 1].name : null;
    try {
      const cl = await App.Changelog.generateChangelog(prev, tag);
      document.getElementById('release-body-textarea').value =
        App.Changelog.formatChangelogMarkdown({ ...cl, toRef: tag });
      App.UI.showToast('Release notes generated.', 'success');
    } catch (err) { App.UI.showToast('Failed: ' + err.message, 'error'); }
  }

  async function _handleCreate() {
    const tag = document.getElementById('release-tag-select')?.value;
    const title = document.getElementById('release-title-input')?.value?.trim();
    const body = document.getElementById('release-body-textarea')?.value || '';
    const pre = document.getElementById('release-prerelease-check')?.checked;
    const draft = document.getElementById('release-draft-check')?.checked;
    if (!tag) { App.UI.showToast('Select a tag.', 'warning'); return; }
    if (document.getElementById('dry-run-toggle')?.checked) {
      App.UI.showToast(`[DRY RUN] Would create release "${title || tag}"`, 'info', 6000); return;
    }
    const btn = document.getElementById('btn-create-release');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating\u2026'; }
    try {
      await App.Tags.createRelease(tag, title || tag, body, draft, pre);
      App.UI.showToast(`Release "${title || tag}" created.`, 'success');
      const rs = App.State.get('repo');
      if (rs) App.State.set('releases', await App.API.getReleases(rs.owner, rs.repo));
      await App.ReleasesUI.loadAndRender();
    } catch (err) { App.UI.showToast('Failed: ' + err.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Create Release'; } }
  }

  window.App.ReleaseFormUI = { renderForm };
})();
