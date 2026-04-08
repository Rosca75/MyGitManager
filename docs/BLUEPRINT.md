# Git Repository Insight & Versioning Manager — Blueprint v2.00

> **Codename:** `git-repo-insight`
> **Type:** Fully static web application (HTML + CSS + JavaScript)
> **Target:** Solo developers managing personal GitHub repositories from restricted environments
> **Author:** Oscar (Rosca75)

---

## 1. PURPOSE & VISION

Build a **zero-install, browser-only** web application that gives a solo developer full visibility into their GitHub repositories — branches, divergence, tags, releases, commit history — and lets them take action: commit reports, create branches, manage tags, and prepare structured exports for LLM-assisted workflows.

The app must work on a **locked-down corporate laptop** (no Node.js, no Docker, no CLI tools) by relying exclusively on the GitHub REST API and a static file served from the filesystem or a simple web server.

### 1.1 What This App Replaces

| Manual workflow today | Automated by the app |
|---|---|
| Opening GitHub UI to check branch freshness | Branch health dashboard with staleness badges |
| Running `git log` locally to compare branches | Visual divergence heatmap matrix |
| Manually tagging releases via CLI | One-click semantic version tagging |
| Forgetting which branches were merged | Merged-branch detection and cleanup suggestions |
| No changelog discipline | Auto-generated changelog from commit history |
| No structured repo health overview | Exportable analysis report for LLM consumption |

---

## 2. CORE CAPABILITIES

### 2.1 Read Capabilities

- Fetch repository metadata (name, description, visibility, default branch, license, topics)
- List all branches with last commit date, author, and commit message
- List all tags (lightweight and annotated) with associated commit and date
- List releases (published and draft) with assets and release notes
- Compare any two branches (commits ahead/behind via `/compare/{base}...{head}`)
- Retrieve file tree for a given branch (top-level, lazy-expandable)
- Fetch commit history for any branch (paginated, last N commits)
- Retrieve contributor statistics
- Detect key repository files (README, LICENSE, CONTRIBUTING, CHANGELOG, .gitignore, CI configs, Dockerfile, CLAUDE.md)

### 2.2 Write Capabilities

- Create or update files in the repository via `PUT /repos/{owner}/{repo}/contents/{path}`
- Commit analysis reports to a configurable path (default: `/analysis/`)
- Create new branches from any existing branch ref
- Create lightweight and annotated tags
- Create GitHub Releases (with auto-generated or custom release notes)
- Delete merged or stale branches (with confirmation)

### 2.3 Offline / Fallback Capabilities

- Export full analysis as structured TXT (designed for LLM ingestion)
- Export divergence matrix as JSON
- Generate manual git commands the user can copy-paste into a terminal
- Allow manual JSON import of previously cached data (future)

---

## 3. FUNCTIONAL REQUIREMENTS

### 3.1 Authentication & Repository Access

**Input formats accepted:**
- `owner/repo` shorthand
- Full GitHub URL (`https://github.com/owner/repo`)
- GitHub API URL (`https://api.github.com/repos/owner/repo`)

**Authentication:**
- Personal Access Token (PAT) — entered manually or loaded via file input
- Token stored **in memory only** (JavaScript variable), never persisted
- Token scope validation on connect (check `X-OAuth-Scopes` header)
- Display required scopes clearly: `repo`, `read:org` (if applicable)
- Rate limit display in header (remaining / limit / reset time)

### 3.2 Branch Analysis

| Feature | Detail |
|---|---|
| List all branches | Name, last commit SHA (short), date, author, message preview |
| Default branch badge | Clearly marked |
| Most recent branch | Branch with the latest commit timestamp |
| Most active branch | Branch with the highest commit frequency in last 30 days |
| Stale branch detection | Configurable threshold (default: 90 days of inactivity) |
| Merged branch detection | Compare each branch to default; if 0 commits ahead → likely merged |
| Branch age | Days since creation (first divergence from parent) |
| Protection status | Badge if branch has protection rules (via API) |

### 3.3 Divergence Analysis

- Pairwise comparison using `GET /repos/{owner}/{repo}/compare/{base}...{head}`
- Compute commits ahead and commits behind for each pair
- Generate NxN divergence matrix (limited to top N branches by activity, configurable, default: 15)
- Produce color-coded heatmap visualization:
  - Green: in sync (0 divergence)
  - Yellow: minor divergence (1–10 commits)
  - Orange: moderate divergence (11–50 commits)
  - Red: severe divergence (50+ commits)
