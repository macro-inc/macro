# Hotkey profiles

## What it is

Another app's keyboard shortcuts inside one Macro view: Superhuman's in Email,
Linear's in Tasks. People turn a profile on in Settings → Keyboard shortcuts;
the choice is saved to their account (`/user/hotkey-profiles`,
`crates/user_hotkey_profiles`). Behind `enable-hotkey-profiles`.

## How it works

A profile is data (`core/profiles.ts`). Each binding runs either an existing
command by hotkey token (`runTokenCommand`) or an action its view supplies. A
view calls `useHotkeyProfile` beside its own keys. The engine runs profile
commands before every other command on the same key in their scope, and never
eclipses them (`HotkeyCommand.profile`, `lib/core/hotkey`), so the defaults come
back as soon as the profile is off.

## Start here

- `core/profiles.ts`: the keymaps, and the vendor keys Macro already shares.
- `primitives/use-hotkey-profile.ts`: how bindings become registrations,
  including `g`/`o` followers and profile-owned leaders (Linear's `m`).
- `email-view/use-superhuman-hotkeys.ts`, `tasks-view/use-linear-hotkeys.ts`:
  each view's actions.

## Recipes

- Add a key: a binding in `core/profiles.ts`, an English string in
  `lib/i18n/locales/en/hotkey-profiles.ts`, and the action in the view's hook
  if it runs no existing token. Set `replaces` when it takes over a Macro key
  in that view, and check the `?` sheet's "Replaced by" group agrees. A vendor
  key Macro already uses for the same thing goes in `sameKeys` with a label.
  Every entry names one of the profile's `sections`, which Settings lists in
  that order.
- Add a profile: a backend enum variant in `crates/user_hotkey_profiles`, regenerate the
  clients, then a definition here and its `setProfile` branch in
  `queries/hotkey-profiles-source.ts`.

## Checks

- `bun run test src/features/hotkey-profiles src/lib/core/hotkey`

## Gotchas

- Register a binding in the scope of the key it replaces: a nearer scope's key
  wins, so a view-scope binding can't take over a key that an Email thread in
  the reading pane defines in its own scope.
- A token binding falls through to the default when the action can't run here;
  an action returning false does too.
- Hotkeys are off on touch devices, so the Settings section lives only on the
  desktop Shortcuts page.
