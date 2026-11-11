/**
 * `macro:styles`: Macro's look for HTML pages shown in a preview. A page opts
 * in with <link rel="stylesheet" href="macro:styles">; the preview replaces
 * the link with the viewer's theme tokens and this sheet, and keeps the tokens
 * current when the theme changes. The page's own styles after the link win.
 * Class names are a contract with stored pages: add, don't rename.
 */
export const MACRO_STYLESHEET = `:root {
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --control-height: 32px;
  --control-height-sm: 28px;
  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 15px;
  --text-lg: 18px;
  --text-xl: 20px;
  --shadow-raised: 0 1px 2px rgb(0 0 0 / 0.12);
  --shadow-menu: 0 2px 6px -3px rgb(0 0 0 / 0.12), 0 1px 2px -1px rgb(0 0 0 / 0.08);
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--color-surface, var(--color-page));
  color: var(--color-ink);
  font: 400 var(--text-sm) / 1.43 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Text */

h1, h2, h3, h4 { margin: 0; color: var(--color-ink); font-weight: 600; letter-spacing: -0.005em; }
h1 { font-size: var(--text-xl); line-height: 1.3; }
h2 { font-size: var(--text-lg); line-height: 1.35; }
h3 { font-size: var(--text-sm); line-height: 1.43; }
h4 { font-size: var(--text-xs); line-height: 1.4; color: var(--color-ink-subtle); font-weight: 500; }
p { margin: 0; }
small, .text-xs { font-size: var(--text-xs); }
.text-base { font-size: var(--text-base); line-height: 1.5; }
.muted { color: var(--color-ink-muted); }
.subtle { color: var(--color-ink-subtle); }
.label {
  color: var(--color-ink-subtle);
  font-size: var(--text-xs);
  font-weight: 500;
}
.num { font-variant-numeric: tabular-nums; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
a { color: var(--color-link); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; }
code, kbd, pre { font-family: var(--font-mono); font-size: 0.92em; }
code {
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-ink) 5%, transparent);
}
pre {
  margin: 0;
  padding: var(--space-3);
  overflow: auto;
  border: 1px solid var(--color-edge-muted);
  border-radius: var(--radius-md);
  background: var(--color-panel);
}
pre code { padding: 0; background: none; }
hr { border: 0; border-top: 1px solid var(--color-edge-muted); margin: var(--space-3) 0; }
::selection { background: color-mix(in oklch, var(--color-accent) 24%, transparent); }

/* Layout */

.page { display: flex; flex-direction: column; min-height: 100vh; }
.content { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }
.stack { display: flex; flex-direction: column; gap: var(--space-2); }
.stack.loose { gap: var(--space-4); }
.cluster { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.spread { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.grow { flex: 1 1 auto; min-width: 0; }
.grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); }
.split { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr) minmax(0, 320px); align-items: start; }
@media (max-width: 720px) { .split { grid-template-columns: minmax(0, 1fr); } }

/* The view's top bar: title, then tabs on the left; actions on the right. */
.bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface, var(--color-page));
  border-bottom: 1px solid var(--color-edge-muted);
}
.bar > h1, .bar > .title { font-size: var(--text-sm); font-weight: 600; margin: 0; }
.bar .actions { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end; }

/* Surfaces */

.card {
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-edge-muted);
  border-radius: var(--radius-lg);
  background: var(--color-panel);
}
.card.flush { padding: 0; overflow: hidden; }
.card:where(button, a, [tabindex], .interactive) { cursor: pointer; text-align: left; font: inherit; color: inherit; transition: border-color 120ms; }
.card:where(button, a, [tabindex], .interactive):hover { border-color: var(--color-edge); }
.card[aria-selected="true"], .card.selected { border-color: var(--color-ink-subtle); box-shadow: 0 0 0 1px var(--color-ink-subtle); }
.card > header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-2); }
.inset {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-ink) 3%, transparent);
}
.section-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-ink-subtle);
  font-size: var(--text-xs);
  font-weight: 500;
}
.menu {
  padding: var(--space-1);
  border: 1px solid var(--color-edge-frame);
  border-radius: var(--radius-lg);
  background: var(--color-dialog);
  box-shadow: var(--shadow-menu);
}

/* Lists: rows like Macro's entity lists, hover and selected tints. */

.list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 6px var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-ink);
}
.list.divided > .row { border-radius: 0; border-bottom: 1px solid var(--color-edge-muted); }
.list.divided > .row:last-child { border-bottom: 0; }
.row:where(button, a, [tabindex], .interactive) { cursor: pointer; text-align: left; width: 100%; border: 0; background: none; font: inherit; text-decoration: none; }
.row:where(button, a, [tabindex], .interactive):hover { background: var(--color-hover); }
.row[aria-selected="true"], .row.selected { background: var(--color-selected); }
.row .meta { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); color: var(--color-ink-subtle); font-size: var(--text-xs); flex-shrink: 0; }

/* Controls */

button, .button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--control-height);
  padding: 2px 12px;
  border: 1px solid var(--color-edge-button);
  border-radius: var(--radius-full);
  background: var(--color-control);
  box-shadow: var(--shadow-raised);
  color: var(--color-ink-muted);
  font: 500 var(--text-sm) / 1 var(--font-sans);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color 120ms, color 120ms, border-color 120ms;
}
button:hover, .button:hover { color: var(--color-ink); background: color-mix(in oklch, var(--color-control) 94%, var(--color-ink)); }
button:active, .button:active, button[aria-pressed="true"] { color: var(--color-ink); background: color-mix(in oklch, var(--color-control) 88%, var(--color-ink)); box-shadow: none; }
button:disabled, .button[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
button:focus-visible, .button:focus-visible, .row:focus-visible, .tabs button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
button.primary, .button.primary { border-color: transparent; background: var(--color-ink); color: var(--color-surface, var(--color-page)); }
button.primary:hover, .button.primary:hover { background: color-mix(in oklch, var(--color-ink) 82%, var(--color-page)); color: var(--color-surface, var(--color-page)); }
button.accent, .button.accent { border-color: transparent; background: var(--color-accent); color: var(--color-accent-contrast, #fff); }
button.accent:hover, .button.accent:hover { background: color-mix(in oklch, var(--color-accent) 85%, black); color: var(--color-accent-contrast, #fff); }
button.ghost, .button.ghost { border-color: transparent; background: transparent; box-shadow: none; }
button.ghost:hover, .button.ghost:hover { background: var(--color-hover); }
button.danger, .button.danger { border-color: transparent; background: color-mix(in oklch, var(--color-failure) 10%, transparent); color: var(--color-failure); box-shadow: none; }
button.danger:hover, .button.danger:hover { background: color-mix(in oklch, var(--color-failure) 22%, transparent); color: var(--color-failure); }
button.sm, .button.sm { min-height: var(--control-height-sm); padding: 2px 10px; font-size: var(--text-xs); }
button.icon, .button.icon { width: var(--control-height); padding: 0; }
button.icon.sm, .button.icon.sm { width: var(--control-height-sm); }

input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"]), select, textarea {
  min-width: 0;
  min-height: var(--control-height);
  padding: 4px 12px;
  border: 1px solid var(--color-edge-frame);
  border-radius: var(--radius-full);
  background: var(--color-control);
  color: var(--color-ink);
  font: 400 var(--text-sm) / 1.4 var(--font-sans);
  outline: none;
  transition: box-shadow 120ms, border-color 120ms;
}
textarea { border-radius: var(--radius-md); padding: 8px 12px; resize: vertical; }
select { padding-right: 28px; appearance: none; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--color-ink-subtle) 50%), linear-gradient(135deg, var(--color-ink-subtle) 50%, transparent 50%);
  background-position: calc(100% - 15px) 52%, calc(100% - 11px) 52%;
  background-size: 4px 4px;
  background-repeat: no-repeat;
}
input::placeholder, textarea::placeholder { color: var(--color-ink-placeholder); }
input:focus-visible, select:focus-visible, textarea:focus-visible { box-shadow: 0 0 0 2px var(--color-edge-muted); }
input[aria-invalid="true"], textarea[aria-invalid="true"] { border-color: var(--color-failure); }
input[type="checkbox"], input[type="radio"], input[type="range"] { accent-color: var(--color-accent); }
label { color: var(--color-ink-muted); font-size: var(--text-xs); font-weight: 500; }
label:has(> input[type="checkbox"], > input[type="radio"]) { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-sm); font-weight: 400; color: var(--color-ink); cursor: pointer; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

/* Tabs: a flat pill track with the selected tab as an inset pill. */
.tabs {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--color-edge-button);
  border-radius: var(--radius-full);
  background: var(--color-control);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs button {
  min-height: 26px;
  padding: 2px 10px;
  border: 1px solid transparent;
  background: transparent;
  box-shadow: none;
  font-size: var(--text-sm);
}
.tabs button:hover { background: var(--color-hover); }
.tabs button[aria-selected="true"], .tabs button[aria-pressed="true"] {
  border-color: var(--color-edge-frame);
  background: var(--color-panel);
  color: var(--color-ink);
}

/* Chips and badges */

.chip, .badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 1px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: color-mix(in oklch, var(--color-ink) 6%, transparent);
  color: var(--color-ink-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}
.chip { border-color: var(--color-edge-muted); background: transparent; }
.badge.accent { background: color-mix(in oklch, var(--color-accent) 12%, transparent); color: var(--color-accent); }
.badge.success { background: color-mix(in oklch, var(--color-success) 12%, transparent); color: var(--color-success); }
.badge.warning { background: color-mix(in oklch, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.badge.failure { background: color-mix(in oklch, var(--color-failure) 12%, transparent); color: var(--color-failure); }
/* Any color: style="--tone: var(--color-orange)". */
.badge.tone { background: color-mix(in oklch, var(--tone) 14%, transparent); color: var(--tone); }
.chip.tone { border-color: color-mix(in oklch, var(--tone) 40%, transparent); color: var(--tone); }
.dot { display: inline-block; flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.status-not-started { color: var(--color-task-status-not-started); }
.status-in-progress { color: var(--color-task-status-in-progress); }
.status-in-review { color: var(--color-task-status-in-review); }
.status-completed { color: var(--color-task-status-completed); }
.status-canceled { color: var(--color-task-status-canceled); }
.success { color: var(--color-success); }
.warning { color: var(--color-warning); }
.failure { color: var(--color-failure); }

.avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: color-mix(in oklch, var(--color-accent) 18%, var(--color-panel));
  color: var(--color-ink);
  font-size: 10px;
  font-weight: 600;
}

/* Data */

.metric { display: flex; flex-direction: column; gap: 2px; }
.metric .value { font-size: 24px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.metric .label { order: -1; }
.metric .caption { color: var(--color-ink-subtle); font-size: var(--text-xs); }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { padding: 6px var(--space-3); border-bottom: 1px solid var(--color-edge-muted); color: var(--color-ink-subtle); font-size: var(--text-xs); font-weight: 500; text-align: left; white-space: nowrap; }
td { padding: 8px var(--space-3); border-bottom: 1px solid var(--color-edge-muted); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--color-hover); }
.progress { height: 4px; border-radius: var(--radius-full); background: color-mix(in oklch, var(--color-ink) 8%, transparent); overflow: hidden; }
.progress > span { display: block; height: 100%; border-radius: inherit; background: var(--color-accent); }

/* States */

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 32px var(--space-4);
  border: 1px dashed var(--color-edge-muted);
  border-radius: var(--radius-lg);
  color: var(--color-ink-muted);
  text-align: center;
}
.empty strong { color: var(--color-ink); font-weight: 500; }
.notice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-ink) 4%, transparent);
  color: var(--color-ink-muted);
  font-size: var(--text-xs);
}
.notice.failure { background: color-mix(in oklch, var(--color-failure) 10%, transparent); color: var(--color-failure); }
.skeleton {
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--color-ink) 8%, transparent);
  animation: macro-pulse 1.4s ease-in-out infinite;
}
@keyframes macro-pulse { 50% { opacity: 0.5; } }
.toast {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 50;
  max-width: min(360px, calc(100vw - 32px));
  padding: 10px var(--space-3);
  border: 1px solid var(--color-edge-frame);
  border-radius: var(--radius-lg);
  background: var(--color-dialog);
  box-shadow: var(--shadow-menu);
  color: var(--color-ink);
}

/* Charts: put .chart on an svg (or its container) for themed text, axes, grid
   and marks; d3 axes' .domain and .tick lines pick it up as they are. */
.chart text { fill: var(--color-ink-subtle); font: 11px var(--font-sans); font-variant-numeric: tabular-nums; }
.chart .domain, .chart .tick line, .chart .axis { stroke: var(--color-edge-muted); }
.chart .gridline { stroke: var(--color-edge-muted); stroke-dasharray: 2 3; }
.chart .track { fill: color-mix(in oklch, var(--color-ink) 6%, transparent); }
.chart .mark { fill: var(--color-accent); }
.chart .line { fill: none; stroke: var(--color-accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .area { fill: color-mix(in oklch, var(--color-accent) 14%, transparent); }
.chart .today { stroke: var(--color-accent); stroke-width: 1.5; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--color-ink-muted); font-size: var(--text-xs); }
.legend > * { display: inline-flex; align-items: center; gap: 6px; }
/* Categorical series in order, so the nth series has the same color everywhere. */
.series-1 { --series: var(--color-blue); }
.series-2 { --series: var(--color-orange); }
.series-3 { --series: var(--color-teal); }
.series-4 { --series: var(--color-pink); }
.series-5 { --series: var(--color-violet); }
.series-6 { --series: var(--color-lime); }
.series-7 { --series: var(--color-amber); }
.series-8 { --series: var(--color-cyan); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
@media (pointer: coarse) {
  button, .button, input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"]), select { min-height: 36px; }
  .row { min-height: 44px; }
}
`;
