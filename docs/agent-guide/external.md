# External (linked WhatsApp)

`/app/external` lists outside messaging accounts a person links into Macro.
WhatsApp is the only entry. The view, its rail button, its More-views entry on
mobile and the `g x` shortcut exist only with the `enable-whatsapp-linked`
flag; a deep link with the flag off goes to Home once the flag resolves. Turn
it on locally with `VITE_ENABLE_WHATSAPP_LINKED=true`.

## Where it is

- Desktop: the **External** plug button on the sidebar rail (shown by default,
  hideable in **More → Customize sidebar**), or `g x`, or **Go to External** in
  the command menu.
- Mobile: **More views → External**. It never takes a dock slot and has no
  back button, like other navigation views; the External sidebar is hidden on
  touch, so the WhatsApp page fills the pane with its added **Groups** first. Opening a
  group drills in full-screen; its **Back to WhatsApp** button returns.

## Sidebar

Desktop's External sidebar has **WhatsApp** (the page below) with every
WhatsApp group the viewer can read (their own and shared ones) nested under it,
each with its unread count and a **Read-only** tag when the viewer's WhatsApp
can't send there. The caret on WhatsApp folds the groups; folded, WhatsApp shows
their total unread count. The open group's row is highlighted.
DSS's `whatsapp_changed` gateway events refresh the lists; without one, External
re-fetches once ~3 s after opening.

## WhatsApp page states

| State | What shows |
| --- | --- |
| Not linked | Outlined WhatsApp row, the unofficial-client account-risk note, **Connect** (disabled with a tooltip when the server turns pairing off). A signed-out device reads **Reconnect**. |
| Passkey | When WhatsApp asks for a passkey, the dialog says **Confirm on your desktop**. In Macro desktop, **Confirm with passkey** runs the native `whatsapp_passkey_authenticate` command (its caBLE QR shows in the dialog) and posts the assertion to `pairing/<id>/passkey`; a returned code then shows to type on the phone. In a browser, **Continue in Macro desktop** opens `macro:///external?whatsappPairing=<id>`, which reopens the same pairing there; closing the browser dialog then doesn't cancel it. |
| Pairing | Dialog **Link WhatsApp**: a locally encoded QR (`role="img"`, name "Scan this code with WhatsApp on your phone"), **Expires in m:ss**, four numbered steps, **Cancel**. The dialog carries `ph-no-capture`. A code confirmation step shows **The codes match**; expiry or failure shows **Show a new code**. |
| Linked | A full-width list like Drive's. Its header has **Search chats** (filters every section by name or phone digits) and a slim account strip: the phone number, "Connected" and a **WhatsApp account options** menu with **Disconnect** (asks to confirm). One account at a time: to switch, disconnect and connect again. Below, the account's WhatsApp chat list (`GET chats`), newest activity first, one line per chat: a group or person icon, the name, "Group" / "Direct chat · Archived", and the last activity on the right. Row actions show on hover or keyboard focus (always on touch). While searching, **In Macro** lists matching added groups with **Open** (otherwise they are only in the sidebar). **Add to Macro**: addable groups with a one-click **Add to Macro** (no dialog, no name: the Macro group follows the WhatsApp name; unnamed groups show member names), and groups someone already shared with the viewer as "Shared with you by <owner>" with **Open**. **Can't be added (n)** is collapsed (searching unfolds it) and lists direct chats ("Can't add direct chats yet"), community and disappearing-message groups, and groups the account left, with DSS's reason. A refused add shows DSS's specific reason in that chat's row. An account paired before the chat list existed shows only groups and chats with new messages until it is re-linked. |

Cancel sends `DELETE /meta/linked/pairing/<id>`; closing after the phone links
does not. Disconnect that WhatsApp did not confirm tells the person to remove
Macro under Linked devices on their phone.

## Driving it without a WhatsApp backend

No environment has the WhatsApp session service yet, so intercept DSS
`/meta/linked/*` in the browser (Playwright `page.route`). The functional test
`apps/web/tests/functional/whatsapp-linked.spec.ts` is the reference mock: it
answers `configuration`, `account`, `connect`, `pairing/<id>` (poll and
`DELETE`), `chats` (`GET`), `groups/adopt` (`POST`, body `{group_jid}`), standalone `whatsapp-groups` routes and `disconnect`, and flips the pairing
to `success` to simulate the phone scanning. Never link a real account from an
automated run.

