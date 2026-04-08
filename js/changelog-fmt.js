/**
 * changelog-fmt.js — Markdown formatter for changelogs
 *
 * Formats a structured changelog (from changelog.js) into
 * Keep a Changelog formatted Markdown.
 *
 * Blueprint reference: §3.4 — Changelog generation
 */
(function () {
  'use strict';

  /** Display order and labels for changelog groups */
  const GROUP_ORDER = [
    { key: 'breaking',  label: 'Breaking Changes' },
    { key: 'feat',      label: 'Added' },
    { key: 'fix',       label: 'Fixed' },
    { key: 'refactor',  label: 'Changed' },
    { key: 'perf',      label: 'Performance' },
    { key: 'docs',      label: 'Documentation' },
    { key: 'other',     label: 'Other' }
  ];

  /**
   * Format a structured changelog as Keep a Changelog Markdown.
   * @param {object} changelog  Output from generateChangelog()
   * @returns {string}
   */
  function formatChangelogMarkdown(changelog) {
    const lines = [];
    const version = changelog.toRef || 'Unreleased';
    lines.push(`## [${version}] - ${changelog.date}`);
    lines.push('');

    let hasContent = false;

    GROUP_ORDER.forEach(({ key, label }) => {
      const entries = changelog.groups[key];
      if (!entries || entries.length === 0) return;

      hasContent = true;
      lines.push(`### ${label}`);
      lines.push('');

      entries.forEach(entry => {
        const cc = entry.conventional;
        if (cc) {
          const scopeStr = cc.scope ? `**${cc.scope}:** ` : '';
          lines.push(`- ${scopeStr}${cc.description}`);
        } else {
          lines.push(`- ${entry.firstLine}`);
        }
      });

      lines.push('');
    });

    if (!hasContent) {
      lines.push('No notable changes.');
      lines.push('');
    }

    return lines.join('\n');
  }

  // Attach to existing Changelog namespace
  if (window.App?.Changelog) {
    window.App.Changelog.formatChangelogMarkdown = formatChangelogMarkdown;
  }

})();
