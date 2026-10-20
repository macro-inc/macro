---
name: update-translations
description: Bring the web app's interface translations up to date with its English text. Use for the periodic translation update, when `bun run i18n:status` reports missing or stale messages, or when asked to translate new UI text.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Update interface translations

Changes add and edit English only; this update translates them into every
other interface language. Run everything from `apps/web`. Conventions are in
`.agents/rules/web/i18n.md`; wording is in `src/lib/i18n/glossary.md`.

## 1. Start from main

`git fetch origin main && git checkout -B i18n/update-<yyyy-mm-dd> origin/main`.

## 2. Find untranslated text

- `bun run i18n:status --json` lists, per language, messages that are
  `missing` (no translation), `stale` (the English changed since it was
  translated), or have a `placeholderMismatch`.
- English that never went through `t()` doesn't show there. Literal labels on
  menu items fail CI (`tsx-menu-label-translated`), but other surfaces can
  slip through: labels in config objects (`label: 'Foo'`), sidebar and
  command definitions, tab names. Read the `apps/web/src` diff of changes
  merged since the last update
  (`git log --since='8 days ago' --format='%h %s' origin/main -- apps/web/src`)
  for user-visible text with a string literal in new UI, menus, or
  navigation. Move each into `src/lib/i18n/locales/en/<namespace>.ts` and
  render it with `t()`, following the rule. Leave surfaces that aren't
  translated yet (most page content; the slides, canvas, spreadsheet, and
  database editors) alone, so no page mixes languages.

Nothing missing, stale, or newly converted: stop, without a branch or PR.

## 3. Translate

For each key, write the translation in every `src/lib/i18n/locales/<language>.ts`
file, in the key's namespace, in the same order as English.

- Translate from the current English and the surface it appears on (find it
  with `grep -rn "'<namespace>.<key>'" src`), not from the old translation.
- Use the glossary's form of address and its words for product terms. A new
  product term gets a row in every language's glossary table.
- Keep `{{placeholders}}` exactly; use the language's quotation marks.
- Prefer the shorter of two equally clear wordings; menus cap at 22rem.
- Don't touch translations that aren't missing or stale, and never edit the
  English.

## 4. Record and check

1. `bun run i18n:status --accept all`, then `bun run i18n:status`: every
   language reports `up to date`.
2. `bun run test -- src/lib/i18n` passes (stray keys, placeholders).
3. `just test-i18n-browser` passes in every language. A clipped label lists
   its text: shorten that translation rather than widening the menu. The
   check renders every key in the context-menu namespaces; a label in another
   namespace that renders in a narrow space gets added to `MENUS` in
   `src/lib/i18n/browser-test/menus.tsx`.
4. Converted any literals in step 2? `bunx --yes @ast-grep/cli@0.44.1 scan`
   from the repository root, and the tests of the touched features.

## 5. Open the PR

Commit and open a ready-for-review PR per the `git` skill, titled like
`chore(web): update interface translations`. Say which messages changed and
why (new, changed English, converted literals), and list any glossary terms
added so a native speaker can check them.