## Adopted group view

Open the adopted group from External's sidebar or a shared link at
`/app/external/whatsapp/:id`, in External's main pane. The retired
`/app/whatsapp-group/:id` links and saved `whatsapp-group:<id>` layouts redirect there.
The group has its own timeline, data layer and entity sharing; it does not appear
as a native channel. **Share** uses ordinary people grants, access requests,
team sharing and link sharing for `whatsapp_group`. Viewers can read the whole
timeline without connecting WhatsApp or belonging to the remote group.
In a channel composer, `@` offers **WhatsApp groups** (behind the WhatsApp flag);
posting the mention shares the group with the channel's members (View), and the
chip opens the group in External.

The timeline pages newest-first from
`GET /meta/linked/whatsapp-groups/<id>/messages`, including verified sender names,
replies, grouped reactions, edit/delete flags, attachment states, and delivery
for the caller's own sends. Entering the view marks messages read through `/read`.
Ready images and videos show inline in Chat's media grid (click opens the
viewer), sized from WhatsApp's declared width/height before they load so the
timeline opens at the bottom. Stickers show small and unframed, GIFs loop muted
in place, voice notes read **Voice note · 0:42** above an inline player; bytes
come from the imported document's presigned URL. Other ready files show as
document chips; other states show loading, unavailable or unsupported. Senders
show their WhatsApp name. `@<number>` in a body shows the person: a verified
Macro user as Chat's mention chip, anyone else their WhatsApp name in bold.
Bare URLs are links with Chat's hover preview. **Forwarded** marks forwarded
messages. Polls (read-only tallies, "Vote in WhatsApp"), locations (**Open in
Maps**, no map tiles), contact cards and WhatsApp events render as small cards
(`data-whatsapp-card="poll|location|contacts|event"`). Group changes, pins and
calls (`kind: "system"`) are one-line system rows like Chat's
(`data-system-activity="<id>"`, e.g. "Ana added Ben", "Missed group video
call"): no avatar, no actions, never unread. View-once and unknown types keep
DSS's placeholder text. The header has the group name, a **N members** button that
toggles the WhatsApp roster, and **Share**. The layout supports phone-width panes.

The composer placeholder names the caller's own sending phone ("Message Test 11
as +1…"); otherwise the reason replies are unavailable shows in its place. Sending requires view access, the caller's own connected account,
and current membership that permits posting. A shared second member can send
from their number without owning or re-adopting the group. Typing `@` in the
composer offers only the group's WhatsApp participants (not the sender, agents,
Macro items or `@here`); a picked person is sent as `@<digits>` with
`mentions: [jid]`, and a mentioning text follows files instead of captioning
them. Text/media/replies,
reactions, and edits/deletes of the caller's own recent messages use
`POST /meta/linked/whatsapp-groups/<id>/sends`; files stage through `/attachments`.
The detail's `limits` supplies allowed MIME types, bytes and the edit window.
The owner may stop syncing with `DELETE` on the group; history remains readable.

After adding, DSS imports earlier messages from the owner's phone (up to 500
messages or 90 days). The detail's `backfill` drives the header's subtitle:
**WhatsApp · Importing history…** while `pending`/`running`, **WhatsApp · Waiting
for your phone to import history** (or *the owner's phone* for shared viewers)
while `waiting_for_phone`; the same line shows above the oldest message. Imported
messages appear older than what is shown as each page lands (pushed as
`whatsapp_changed`), without moving the viewer's scroll position. `done` is
silent; `partial` leaves **Earlier messages stay in WhatsApp** above the oldest
message.

Pending and uncertain sends are read from `GET .../sends`. An `unknown` outcome
may already have arrived and must never be resent automatically. Requests are
limited to one per second per user across groups; HTTP 429 carries
`Retry-After: 1`. Retain an intent key when retrying the same request.

Mock only `/meta/linked/*` for functional verification; never link a real account.
Soup/search integration is deferred.
