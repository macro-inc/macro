# External (external chats)

`/app/external` lists outside messaging accounts a person links into Macro and
the chats added from them (entity type `external_chat`, one provider per
chat). WhatsApp is the only provider today. The view, its rail button, its More-views entry on
mobile and the `g x` shortcut exist only with the `enable-whatsapp-linked`
flag; a deep link with the flag off goes to Home once the flag resolves. Turn
it on locally with `VITE_ENABLE_WHATSAPP_LINKED=true`.

## Where it is

- Desktop: the **External** plug button on the sidebar rail (shown by default,
  hideable in **More → Customize sidebar**), or `g x`, or **Go to External** in
  the command menu.
- Mobile: **External** in the bottom dock (or **More views → External** when
  the dock is full). It has no back button, like other navigation views; the
  External sidebar is hidden on touch, so the WhatsApp page fills the pane with its **In Macro** chats first. Opening a
  chat drills in full-screen; its **Back to WhatsApp** button returns.

## Sidebar

Desktop's External sidebar has one entry per provider; **WhatsApp** (the page
below) has every WhatsApp chat the viewer can read (their own and shared ones; a person icon for
direct chats, a group icon for groups) nested under it in folding sections like
Chat's rail: **Direct messages**, **Groups**, and **Communities** with one
section per community (its groups by their own name, its announcement group as
"Announcements"), each newest activity first. Rows show the unread count and a
**Read-only** tag when the viewer's WhatsApp can't send there; a folded section
shows its unread total, and folded sections are remembered per person. The
caret on WhatsApp folds everything; folded, WhatsApp shows the total unread
count. The open chat's row is highlighted. On phones the page starts with the
same sections under **In Macro**.
DSS's `external_chat_changed` gateway events (`{scope:"chats"}` for the
account's chat list, `{scope:"chat", chatId}` for one chat) refresh the lists;
without one, External re-fetches once ~3 s after opening.

## WhatsApp page states

| State | What shows |
| --- | --- |
| Not linked | Outlined WhatsApp row and **Connect**. A signed-out device reads **Reconnect**. A phone can't scan its own screen, so at phone width (touch, under 640px) there is no **Connect**; the row says to open Macro on a computer and scan its code with the phone. Tablets keep **Connect**. |
| Passkey | When WhatsApp asks for a passkey, the dialog says **Confirm on your desktop**. In Macro desktop, **Confirm with passkey** runs the native `whatsapp_passkey_authenticate` command (its caBLE QR shows in the dialog) and posts the assertion to `/whatsapp/pairing/<id>/passkey`; a returned code then shows to type on the phone. In a browser, **Continue in Macro desktop** opens `macro:///external?whatsappPairing=<id>`, which reopens the same pairing there; closing the browser dialog then doesn't cancel it. |
| Pairing | Dialog **Link WhatsApp**: a locally encoded QR (`role="img"`, name "Scan this code with WhatsApp on your phone") that follows WhatsApp's rotating codes, four numbered steps, **Cancel**. The dialog carries `ph-no-capture`. When a pairing expires (WhatsApp ran out of codes, ~2.7 minutes, or the 5-minute deadline) while the tab stays visible, the dialog shows **Refreshing code…** and starts a new pairing on its own, up to three times; after that, or if the tab was hidden, the QR square reads **Code expired** with **Show a new code**. A failure (not expiry) says **Linking didn't finish.** with **Show a new code**. |
| Linked | A full-width list like Drive's. Its header has **Search chats** (filters every section by name or phone digits) and a slim account strip: the phone number, "Connected" and a **WhatsApp account options** menu with **Disconnect** (asks to confirm). One account at a time: to switch, disconnect and connect again. Below, the account's WhatsApp chat list (`GET /whatsapp/chats`), newest activity first, one line per chat: a group, person or (announcement group) megaphone icon, the name ("Community · Group", or "Community · Announcements"), "Group" / "Community group" / "Announcement group" / "Direct chat · Archived", and the last activity on the right. Row actions show on hover or keyboard focus (always on touch). Chats sit in folding sections like the sidebar's (**Direct messages**, **Groups**, **Communities** with one section per community), remembered per person; a search opens every section and also lists matching added chats with **Open** (otherwise they are only in the sidebar). Addable chats (direct chats, community groups and disappearing-message groups included) have a one-click **Add to Macro** (no dialog, no name: the Macro chat follows the WhatsApp name; unnamed groups show member names), and groups someone already shared with the viewer as "Shared with you by <owner>" with **Open**. **Can't be added (n)** is collapsed (searching unfolds it) and lists the chat with yourself, communities themselves ("A community has no messages of its own; add one of its groups"), and groups the account left, each with its reason. A refused add shows DSS's specific reason in that chat's row. An account paired before the chat list existed shows only groups and chats with new messages until it is re-linked. |

Cancel sends `DELETE /whatsapp/pairing/<id>`; closing after the phone links
does not; closing while a new code is starting cancels that pairing too.
Disconnect results show as a toast; one WhatsApp did not confirm tells the
person to remove Macro under Linked devices on their phone.

## Driving it without a WhatsApp backend

No environment has the WhatsApp session service yet, so intercept DSS
`/whatsapp/*` and `/external-chats*` in the browser (Playwright `page.route`).
The functional test `apps/web/tests/functional/whatsapp-linked.spec.ts` is the
reference mock: it answers `whatsapp/account`, `whatsapp/connect`,
`whatsapp/pairing/<id>` (poll and `DELETE`), `whatsapp/chats` (`GET`),
`whatsapp/disconnect`, `external-chats` (`GET` the list; `POST` adds, body
`{provider: "whatsapp", remoteId: <jid>, kind}`), the `external-chats/<id>/…`
routes and `entities/external_chat/<id>/…`, and flips the pairing to `success`
to simulate the phone scanning. Never link a real account from an
automated run.