- Click any cell to see the commit list for that comparison

### 3.4 Tag & Release Management *(NEW)*

**Tag operations:**
- List all tags with: name, associated commit SHA, date, tagger (if annotated), message
- Create new tag (lightweight or annotated) on any branch HEAD or specific commit SHA
- Suggest next semantic version based on existing tags (parse `vMAJOR.MINOR.PATCH` pattern)
- Version bump buttons: Patch / Minor / Major (auto-computes next version)
- Tag naming validation: enforce `v{semver}` pattern or allow custom
- Delete tags (with confirmation dialog)

**Release operations:**
- List existing releases: name, tag, published date, draft/prerelease status, asset count
- Create new release from an existing tag:
  - Title (default: tag name)
  - Release notes body (Markdown editor)
  - Auto-generate release notes from commits since last tag
  - Mark as pre-release or draft
- Edit existing release metadata
- Link to release assets (read-only display)

**Changelog generation *(NEW)*:**
- Parse commits between two tags (or tag → HEAD)
- Group by conventional commit prefix: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`
- Produce Markdown-formatted changelog section
- Option to commit generated CHANGELOG.md to repo

### 3.5 Repository Health Dashboard *(NEW)*

Detect and display the presence/absence of key repository files:

| File | Status indicator |
|---|---|
| `README.md` | ✅ Present / ❌ Missing |
| `LICENSE` | ✅ Present (show license type) / ⚠️ Missing |
| `CONTRIBUTING.md` | ✅ / ⚠️ |
| `CODE_OF_CONDUCT.md` | ✅ / ⚠️ |
| `CHANGELOG.md` | ✅ / ⚠️ |
| `.gitignore` | ✅ / ❌ |
| `SECURITY.md` | ✅ / ⚠️ |
| `CLAUDE.md` | ✅ / ⚠️ (relevant for AI-assisted repos) |
| `.github/workflows/` | ✅ CI/CD detected / ⚠️ None |
| `.github/CODEOWNERS` | ✅ / ⚠️ |
| `.github/ISSUE_TEMPLATE/` | ✅ / ⚠️ |
| `.github/PULL_REQUEST_TEMPLATE.md` | ✅ / ⚠️ |
| `.github/dependabot.yml` | ✅ / ⚠️ |
| `Dockerfile` / `docker-compose.yml` | ✅ / — |

Provide a **health score** (0–100%) and actionable suggestions for missing files. Offer one-click creation of missing files from templates (via write engine).

### 3.6 Commit History Explorer *(NEW)*

- Paginated commit log for any branch (20 per page, load more)
- Each commit shows: SHA (short, clickable), author avatar + name, date, message (first line), files changed count
- Filter commits by:
  - Date range
  - Author
  - Message keyword search
- Highlight conventional commit prefixes with color badges (`feat` = blue, `fix` = red, `docs` = green, etc.)

### 3.7 LLM Export Engine

Generate a structured TXT file optimized for LLM consumption, containing:

```
=== REPOSITORY ANALYSIS REPORT ===
Generated: {ISO timestamp}
Repository: {owner}/{repo}
Default Branch: {branch}
Total Branches: {N}
Total Tags: {N}

=== BRANCH SUMMARY ===
{table: name | last_commit_date | status | commits_ahead_of_default | commits_behind_default}

=== DIVERGENCE MATRIX ===
{NxN matrix in readable format}

=== TAG / RELEASE HISTORY ===
{table: tag | date | type | associated_release}

=== REPOSITORY HEALTH ===
{checklist of detected/missing files}
Health Score: {N}%

=== ACTIVITY ANALYSIS ===
Most active branch: {name} ({N} commits in last 30d)
Most recent commit: {SHA} by {author} on {date}
Stale branches (>{threshold}d): {list}
Merged candidates: {list}

=== SUGGESTED ACTIONS ===
- {actionable recommendations}

