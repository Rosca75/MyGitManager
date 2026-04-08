# git-repo-insight

## What This Is
A zero-dependency, fully static web app (HTML + CSS + vanilla JS) that analyzes
GitHub repositories via the REST API. No Node.js, no build tools, no frameworks.
Runs by opening index.html in a browser.

## Architecture
- Entry point: index.html (loads all JS via <script> tags, no ES modules)
- /js/*.js — each file is an IIFE or attaches to a global namespace object
- /css/ — plain CSS with custom properties for theming
- /templates/ — .tpl files containing Markdown template strings
- State management: pub/sub pattern in state.js (no framework)
- All GitHub API calls go through ghFetch() in api.js

## Hard Constraints
- NO npm, NO bundlers, NO transpilers, NO build step
- NO ES module imports/exports (use script tags + global namespace)
- NO external JS libraries (no jQuery, no React, no D3)
- NO inline event handlers in HTML (use addEventListener)
- NO innerHTML with dynamic data (XSS risk) — use textContent or DOM API
- NO storing tokens in localStorage/cookies — memory only
- All API calls MUST go through the ghFetch() wrapper in api.js
- All state changes MUST go through State.set() in state.js

## Code Style
- Vanilla JS, ES2020+ syntax (async/await, optional chaining, nullish coalescing)
- Functions: descriptive names, JSDoc comments for public functions
- Heavily commented — explain WHY, not just WHAT
- CSS: BEM-like class naming (.panel__header, .badge--stale)
- HTML: semantic elements (section, nav, article, button — not div for everything)

## File Conventions
- New feature = new JS file in /js/ + corresponding section in index.html
- Each JS file wraps in IIFE: (function() { ... })();
- Expose public API on global: window.App.moduleName = { ... };
- Constants at top of file, helpers below, public API at bottom

## Testing
There is no test framework. Verify by:
1. Open index.html in browser
2. Open DevTools console — should be zero errors
3. Connect to a test repo and verify each panel loads
4. Test write operations with dry-run mode ON first
5. Check responsive layout at 1280px and 768px widths

## Key Decisions
- Canvas (not SVG) for heatmap — better performance for NxN grid
- localStorage cache with TTL — see cache.js for implementation
- Conventional Commits parsing for changelog — see changelog.js
- Semver parsing is custom (no library) — see utils.js parseSemver()

## When Compacting
Always preserve: list of modified files, current feature being built,
any failing test details, and the file structure from section 5.1 of
the blueprint (see docs/BLUEPRINT.md).

## Reference Docs
- Full blueprint: docs/BLUEPRINT.md (this file you're reading now)
- GitHub REST API: https://docs.github.com/en/rest
- Conventional Commits: https://www.conventionalcommits.org/
- Semantic Versioning: https://semver.org/
- Keep a Changelog: https://keepachangelog.com/
