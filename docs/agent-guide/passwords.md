# Passwords

Passwords is a Macro-managed team vault. The `enable-passwords` feature flag
controls its sidebar entry and `/passwords` route. A team membership is required.
Authorized Macro servers decrypt values on explicit reveal or copy; this is a
team vault with server-side decryption.

Open Passwords from the app rail. All items, Favorites, Recently used, Shared,
and folders filter the metadata list; search matches names and websites. New
folder creates an inline input. Desktop rows drag onto folders; editing an item
also offers Move to folder. On a phone, Password navigation expands the filters,
and opening an item replaces the list; Back returns to the list.

New item and Edit use the detail pane. Name is required and websites must use
HTTP or HTTPS. Save publishes changes; Cancel discards them. Changing selection
with a draft offers Discard changes and Keep editing. Closing or navigating away
is guarded while a draft exists. Generate password opens an anchored generator
with length control and Use password.

Reveal password and Copy password require a sign-in within the server's recent
reauthentication window. Sign in again renews that proof. Revealed values clear
when selection changes, on Lock Passwords, after a minute, when the app loses focus or becomes hidden, or on unmount.
Explicit lock also discards editor drafts and pending verification-code seeds.
Unsaved plaintext drafts also clear on loss of focus or visibility. Values
are never kept in the query cache or browser storage. Password history lists
versions and reveals an explicitly selected version through the same gate.

Share opens an anchored people/team grant editor; permissions are Can view or
Can edit. Verification code setup accepts a TOTP secret. Show verification code
retrieves the current code and refreshes it when its validity expires. Replace
and Remove verification code update the item's TOTP enrollment. Activity shows
server audit events. Brand icons come from Macro's authenticated image proxy;
failed icons show a letter tile.

The backend-free desktop and phone interaction suite mounts the actual vault
with an injected fake source:

```sh
bunx playwright test --config src/features/passwords/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the Nix Chrome binary when required.
The fixture suite complements authenticated local-stack verification.