=== INSTRUCTIONS FOR LLM ===
You are analyzing the repository {owner}/{repo}.
Based on the data above, provide:
1. A summary of repository health
2. Recommendations for branch cleanup
3. Suggested next version tag based on recent commits
4. Any structural improvements to the repository
```

### 3.8 Write Engine

**Functions:**
- `createOrUpdateFile(path, content, message, branch, sha?)` — creates or updates a file
- `createBranch(name, fromRef)` — creates a branch from a SHA or branch name
- `createTag(name, sha, message?, annotated?)` — creates a tag
- `createRelease(tag, title, body, draft?, prerelease?)` — creates a GitHub release
- `deleteBranch(name)` — deletes a remote branch
- `deleteTag(name)` — deletes a tag
- `commitAnalysisReport()` — orchestrates report generation + commit

**Safety features:**
- **Dry-run mode** (default ON): shows what would happen without executing
- Confirmation dialog before every write operation
- Target branch selection for commits
- Operation log panel showing all API calls made (method, URL, status, timestamp)
- Undo suggestions where possible (e.g., "to undo this tag, run: `git tag -d v1.2.3`")

### 3.9 API Connectivity Test

- **READ test**: `GET /repos/{owner}/{repo}` — verifies token + repo access
- **WRITE test**: `PUT` a temporary `.git-insight-test` file, then delete it — verifies write permission
- **Rate limit check**: display current limits and reset time
- **Scope check**: parse `X-OAuth-Scopes` response header and warn if insufficient
- Display all results with clear pass/fail indicators

### 3.10 Multi-Repository Support *(NEW — Future Phase)*

- Maintain a list of recently accessed repositories (stored in `localStorage`, token NOT stored)
- Quick-switch dropdown between repos
- Comparative dashboard (side-by-side health scores)

---

## 4. NON-FUNCTIONAL REQUIREMENTS

| Requirement | Target |
|---|---|
| Zero backend | 100% client-side, no server |
| Zero build step | No bundler, no transpiler, no npm at dev time |
| Browser compatibility | Chrome 90+, Firefox 90+, Edge 90+ |
| Responsive layout | Usable on 1280px+ screens; graceful on tablet |
| Single entry point | One `index.html` that loads everything |
| File size budget | Total < 500KB uncompressed (no heavy frameworks) |
| API efficiency | ≤ 30 API calls for initial dashboard load (configurable) |
| Rate limit awareness | Display remaining calls; pause/queue when approaching limit |
| Offline resilience | Cached data viewable without network |
| Accessibility | Semantic HTML, keyboard navigation, sufficient contrast |
| Performance | Initial render < 2s on cached data; progressive loading for API data |

---

## 5. TECHNICAL ARCHITECTURE

### 5.1 File Structure

```
git-repo-insight/
├── index.html                  # Single entry point
├── css/
│   ├── main.css                # Layout, components, utility classes
│   └── theme.css               # CSS custom properties (light/dark)
├── js/
│   ├── app.js                  # Bootstrap, routing, top-level orchestration
│   ├── api.js                  # GitHub API wrapper (fetch, auth, rate limit, pagination)
│   ├── state.js                # Central state store (pub/sub pattern)
│   ├── ui.js                   # DOM rendering helpers, component registry
│   ├── cache.js                # localStorage cache layer with TTL
│   ├── write.js                # Write engine (create/update/delete operations)
│   ├── tags.js                 # Tag & release management logic
│   ├── health.js               # Repository health checker
│   ├── changelog.js            # Changelog generator (conventional commits parser)
│   ├── export.js               # TXT/JSON export engine
│   ├── heatmap.js              # Divergence heatmap rendering (Canvas or SVG)
│   └── utils.js                # Date formatting, semver parsing, helpers
├── templates/                  # HTML template strings for missing repo files
│   ├── README.md.tpl
│   ├── CONTRIBUTING.md.tpl
│   ├── CODE_OF_CONDUCT.md.tpl
│   ├── SECURITY.md.tpl
│   ├── CHANGELOG.md.tpl
│   └── .gitignore.tpl
├── assets/
│   └── favicon.svg
├── CLAUDE.md                   # Instruction file for Claude Code
├── README.md                   # Project documentation
├── CHANGELOG.md                # Version history
├── LICENSE                     # MIT License
├── CONTRIBUTING.md             # Contribution guidelines
├── CODE_OF_CONDUCT.md          # Contributor Covenant
├── SECURITY.md                 # Security policy
└── .gitignore                  # Git ignore rules
```

### 5.2 Data Flow

```
User Input (repo + PAT)
    │
    ▼
Token Validation & Scope Check
    │
    ▼
API Layer (api.js)
    ├── Rate limit tracking
    ├── Response caching (cache.js)
    └── Pagination handling
    │
    ▼
State Store (state.js)
    ├── repo metadata
    ├── branches[]
    ├── tags[]
    ├── releases[]
    ├── commits{}
    ├── divergence{}
    ├── health{}
    └── activity metrics
    │
    ▼
