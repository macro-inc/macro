# Passwords

Passwords is a Macro-managed team vault: Macro's servers decrypt protected
values on explicit reveal or copy. The `enable-passwords-v1` feature flag controls
the `/passwords` route, and the route also needs a team: without the flag it
redirects to Home, and without a team it shows "Passwords is for teams". The
rail entry and phone dock entry appear only when both hold. By default the rail
entry sits below Calendar and above Agents; a saved custom rail order without
it gets it right after Calendar, and the user can reorder it like any other.

The view uses the shared view shell and standard shimmering skeletons while
the team or password list loads. The inner sidebar (Drive's sidebar
patterns) has a New dropdown, All items, Favorites, Recently used, Shared, and
a Folders section: a Passwords root row and the folder tree, built from Drive's
`FolderTree`. Folders nest; selecting one lists its items and its subfolders'
items. Drag a folder onto another folder to nest it, or onto Passwords to
move it to the root; a folder cannot move into itself or its descendants. Item
rows drag onto a folder (or Passwords to unfile). Escape or switching away
cancels a drag. Right-click a
folder, or open the "…" folder actions beside New in the list header, for New
subfolder, Rename (inline), Move to folder (an inline destination list), and
Delete folder. Delete confirms in place and says how many items move to All
items and how many subfolders go too; it never deletes items or their values.
Folder rows use the same Tab, Enter and Space controls as Drive; context menus
use arrow keys and Escape. Inline names commit with Enter and cancel with Escape.
On a phone, the header pills are All, Favorites, Recent, Shared and Folders;
Folders shows the same tree, and the floating New button opens the item kinds.
Create folders from the Folders section's "+" on desktop or in the phone's
Folders tab. A failed create offers Retry with the original name and parent.

New opens a menu to pick the kind first: Login, Card, Secure note, Identity,
API credential, or Verification code. Each kind's form and detail label
the shared username, password, website and notes values for that kind (Card:
Cardholder and Card number; API credential: Endpoint, Key and Secret; Identity
and Card start with labeled custom fields such as Expires or Email; those
template fields type in the clear, while secret ones such as Security code and
fields you add stay masked). A new item
appears as a Draft row at the top of the list. New items belong to the team
and are shared with it by default; the form's Shared with team / Private
control leaves out the team grant (team admins and people it is shared with
still have access). The list labels each item Team or Private. Share changes sharing afterwards. Share,
Delete item and dragging into folders appear only for items the viewer can
manage (their creator or a team admin). Edit and Add verification code
appear only for items the viewer can edit; a view-only share can still reveal
and copy. Drafts and in-place edits stay
in memory while you select other items, start other kinds, lock, switch apps or
hide the tab; Discard or a successful Save ends them. Leaving the view with
drafts asks Keep editing or Discard and leave. Name is required and websites
must use HTTP or HTTPS. Drafts are never written to the query cache or browser
storage.

A Verification code item needs its secret key (or `otpauth://` link) before it
saves. The item saves first and the key enrolls next; if enrollment fails the
draft stays open on the saved item with a notice, and Save retries only the
enrollment. Logins can add a verification code in the form or the detail pane.
Show verification code loads the current code with a countdown ring and reloads
it when it expires; a failed load offers Retry.

The detail header shows the logo tile, name, folder path and kind, then
Favorite, Share, Edit and "…" (Activity, Delete item). Usernames load with a
Copy action and never reveal the password. Any signed-in team member with
access can reveal and copy the password, notes and verification code; there is
no separate re-sign-in step. Revealed values and codes clear on Lock
Passwords (a client-side conceal only), after a minute, when the window loses
focus or the tab hides, on selection change, or on unmount. Password history
reveals an explicitly selected version. The generator
picks a length (12–128) and character classes; every selected class is always
present, and characters are drawn uniformly with rejection sampling.

When an agent asks to use an item, the item's human creator and the team's
admins get an inbox row, "<agent> requested access to <item>", grouped under
the current team while Passwords is enabled. Opening the row or a notification
in its stack selects the requested item in Passwords; teams have no separate
inbox page, and requests for another team are hidden. In the detail pane,
people who can manage the item see Agent access: a pending request offers Allow
view, Allow edit and Deny, and an agent that can use the item offers Remove
access ("Remove approval" also appears for an approved shared grant). A request
that changed meanwhile shows the latest state with a notice after a successful
refresh. The section loads inside the item pane using a local skeleton; a
failed read offers Retry, and obsolete actions stay hidden until that retry
succeeds. The section is
hidden when the agent vault is off or the viewer can't review, and ordinary
sharing never lists agents.

The backend-free desktop and phone interaction suite mounts the actual vault
with an injected fake source:

```sh
bunx playwright test --config src/features/passwords/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the Nix Chrome binary when required.
The fixture suite complements authenticated local-stack verification.

