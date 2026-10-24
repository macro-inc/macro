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
  back button, like other navigation views; the External list sidebar is
  hidden on touch, so the WhatsApp page fills the pane.

## WhatsApp page states

| State | What shows |
| --- | --- |
| Not linked | Outlined WhatsApp row, the unofficial-client account-risk note, **Connect** (disabled with a tooltip when the server turns pairing off). A signed-out device reads **Reconnect**. |
| Passkey | When WhatsApp asks for a passkey, the dialog says **Confirm on your desktop**. In Macro desktop, **Confirm with passkey** runs the native `whatsapp_passkey_authenticate` command (its caBLE QR shows in the dialog) and posts the assertion to `pairing/<id>/passkey`; a returned code then shows to type on the phone. In a browser, **Continue in Macro desktop** opens `macro:///external?whatsappPairing=<id>`, which reopens the same pairing there; closing the browser dialog then doesn't cancel it. |
| Pairing | Dialog **Link WhatsApp**: a locally encoded QR (`role="img"`, name "Scan this code with WhatsApp on your phone"), **Expires in m:ss**, four numbered steps, **Cancel**. The dialog carries `ph-no-capture`. A code confirmation step shows **The codes match**; expiry or failure shows **Show a new code**. |
| Linked | Account row with the phone number, **Use a different account** (asks to confirm, then pairs with `replace: true`) and **Disconnect** (asks to confirm), then **Your WhatsApp groups**: adopted groups show **In Macro** with an unread badge (opens the standalone group), others **Add to Macro**. Community and disappearing-message groups say why they can't be added. |
| Add to Macro | Dialog **Add “<group>” to Macro**: a group name prefilled from the subject and **Add to Macro**. The adopter owns the entity and shares it afterward with the normal Share dialog. |

Cancel sends `DELETE /meta/linked/pairing/<id>`; closing after the phone links
does not. Disconnect that WhatsApp did not confirm tells the person to remove
Macro under Linked devices on their phone.

## Driving it without a WhatsApp backend

No environment has the WhatsApp session service yet, so intercept DSS
`/meta/linked/*` in the browser (Playwright `page.route`). The functional test
`apps/web/tests/functional/whatsapp-linked.spec.ts` is the reference mock: it
answers `configuration`, `account`, `connect`, `pairing/<id>` (poll and
`DELETE`), `groups` (`GET`), `groups/adopt` (`POST`), standalone `whatsapp-groups` routes and `disconnect`, and flips the pairing
to `success` to simulate the phone scanning. Never link a real account from an
automated run.

## Adopted group view

Open the adopted group from External or a shared link at `/app/whatsapp-group/:id`.
The group has its own timeline, data layer and entity sharing; it does not appear
as a native channel. **Share** uses ordinary people grants, access requests,
team sharing and link sharing for `whatsapp_group`. Viewers can read the whole
timeline without connecting WhatsApp or belonging to the remote group.

The timeline pages newest-first from
`GET /meta/linked/whatsapp-groups/<id>/messages`, including verified sender names,
replies, grouped reactions, edit/delete flags, attachment states, and delivery
for the caller's own sends. Entering the view marks messages read through `/read`.
Ready attachments open their imported document; other states show loading,
unavailable or unsupported. The layout supports phone-width panes.

The composer shows the caller's own sending phone or the reason replies are
unavailable. Sending requires view access, the caller's own connected account,
and current membership that permits posting. A shared second member can send
from their number without owning or re-adopting the group. Text/media/replies,
reactions, and edits/deletes of the caller's own recent messages use
`POST /meta/linked/whatsapp-groups/<id>/sends`; files stage through `/attachments`.
The detail's `limits` supplies allowed MIME types, bytes and the edit window.
The owner may stop syncing with `DELETE` on the group; history remains readable.

Pending and uncertain sends are read from `GET .../sends`. An `unknown` outcome
may already have arrived and must never be resent automatically. Requests are
limited to one per second per user across groups; HTTP 429 carries
`Retry-After: 1`. Retain an intent key when retrying the same request.

Mock only `/meta/linked/*` for functional verification; never link a real account.
Soup/search integration is deferred.
