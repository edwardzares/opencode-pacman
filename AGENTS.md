# AGENTS.md

Pac-Man clone in vanilla JS/HTML/CSS, used as a practice project for spec-driven development. No framework, bundler, package manager, or linter. Tests use Node's built-in runner with no dependencies.

## Run and verify

- Open `src/index.html` directly in a browser; no server or build step is needed. On Windows: `start src/index.html`.
- Automated tests: `node --test tests/` (Node 18+). They load `maze.js`, `game.js` and `render.js` into a Node `vm` context with stubbed browser globals, so no DOM or install step is required.
- Verification is manual: Start button hides the overlay, arrow keys move Pac-Man, dots add 10 points, row 14 wraps horizontally, 3 collisions end the game, clearing all dots wins.
- Do not add npm/tooling scaffolding unless the user asks; there is no `package.json` and nothing to install.

## Code wiring

- `src/index.html` loads plain (non-module) scripts in a fixed order: `maze.js` → `game.js` → `render.js` → `main.js`. They communicate through browser globals (`MAZE`, `PACMAN_START`, `GHOST_STARTS`, `TUNNEL_ROW`, `DIRS`, `createGame`, `update`, `draw`, exposed on `window`). New files must be added to `index.html` in dependency order; `import`/`export` will not work as-is.
- `maze.js` defines `MAZE` as the pristine 28×31 numeric matrix parsed from `MAZE_STR`. `createGame()` copies it into `game.grid`; never mutate `MAZE` itself.
- Tile values: `0` empty, `1` wall, `2` dot, `3` ghost-pen door (blocks Pac-Man only). Row 14 is the wrap-around tunnel.
- Actors move in fractional cell coordinates. Speeds `0.125` (Pac-Man) and `0.1` (ghosts) intentionally land on whole cells so turning/eating checks (`aligned`, tolerance `1e-3`) run periodically. Changing speeds to values that do not align to integers breaks movement logic.
- Canvas is 560×620 with `TILE = 20`, i.e. exactly 28×31 tiles. Keep these in sync with maze dimensions.
- UI/state flow lives in `main.js`: `requestAnimationFrame` loop, keyboard mapping, and an overlay rebuilt by `showOverlay()`; win/lose text is in Spanish (`GANASTE`/`PERDISTE`).

## Spec-driven workflow

- `README.md` states the project's purpose is learning spec-driven development. `.agents/skills/spec/` and `.agents/skills/spec-impl/` are the installed workflow skills (also available as `spec` and `spec-impl`).
- `specs/` does not exist yet; the first spec is `specs/01-<slug>.md`. The `/spec` flow must ask clarifying questions before writing, never write game code, save as `Draft`, and leave approval to the human. `/spec-impl` only proceeds on specs whose status means "Approved" and creates/uses branch `spec-NN-slug`.
- Step commits and branch creation are controlled by `specs/.spec-config.yml` (defaults: `AutoCreateBranch: true`, `AutoCommitSteps: false`).
- `skills-lock.json` pins the vendored skills; do not hand-edit it or the files under `.agents/skills/`.

## Conventions

- Project docs, code comments, and UI text are in Spanish. Keep them Spanish unless asked otherwise; match the language of existing specs when adding new ones.
- No test/lint commands exist. If verification tooling is ever introduced, document the exact command here.