Analysis Engines
    ├── Branch analyzer (staleness, merge detection)
    ├── Divergence calculator (pairwise matrix)
    ├── Health checker (file detection)
    ├── Changelog generator (commit parser)
    └── Version suggester (semver logic)
    │
    ▼
UI Rendering (ui.js)
    ├── Dashboard panels
    ├── Interactive heatmap
    ├── Tag/release manager
    └── Operation log
    │
    ▼
Output Engines
    ├── Export (TXT/JSON)
    ├── Write Engine (API commits)
    └── Clipboard (git commands)
```

### 5.3 State Management

Use a simple pub/sub pattern — no framework.

```javascript
// state.js — Central reactive store
const State = {
  _data: {},
  _listeners: new Map(),

  set(key, value) {
    this._data[key] = value;
    (this._listeners.get(key) || []).forEach(fn => fn(value));
  },

  get(key) { return this._data[key]; },

  subscribe(key, callback) {
    if (!this._listeners.has(key)) this._listeners.set(key, []);
    this._listeners.get(key).push(callback);
  }
};
```

State keys: `repo`, `branches`, `tags`, `releases`, `commits`, `divergenceMatrix`, `healthReport`, `activityMetrics`, `rateLimits`, `operationLog`.

---

## 6. API LAYER DESIGN

### 6.1 Centralized Fetch Wrapper

```javascript
// api.js — All GitHub API calls go through this
async function ghFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `token ${getToken()}`,
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers
    }
  });

  // Update rate limit display
  updateRateLimits(response.headers);

  // Handle errors
  if (!response.ok) {
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      throw new RateLimitError(response.headers.get('X-RateLimit-Reset'));
    }
    throw new ApiError(response.status, await response.json());
  }

  return response;
}
```

### 6.2 Endpoints Used

**READ:**
| Endpoint | Purpose |
|---|---|
| `GET /repos/{owner}/{repo}` | Repository metadata |
| `GET /repos/{owner}/{repo}/branches?per_page=100` | Branch list |
| `GET /repos/{owner}/{repo}/branches/{branch}` | Branch details + protection |
| `GET /repos/{owner}/{repo}/compare/{base}...{head}` | Branch divergence |
| `GET /repos/{owner}/{repo}/tags?per_page=100` | Tag list |
| `GET /repos/{owner}/{repo}/releases?per_page=30` | Release list |
| `GET /repos/{owner}/{repo}/commits?sha={branch}&per_page=20` | Commit history |
| `GET /repos/{owner}/{repo}/git/refs/tags` | Detailed tag refs |
| `GET /repos/{owner}/{repo}/git/tags/{sha}` | Annotated tag details |
| `GET /repos/{owner}/{repo}/contents/{path}` | File existence check |
| `GET /repos/{owner}/{repo}/contributors` | Contributor stats |
| `GET /rate_limit` | Rate limit status |

**WRITE:**
| Endpoint | Purpose |
|---|---|
| `PUT /repos/{owner}/{repo}/contents/{path}` | Create/update file |
| `DELETE /repos/{owner}/{repo}/contents/{path}` | Delete file |
| `POST /repos/{owner}/{repo}/git/refs` | Create branch |
| `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}` | Delete branch |
| `POST /repos/{owner}/{repo}/git/refs` | Create lightweight tag |
| `POST /repos/{owner}/{repo}/git/tags` | Create annotated tag object |
| `DELETE /repos/{owner}/{repo}/git/refs/tags/{tag}` | Delete tag |
| `POST /repos/{owner}/{repo}/releases` | Create release |
| `PATCH /repos/{owner}/{repo}/releases/{id}` | Update release |

### 6.3 Optimization Strategy

- **Cache responses** in `localStorage` with TTL (default: 5 minutes for branches, 30 minutes for tags/releases)
- **Conditional requests** using `If-None-Match` / `ETag` headers (saves rate limit on 304 responses)
- **Limit branch comparisons**: only compare top N most active branches (configurable, default 15)
- **Lazy-load comparisons**: compute divergence on-demand per row, not full matrix at once
- **Pagination**: auto-follow `Link` headers for complete branch/tag lists
- **Batch display**: render partial results as they arrive (progressive loading)
- **Request queue**: serialize API calls to avoid bursts; pause when rate limit < 10%

---

## 7. UI / UX DESIGN

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  HEADER: [repo input] [connect] [PAT load] [rate limit] │
├──────────┬──────────────────────────────────────────────┤
│ SIDEBAR  │  MAIN CONTENT                                │
│          │                                              │
│ • Overview│  Tab-based panels:                          │
│ • Branches│  ┌──────────────────────────────────────┐   │
│ • Tags    │  │  Active Tab Content                  │   │
│ • Releases│  │                                      │   │
│ • Diverge │  │  (tables, heatmap, forms, etc.)      │   │
│ • Health  │  │                                      │   │
│ • Commits │  └──────────────────────────────────────┘   │
│ • Export  │                                              │
│ • Actions │  ┌──────────────────────────────────────┐   │
│           │  │  Operation Log (collapsible footer)   │   │
│           │  └──────────────────────────────────────┘   │
└──────────┴──────────────────────────────────────────────┘
```

