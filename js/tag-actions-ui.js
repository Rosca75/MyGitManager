/**
 * tag-actions-ui.js — Tag delete confirmation and Bump & Release workflow
 *
 * Confirmation dialog for tag deletion and the one-click
 * "Bump & Release" flow (preview changelog, create tag + release).
 *
 * Blueprint reference: §3.4, §10.3 — Tag + Release Workflow
 */
(function () {
  'use strict';
  window.App = window.App || {};

  /** Create a modal overlay with click-to-dismiss */
  function _overlay() {
    const el = document.createElement('div');
    el.className = 'confirm-overlay';
    el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
    return el;
  }

  /** Show delete confirmation for a tag */
  function confirmDelete(tagName) {
    const ov = _overlay();
    const dlg = document.createElement('div');
    dlg.className = 'confirm-dialog';
    dlg.setAttribute('role', 'alertdialog');
    const msg = document.createElement('p');
    msg.className = 'confirm-dialog__msg';
    msg.textContent = `Delete tag "${tagName}"? This cannot be undone.`;
    const row = document.createElement('div');
    row.className = 'confirm-dialog__actions';

    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn--secondary'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => ov.remove());

    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.className = 'btn btn--danger'; confirm.textContent = 'Delete';
    confirm.addEventListener('click', async () => {
      if (document.getElementById('dry-run-toggle')?.checked) {
        App.UI.showToast(`[DRY RUN] Would delete tag "${tagName}"`, 'info'); ov.remove(); return;
      }
      confirm.disabled = true; confirm.textContent = 'Deleting\u2026';
      try {
        await App.Tags.deleteTag(tagName);
        App.UI.showToast(`Tag "${tagName}" deleted.`, 'success');
        ov.remove(); await App.TagsUI.loadAndRender();
      } catch (err) { App.UI.showToast('Delete failed: ' + err.message, 'error'); ov.remove(); }
    });

    row.appendChild(cancel); row.appendChild(confirm);
    dlg.appendChild(msg); dlg.appendChild(row);
    ov.appendChild(dlg); document.body.appendChild(ov); confirm.focus();
  }

  /** One-click Bump & Release: generate changelog, show preview, create tag + release */
  async function handleBumpAndRelease() {
    const version = document.getElementById('tag-version-input')?.value?.trim();
    const target = document.getElementById('tag-target-input')?.value?.trim();
    const tagMsg = document.getElementById('tag-message-input')?.value?.trim();
    if (!version) { App.UI.showToast('Enter a version first.', 'warning'); return; }
    if (!target) { App.UI.showToast('Target is required.', 'warning'); return; }

    const sha = await App.TagCreateUI.resolveTargetSha(target);
    if (!sha) return;

    App.UI.showToast('Generating changelog\u2026', 'info', 2000);
    const latest = App.Tags.getLatestVersion();
    let cl;
    try { cl = await App.Changelog.generateChangelog(latest?.tag?.name || null, target); }
    catch (err) { App.UI.showToast('Changelog failed: ' + err.message, 'error'); return; }

    const md = App.Changelog.formatChangelogMarkdown({ ...cl, toRef: version });
    _showPreview(version, sha, tagMsg, md);
  }

  function _showPreview(version, sha, tagMsg, md) {
    const dryRun = document.getElementById('dry-run-toggle')?.checked;
    const ov = _overlay();
    const dlg = document.createElement('div');
    dlg.className = 'confirm-dialog confirm-dialog--wide';

    const title = document.createElement('h3');
    title.className = 'confirm-dialog__title';
    title.textContent = (dryRun ? '[DRY RUN] ' : '') + `Bump & Release ${version}`;
    dlg.appendChild(title);

    // Operations list
    const ops = document.createElement('div');
    ops.className = 'bump-preview-ops';
    [`Create ${tagMsg ? 'annotated' : 'lightweight'} tag "${version}" at ${sha.slice(0, 7)}`,
     `Create GitHub Release "${version}"`].forEach(text => {
      const item = document.createElement('div');
      item.className = 'bump-preview-op';
      item.textContent = (dryRun ? '[DRY RUN] ' : '') + text;
      ops.appendChild(item);
    });
    dlg.appendChild(ops);

    const lbl = document.createElement('div');
    lbl.className = 'form-label'; lbl.textContent = 'Release Notes Preview';
    dlg.appendChild(lbl);
    const ta = document.createElement('textarea');
    ta.className = 'form-input bump-preview-notes'; ta.rows = 10; ta.value = md;
    dlg.appendChild(ta);

    const row = document.createElement('div');
    row.className = 'confirm-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn--secondary'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => ov.remove());

    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn btn--primary';
    ok.textContent = dryRun ? 'Close (Dry Run)' : 'Create Tag & Release';
    ok.addEventListener('click', async () => {
      if (dryRun) {
        App.UI.showToast(`[DRY RUN] Would create tag + release "${version}"`, 'info', 6000);
        ov.remove(); return;
      }
      ok.disabled = true; ok.textContent = 'Creating\u2026';
      try {
        await App.Tags.createTag(version, sha, tagMsg, !!tagMsg);
        App.UI.showToast(`Tag "${version}" created.`, 'success');
        await App.Tags.createRelease(version, version, ta.value, false, false);
        App.UI.showToast(`Release "${version}" created.`, 'success');
        ov.remove(); await App.TagsUI.loadAndRender();
      } catch (err) {
        App.UI.showToast('Failed: ' + err.message, 'error');
        ok.disabled = false; ok.textContent = 'Retry';
      }
    });

    row.appendChild(cancel); row.appendChild(ok);
    dlg.appendChild(row); ov.appendChild(dlg); document.body.appendChild(ov);
  }

  window.App.TagActionsUI = { confirmDelete, handleBumpAndRelease };
})();
