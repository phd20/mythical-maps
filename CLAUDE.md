# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Project

Mythical Maps is an Obsidian plugin for TTRPG maps. A map is its own `.map` file (versioned JSON) and the only source of its data. Map data is never stored in markdown notes, and there is no code-block syntax in notes. Pins link to notes by linktext. The coordinate frame matches LegendKeeper's; LegendKeeper is a design reference only, with no integration.

## Specs and Work Tracking (OpenSpec + beads)

- **Specs:** `openspec/changes/<change>/`. Read `proposal.md`, `design.md` and the relevant `specs/*/spec.md` before starting a bead. When code and spec disagree, the spec wins. If the spec is wrong, stop and report rather than diverging silently.
- **Beads is the source of truth for work status.** Each bead is one OpenSpec task: bead titles start with the task number (`4.1 …`), and the epic is `add-map-core-v1`.
- **`tasks.md` is OpenSpec's mirror of bead status, not a separate TODO list.** When a bead closes, tick the matching `- [ ] X.Y` checkbox in that change's `tasks.md`. Do not add, remove or reword tasks there by hand; new work becomes a bead first.
- Skip `epic`-type beads in `bd ready`; work only on their children.
- **Verification labels:**
  - `verify-auto`: close the bead when its acceptance criteria are met and `npm run check` passes.
  - `verify-manual`: finish the code, make `npm run check` pass, add the label `needs-human-verify`, and leave the bead **open**. Only a human closes these, after running the bead's manual checklist in `test-vault/`.

## Commit Policy (repository opt-in)

This repository explicitly allows agents to **commit once per bead**. This overrides the conservative no-commit default in the beads block above. It does **not** authorize pushes.

- Commit when a bead is closed (`verify-auto`), or when it reaches `needs-human-verify` (`verify-manual`). Make one commit per bead; don't batch several beads into one commit.
- Commit only after `npm run check` passes. Never commit a failing state, and never use `--no-verify`.
- Stage only the files for that bead, including its ticked checkbox in `tasks.md`. Don't stage unrelated changes found in the working tree; leave them and mention them at handoff.
- Message format: `<X.Y> <bead title> (<bead id>)`, for example `2.1 Coordinate frame (mm-b1f.3)`, followed by a short body saying what changed and how it was verified.
- Never push, force, rebase, amend published commits, or change branches unless a human asks in the current session.

## Build & Test

```bash
npm install
npm run check   # tsc --noEmit + eslint + vitest run + production build — must pass after every bead
npm run dev     # watch build into test-vault/.obsidian/plugins/mythical-maps/
```

(These scripts are created by bead 1.1. Until then there is no build.)

## Architecture Overview

```
src/
  core/      pure TypeScript: schema, parse/serialize, coordinate frame, ids/ranks,
             feature tree, document store (lock + undo), links, style resolution
  obsidian/  plugin entry, settings, TextFileView for .map, commands, vault map index, rename listener
  ui/        Leaflet layers, Geoman editing, toolbar, feature panel, popups
test/mocks/obsidian.ts   hand-written mock, aliased for vitest
test-vault/              manual-test vault with fixture images and .map files
```

See `openspec/changes/add-map-core-v1/design.md` (D1–D11) for the reasoning.

## Conventions & Patterns

- `src/core/` must not import `obsidian` or `leaflet`. Inject Obsidian behaviour through interfaces (`LinkResolver`, `FrontmatterReader`). Every exported core function has unit tests.
- The map model is the only state. Leaflet layers are re-rendered from the model; never read state back out of Leaflet.
- Every edit goes through `MapDocument.apply()`, which enforces the lock. Never mutate the model directly from UI code.
- Write `.map` files only in canonical form, using `stringifyMap`. Writes from outside the view (such as the rename listener) go through `vault.process`. Never write to a file that failed to parse.
- Never clear or delete a pin's `link` because it doesn't resolve; show it as broken instead.
- Scope all CSS under `.mythical-map-view`. Create DOM elements in the view's `ownerDocument` (pop-out windows), not the global `document`.
- Never write map data into markdown notes. Frontmatter is only read: for the user-named maps property and optional style overrides.