### 7.2 Visual Elements

- **Color scheme**: CSS custom properties for light/dark theme toggle
- **Heatmap**: Canvas-rendered divergence matrix with hover tooltips
- **Badges**: `default`, `stale`, `most-recent`, `most-active`, `merged`, `protected`
- **Status indicators**: green/yellow/red dots for health items
- **Semver display**: `v1.2.3` with major/minor/patch segments color-highlighted
- **Commit prefixes**: colored pills (`feat` blue, `fix` red, `docs` green, `chore` gray)
- **Toast notifications**: non-blocking success/error messages
- **Loading skeletons**: placeholder UI while API data loads

### 7.3 Key Interactions

| Action | Behavior |
|---|---|
| Click branch row | Expand details: commits, divergence from default, actions |
| Click heatmap cell | Show commit diff list for that branch pair |
| Click tag | Show release info, option to create release from tag |
| "Bump Version" buttons | Compute next semver, pre-fill tag creation form |
| "Create Release" | Form with tag selector, title, Markdown body, prerelease toggle |
| "Generate Changelog" | Select two tags → produce grouped commit list |
| "Export Report" | Download TXT file; option to commit to repo |
| "Delete Branch" | Confirmation dialog → API call → refresh |
| Toggle dry-run | Global switch; all write operations show preview instead of executing |

---

## 8. SECURITY MODEL

| Rule | Implementation |
|---|---|
| Token in memory only | Stored in JS variable, never in `localStorage` or cookies |
| No persistent credentials | Token lost on page refresh (by design) |
| No external transmission | Token only sent to `api.github.com` via `Authorization` header |
| HTTPS only | All API calls use HTTPS; refuse HTTP |
| Scope minimization | Guide user to create token with minimum required scopes |
| Clear security warning | Banner explaining token handling on first load |
| CSP headers | If self-hosted, recommend `Content-Security-Policy` restricting to `api.github.com` |
| No eval / inline scripts | All JS in external files; no `eval()` or `innerHTML` with user data |
| XSS prevention | All dynamic content inserted via `textContent` or sanitized |

---

## 9. ENTERPRISE CONSTRAINT HANDLING

| Scenario | Fallback |
|---|---|
| GitHub API read blocked (firewall) | Manual JSON import of cached data (future); display clear error |
| GitHub API write blocked | TXT export with copy-paste git commands |
| CORS blocked | Detect via `TypeError: Failed to fetch`; show instructions for proxy or local usage |
| Self-signed certificates | Document how to serve via local HTTP server |
| Token creation restricted | Document minimum PAT scopes; support fine-grained tokens |

---

## 10. SEMANTIC VERSIONING STRATEGY *(NEW)*

This app should guide the user toward disciplined semantic versioning:

### 10.1 Version Detection

- Scan existing tags matching `v{MAJOR}.{MINOR}.{PATCH}` or `{MAJOR}.{MINOR}.{PATCH}`
- Support pre-release suffixes: `-alpha.N`, `-beta.N`, `-rc.N`
- Sort tags by semver precedence (not lexicographic)
- Display current version prominently in the Overview panel

### 10.2 Version Suggestion Engine

Based on commits since the last tag:
- If any commit contains `BREAKING CHANGE:` or uses `!` suffix → suggest **MAJOR** bump
- If any commit starts with `feat:` or `feat(scope):` → suggest **MINOR** bump
- Otherwise (only `fix:`, `docs:`, `chore:`, etc.) → suggest **PATCH** bump
- Display the suggestion with reasoning: "3 feat commits detected → suggest v1.3.0"