## External chat view

A group and a direct (one-to-one) chat open in the same view
(`features/external-chat`); both are an `external_chat` with `kind` `group` or
`direct` and a `provider`. A direct chat's header is the person and its details have no **Members**;
only its owner can send, and anyone it's shared with reads "Only
<owner> can reply in this chat" in place of the composer.

Open the added chat from External's sidebar or a shared link at
`/app/external/chat/:chatId`, in External's main pane.
The chat has its own timeline, data layer and entity sharing; it does not appear
as a native channel. **Share** uses ordinary people grants, access requests,
team sharing and link sharing for `external_chat`. Viewers can read the whole
timeline without connecting WhatsApp or belonging to the remote group.
In a channel composer, `@` offers the viewer's own external chats (behind the
WhatsApp flag) with their provider's logo; posting the mention shares the chat
with the channel's members (View), and the chip opens the chat in External. The owner sees those
channels in **Share** and can remove them.

The timeline pages newest-first from
`GET /external-chats/<id>/messages`, including verified sender names,
replies, grouped reactions, edit/delete flags, attachment states, and delivery
for the caller's own sends. Entering the view marks messages read through `/read`.
The timeline uses Chat's layout: rows and the composer share Chat's centered
message column (`macro-message-width`) and custom scrollbar, and the view
stays at the bottom while media loads unless the reader scrolled up. A sent
image shows its local preview at once and keeps it, sized, when the stored
message replaces the pending one.
Ready images and videos show inline in Chat's media grid (click opens the
viewer), sized from WhatsApp's declared width/height before they load so the
timeline opens at the bottom. Stickers show small and unframed, GIFs loop muted
in place, voice notes read **Voice note · 0:42** above an inline player; bytes
come from the attachment's static file, like Chat's media. Other ready files
(PDF, text) show as file chips that open the stored file in a new tab; other
states show loading, unavailable or unsupported. Senders
show their WhatsApp name. `@<number>` in a body shows the person: a verified
Macro user as Chat's mention chip, anyone else their WhatsApp name in bold.
Bare URLs are links with Chat's hover preview. **Forwarded** marks forwarded
messages. Polls (read-only tallies, "Vote in WhatsApp"), locations (**Open in
Maps**, no map tiles), contact cards and WhatsApp events render as small cards
(`data-whatsapp-card="poll|location|contacts|event"`). Group changes, pins and
calls (`kind: "system"`) are one-line system rows like Chat's
(`data-system-activity="<id>"`, e.g. "Ana added Ben", "Missed group video
call"): no avatar, no actions, never unread. View-once media show like any
media; unknown types keep DSS's placeholder text. The header has the provider's badge and the chat name ("Community · Group"
for a community's group), a timer icon when WhatsApp's disappearing messages
are on (the timeline's start also says "Disappearing messages are on in
WhatsApp (7 days). Macro keeps them."), **Share**, and the standard side panel
toggle (**Show Side Panel**, `]`; **Show details** on touch). Like an in-view
email thread, the details float over the timeline (`aside[aria-label="Block
details"]`, outside click or the toggle closes them, starts closed; on a
pane 900px or wider the timeline and composer move left to make room) and are a
bottom sheet on touch. Sections: **Members (n)** (groups only; list
`WhatsApp members`, you first, then admins, then by name, each with number and
an **Admin** badge, a search box past 12), **Sharing** (**Share…** opens the
same share dialog), **Syncing** (owner only: **Stop syncing** asks to confirm),
and "Owned by <owner>". The layout supports phone-width panes.

The composer placeholder names the caller's own sending phone ("Message Test 11
as +1…"); otherwise the reason replies are unavailable shows in its place. Sending requires view access, the caller's own connected account,
and current membership that permits posting. A shared second member can send
from their number without owning or re-adding the chat. Typing `@` in the
composer offers only the group's WhatsApp participants (not the sender, agents,
Macro items or `@here`); a picked person is sent as `@<digits>` with
`mentions: [jid]`, and a mentioning text follows files instead of captioning
them. Text/media/replies,
reactions, and edits/deletes of the caller's own recent messages use
`POST /external-chats/<id>/sends`; files stage through `/attachments`.
The detail's `limits` supplies allowed MIME types, bytes and the edit window.
The owner may stop syncing (details → **Syncing**, groups and direct chats) with
`DELETE /external-chats/<id>`; history remains readable.

After adding, DSS imports earlier messages from the owner's phone (up to 500
messages or 90 days). The detail's `backfill` drives the header's subtitle:
**WhatsApp · Importing history…** while `pending`/`running`, **WhatsApp · Waiting
for your phone to import history** (or *the owner's phone* for shared viewers)
while `waiting_for_phone`; the same line shows above the oldest message.
`waiting_for_message` (nobody has posted since adding, so nothing to import
from yet) shows nothing; the first message starts the import. Imported
messages appear older than what is shown as each page lands (pushed as
`external_chat_changed`), without moving the viewer's scroll position. `done` is
silent; `partial` leaves **Earlier messages stay in WhatsApp** above the oldest
message.

Pending and uncertain sends are read from `GET .../sends`. An `unknown` outcome
may already have arrived and must never be resent automatically. Requests are
limited to one per second per user across groups; HTTP 429 carries
`Retry-After: 1`. Retain an intent key when retrying the same request.

Mock only `/whatsapp/*` and `/external-chats*` for functional verification;
never link a real account.
Soup/search integration is deferred.
