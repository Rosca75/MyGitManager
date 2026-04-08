/**
 * tag-create-ui.js — Tag creation form
 *
 * Renders the tag creation form with version input,
 * target branch/SHA, message, and create/bump-release buttons.
 *
 * Blueprint reference: §3.4 — Tag creation
 */
(function () {
  'use strict';
  window.App = window.App || {};

  /** Helper: create element with class and text */
  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  /** Render the tag creation form */
  function renderForm(container) {
    const form = _el('div', 'tag-create-form card');
    form.id = 'tag-create-form';
    const header = _el('div', 'card__header');
    header.appendChild(_el('span', 'card__title', 'Create Tag'));
    form.appendChild(header);

    const body = _el('div', 'card__body');
    _addInput(body, 'Tag Name / Version', 'tag-version-input', 'v1.2.3');
    const defBranch = App.State.get('repo')?.data?.default_branch || 'main';
    _addInput(body, 'Target (branch or SHA)', 'tag-target-input', '', defBranch, 'Branch name or commit SHA');

    const msgGroup = _el('div', 'form-group');
    msgGroup.appendChild(_el('label', 'form-label', 'Message (optional \u2014 annotated tag)'));
    const msgInput = _el('textarea', 'form-input tag-message-input');
    msgInput.id = 'tag-message-input';
    msgInput.rows = 2;
    msgInput.placeholder = 'Release v1.2.3';
    msgGroup.appendChild(msgInput);
    body.appendChild(msgGroup);

    const btnRow = _el('div', 'tag-form-actions');
    const createBtn = _el('button', 'btn btn--primary', 'Create Tag');
    createBtn.type = 'button';
    createBtn.id = 'btn-create-tag';
    createBtn.addEventListener('click', _handleCreateTag);
    const bumpBtn = _el('button', 'btn btn--secondary', 'Bump & Release');
    bumpBtn.type = 'button';
    bumpBtn.addEventListener('click', () => App.TagActionsUI?.handleBumpAndRelease());
    btnRow.appendChild(createBtn);
    btnRow.appendChild(bumpBtn);
    body.appendChild(btnRow);

    form.appendChild(body);
    container.appendChild(form);
  }

  function _addInput(parent, label, id, placeholder, value, hint) {
    const g = _el('div', 'form-group');
    g.appendChild(_el('label', 'form-label', label));
    const input = _el('input', 'form-input');
    input.type = 'text';
    input.id = id;
    if (placeholder) input.placeholder = placeholder;
    if (value) input.value = value;
    g.appendChild(input);
    if (hint) g.appendChild(_el('div', 'form-hint', hint));
    parent.appendChild(g);
  }

  /** Pre-fill form with a computed version */
  function prefill(version) {
    const v = document.getElementById('tag-version-input');
    if (v) v.value = version;
    const m = document.getElementById('tag-message-input');
    if (m) m.value = `Release ${version}`;
    document.getElementById('tag-create-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function _handleCreateTag() {
    const version = document.getElementById('tag-version-input')?.value?.trim();
    const target = document.getElementById('tag-target-input')?.value?.trim();
    const message = document.getElementById('tag-message-input')?.value?.trim();
    if (!version) { App.UI.showToast('Tag name is required.', 'warning'); return; }
    if (!target) { App.UI.showToast('Target is required.', 'warning'); return; }

    const sha = await resolveTargetSha(target);
    if (!sha) return;

    if (document.getElementById('dry-run-toggle')?.checked) {
      App.UI.showToast(
        `[DRY RUN] Would create ${message ? 'annotated' : 'lightweight'} tag "${version}" at ${sha.slice(0, 7)}`,
        'info', 6000);
      return;
    }

    const btn = document.getElementById('btn-create-tag');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating\u2026'; }
    try {
      await App.Tags.createTag(version, sha, message, !!message);
      App.UI.showToast(`Tag "${version}" created.`, 'success');
      await App.TagsUI.loadAndRender();
    } catch (err) {
      App.UI.showToast('Failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Tag'; }
    }
  }

  /** Resolve branch name or SHA to a full commit SHA */
  async function resolveTargetSha(target) {
    const rs = App.State.get('repo');
    if (!rs) return null;
    try {
      const ref = await App.API.ghFetch(
        `/repos/${rs.owner}/${rs.repo}/git/ref/heads/${encodeURIComponent(target)}`, { ttl: 2 });
      if (ref?.object?.sha) return ref.object.sha;
    } catch (_) {}
    if (/^[0-9a-f]{7,40}$/i.test(target)) return target;
    App.UI.showToast(`Could not resolve "${target}".`, 'error');
    return null;
  }

  window.App.TagCreateUI = { renderForm, prefill, resolveTargetSha };
})();