### 10.3 Tag + Release Workflow

One-click workflow:
1. Show suggested version with editable override
2. Preview auto-generated release notes (grouped by conventional commit type)
3. Choose: create tag only, or tag + GitHub Release
4. Optional: commit updated CHANGELOG.md before tagging
5. Execute (or show dry-run preview)

---

## 11. REPOSITORY SCAFFOLDING TEMPLATES *(NEW)*

When the health checker detects missing files, offer to create them from best-practice templates.

### 11.1 README.md Template

```markdown
# {repo_name}

> Brief description of what this project does.

## Quick Start

\`\`\`bash
# Installation / setup instructions
\`\`\`

## Features

- Feature 1
- Feature 2

## Usage

Describe how to use the project.

## Development

\`\`\`bash
# How to set up development environment
# How to run tests
\`\`\`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the {license_type} License — see [LICENSE](LICENSE).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
```

### 11.2 CONTRIBUTING.md Template

```markdown
# Contributing to {repo_name}

## How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit using conventional commits: `feat: add new feature`
4. Push to your fork: `git push origin feature/your-feature`
5. Open a Pull Request

## Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation change
- `chore:` — Maintenance task
- `refactor:` — Code refactoring
- `test:` — Adding or updating tests
- `perf:` — Performance improvement
- `ci:` — CI/CD changes
- `build:` — Build system changes

## Branch Naming

- `feature/{description}` — New features
- `fix/{description}` — Bug fixes
- `hotfix/{description}` — Urgent production fixes
- `release/{version}` — Release preparation
- `docs/{description}` — Documentation updates

## Code Review

All changes require a Pull Request review before merging.
```

### 11.3 CHANGELOG.md Template (Keep a Changelog format)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
### Changed
### Fixed
### Removed

## [0.1.0] - {date}

### Added
- Initial release
```

### 11.4 SECURITY.md Template

```markdown
# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email: {contact} or use GitHub's private vulnerability reporting
3. Include: description, steps to reproduce, potential impact

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |
```

### 11.5 .gitignore Template (Web project)

```
# Dependencies
node_modules/

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp

# Environment
.env
.env.local

# Build output
dist/
build/

# Logs
*.log

