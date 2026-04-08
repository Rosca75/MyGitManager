/**
 * changelog.js — Conventional Commits parser and changelog generator
 *
 * Parses commit messages per the Conventional Commits spec,
 * groups them by type, and produces structured changelog data.
 *
 * Blueprint reference: §3.4 — Changelog generation
 */
(function () {
  'use strict';

  window.App = window.App || {};

  /** Valid conventional commit types */
  const VALID_TYPES = [
    'feat', 'fix', 'docs', 'chore', 'refactor',
    'perf', 'test', 'build', 'ci'
  ];

  /** Commit types grouped under "Other" in changelogs */
  const OTHER_TYPES = ['chore', 'test', 'build', 'ci'];

  /**
   * Parse a conventional commit message.
   * Handles: "feat:", "feat(scope):", "feat!:", "fix:", etc.
   * Detects "BREAKING CHANGE:" in commit body/footer.
   *
   * @param {string} message  Full commit message (may include body)
   * @returns {{ type: string, scope: string|null,
   *             breaking: boolean, description: string } | null}
   */
  function parseConventionalCommit(message) {
    if (!message) return null;
    const firstLine = message.split('\n')[0].trim();

    const re = /^([a-z]+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/;
    const m = firstLine.match(re);
    if (!m) return null;

    const type = m[1];
    if (!VALID_TYPES.includes(type)) return null;

    const bodyBreaking = message.includes('BREAKING CHANGE:')
                      || message.includes('BREAKING-CHANGE:');

    return {
      type,
      scope: m[2] || null,
      breaking: !!m[3] || bodyBreaking,
      description: m[4].trim()
    };
  }

  /**
   * Generate a structured changelog from commits between two refs.
   * @param {string|null} fromTag  Start tag (null = repo beginning)
   * @param {string} toRef        End ref (tag, branch, or SHA)
   * @returns {Promise<object>}
   */
  async function generateChangelog(fromTag, toRef) {
    const repoState = App.State.get('repo');
    if (!repoState) throw new Error('Not connected');
    const { owner, repo } = repoState;

    let commits = [];
    if (fromTag) {
      try {
        const cmp = await App.API.ghFetch(
          `/repos/${owner}/${repo}/compare/${encodeURIComponent(fromTag)}...${encodeURIComponent(toRef)}`,
          { ttl: 5 }
        );
        commits = cmp?.commits || [];
      } catch (err) {
        throw new Error(`Compare ${fromTag}...${toRef}: ${err.message}`);
      }
    } else {
      try {
        commits = await App.API.getCommits(owner, repo, toRef, 1, 100);
      } catch (err) {
        throw new Error(`Fetch commits: ${err.message}`);
      }
    }

    const parsed = commits.map(c => {
      const msg = c.commit?.message || '';
      return {
        sha: c.sha,
        message: msg,
        firstLine: msg.split('\n')[0],
        author: c.commit?.author?.name || c.author?.login || 'Unknown',
        date: c.commit?.author?.date || null,
        conventional: parseConventionalCommit(msg)
      };
    });

    // Group by type
    const groups = {
      breaking: [], feat: [], fix: [],
      refactor: [], perf: [], docs: [], other: []
    };

    parsed.forEach(entry => {
      if (entry.conventional?.breaking) groups.breaking.push(entry);
      if (!entry.conventional) { groups.other.push(entry); return; }
      const t = entry.conventional.type;
      if (OTHER_TYPES.includes(t)) groups.other.push(entry);
      else if (groups[t]) groups[t].push(entry);
      else groups.other.push(entry);
    });

    return {
      fromTag, toRef,
      date: new Date().toISOString().slice(0, 10),
      totalCommits: commits.length,
      groups, commits: parsed
    };
  }

  window.App.Changelog = {
    parseConventionalCommit,
    generateChangelog,
    /** Placeholder — formatChangelogMarkdown is in changelog-fmt.js */
    formatChangelogMarkdown: null
  };

})();