# Temporary
tmp/
temp/
```

---

## 12. CLAUDE.md — INSTRUCTION FILE FOR CLAUDE CODE

This section defines the `CLAUDE.md` file that will live at the repository root. It is the **single most important file** for AI-assisted development of this project.

### Design Principles for This CLAUDE.md

Based on best practices research:
- Keep under 150 lines (Claude Code's system prompt already consumes ~50 of the ~200 instruction budget)
- Only include instructions that Claude would get wrong without them
- Use progressive disclosure: reference doc files rather than embedding everything
- Provide concrete commands, not vague guidance
- Focus on the WHY, WHAT, and HOW

### Proposed CLAUDE.md Content

```markdown
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
```

---

## 13. REPOSITORY FILES CHECKLIST

The repository MUST include these files before v1.0.0:

| File | Purpose | Priority |
|---|---|---|
| `README.md` | Project overview, quick start, screenshots | P0 — required |
| `LICENSE` | MIT License | P0 — required |
| `CLAUDE.md` | Claude Code instruction file | P0 — required |
| `CHANGELOG.md` | Version history (Keep a Changelog format) | P0 — required |
| `.gitignore` | Ignore OS/IDE/temp files | P0 — required |
| `CONTRIBUTING.md` | How to contribute, commit conventions | P1 — before public |
| `CODE_OF_CONDUCT.md` | Contributor Covenant v2.1 | P1 — before public |
| `SECURITY.md` | Vulnerability reporting process | P1 — before public |
| `docs/BLUEPRINT.md` | This document (full project specification) | P0 — required |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Bug report template | P2 — nice to have |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Feature request template | P2 — nice to have |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR description template | P2 — nice to have |

---

## 14. DEVELOPMENT PHASES

### Phase 1 — Foundation (MVP)
- [ ] Repository scaffolding (all P0 files)
- [ ] `index.html` with layout skeleton
- [ ] `api.js` — GitHub API wrapper with auth, rate limiting, error handling
- [ ] `state.js` — pub/sub state store
- [ ] `cache.js` — localStorage cache with TTL
- [ ] `ui.js` — DOM rendering helpers
- [ ] Authentication flow (PAT input, validation, scope check)
- [ ] Repository metadata display (Overview panel)
- [ ] Branch listing with badges (default, stale, most recent)
- [ ] API connectivity test panel

### Phase 2 — Analysis
- [ ] Divergence calculation engine
- [ ] Heatmap visualization (Canvas)
- [ ] Branch detail expansion (click to see commits, divergence)
- [ ] Merged branch detection
- [ ] Activity metrics (most active branch, commit frequency)
- [ ] Repository health checker (file detection)

### Phase 3 — Tags & Releases
- [ ] Tag listing with semver sorting
- [ ] Tag creation (lightweight + annotated)
- [ ] Semver suggestion engine (parse commits, suggest bump)
- [ ] Release creation from tag
- [ ] Changelog generation (conventional commits parser)
- [ ] One-click "version bump + tag + release" workflow

### Phase 4 — Write Engine & Export
- [ ] Write engine (create/update files, create branches)
- [ ] Dry-run mode (preview without executing)
- [ ] Confirmation dialogs for all write operations
- [ ] Operation log panel
- [ ] TXT export (structured LLM report)
- [ ] JSON export (divergence matrix, health report)
- [ ] Template-based file creation (scaffold missing repo files)

### Phase 5 — Polish
- [ ] Dark/light theme toggle
- [ ] Responsive layout refinement
- [ ] Keyboard navigation
- [ ] Loading skeletons and progressive rendering
- [ ] Error handling edge cases (expired token, deleted repo, network failure)
- [ ] Performance optimization (request queuing, lazy loading)
- [ ] README with screenshots/GIFs

### Phase 6 — Future Extensions
- [ ] Multi-repository quick-switch
- [ ] Offline analysis from ZIP upload
- [ ] Git graph visualization (branch topology)
- [ ] Commit diff viewer (file-level changes)
- [ ] Branch archiving via tags (`archive/{branch}` pattern)

---

## 15. PERFORMANCE STRATEGY

- **Budget**: ≤ 30 API calls for initial dashboard (repo metadata + branches + tags + health files)
- **Caching**: all GET responses cached with configurable TTL; ETag-based conditional requests
- **Progressive loading**: render available data immediately; load divergence matrix on-demand
- **Request serialization**: queue API calls; never fire more than 2 concurrent requests
- **Rate limit governor**: if remaining < 100 calls, switch to cache-only mode and show warning
- **Lazy computation**: divergence matrix computed per-row when scrolled into view
- **Debounced inputs**: search/filter fields debounced at 300ms

---

## 16. ERROR HANDLING STRATEGY

| Error | User-facing behavior |
|---|---|
| Invalid token | Clear error message + link to GitHub token creation page |
| Token lacks required scopes | Show which scopes are missing and which are needed |
| Repository not found | Suggest checking spelling, visibility, and token scope |
| Rate limit exceeded | Show countdown to reset; offer to work with cached data |
| Network failure | Retry once after 2s; then show offline mode suggestion |
| CORS error | Detect and show specific instructions (proxy, local file serving) |
| Write conflict (409) | Show the conflict, offer to fetch latest SHA and retry |
| Branch protected | Show protection details; suggest creating a new branch instead |
| API 5xx error | Retry with exponential backoff (max 3 attempts) |

---

## 17. BACKSTOP / FALLBACK STRATEGY

When the app cannot complete an operation via API, it generates the equivalent git commands:

```bash
# Example: Create tag when API write is blocked
git tag -a v1.3.0 -m "Release v1.3.0 — feat: add tag management panel"
git push origin v1.3.0

# Example: Delete stale branch
git push origin --delete feature/old-experiment

# Example: Create branch from main
git checkout -b analysis/2026-04-08 main
git push origin analysis/2026-04-08
```

These commands are displayed in a copyable code block and included in the TXT export.

---

## 18. LLM INTEGRATION WORKFLOW

```
Step 1: Open app → Connect to repo → Dashboard loads
Step 2: Review branch health, divergence, repo health score
Step 3: Click "Export Report" → Download structured TXT
Step 4: Paste TXT into Claude / ChatGPT / other LLM
Step 5: LLM generates: cleanup recommendations, version suggestion,
        changelog draft, code improvements
Step 6: User copies actionable output back into app
Step 7: App executes via Write Engine (or shows git commands)
```

---

**END OF BLUEPRINT v2.00**

*This document should be placed at `docs/BLUEPRINT.md` in the repository and referenced from CLAUDE.md.*
