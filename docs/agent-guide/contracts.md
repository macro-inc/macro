# Contracts

Contracts is where a team prepares signing packets and tracks them to
completion. The `enable-contracts` feature flag controls the `/app/contracts`
route and the public signing page at `/app/sign/<token>`; without it
`/app/contracts` redirects to Home. The rail entry starts under **More** and can be moved onto
the rail from Customize sidebar.

Packets are stored in the browser for now, separately for each signed-in
account: localStorage holds the packets and IndexedDB the PDF bytes, and a
banner at the top of the workspace says so. No
email is sent and a signing link opens only in the browser profile that
created it. Open tabs stay in step, so a workspace tab updates when a signing
tab finishes.

## Workspace

The inner sidebar lists four packet filters (All packets, In flight, Needs my
signature, Completed) and the databases: Customer Agreements, Vendor MSAs,
NDAs and Offer Letters to start, plus **New database**. A packet lives in one
or more databases and shows in each.

A database is a table with one row per packet: the Packet block (title and
document count), Packet status, Signers (one segment per signer and a count),
Company, Owner and Expires. Packet status is set by the system: Draft, Sent,
Partially Signed, Signed, Declined, Voided or Expired. A packet marked signed
outside Macro shows Signed with an **Offline** tag.

Press a Packet block to open the packet drawer beside the table. It shows the
status, quick actions, document thumbnails (press one to read the document
with signed fields filled in), each recipient's place and progress, the
databases the packet lives in, its expiry and reminder cadence, and the
activity log. Quick actions depend on status:

- Draft: **Place fields**, **Delete draft**.
- Sent or Partially Signed: **Resend reminder**, **Re-upload** (replace one
  document; signatures are cleared and signers get new links), **Audit
  certificate**, **Mark signed offline**, **Void**.
- Any sent packet: **Audit certificate**.

A signer whose turn it is shows **Copy signing link**; when that signer is the
viewer it shows **Sign now**.

## New packet

**New** (sidebar or header) opens a three-step flow.

1. **Set up**: a title, one or more PDFs (**Upload PDF**; other formats are
   refused), and recipients with a name, an email and a role (Needs to sign,
   Receives a copy). **I am also a signer** adds the viewer as the last
   signer. **Set signing order** on means each signer is invited after the one
   before them has signed; off invites everyone at once. Lives in, Expires
   after, Remind pending signers and Company follow. **Place fields**
   creates the draft.
2. **Place fields**: choose who fields are for on the left, then drag a field
   (Signature, Initials, Date Signed, Full Name, Email, Text Input, Checkbox)
   onto a page, or press it to drop it on the current page. Drag a placed
   field to move it and its corner to resize it (it stops at the page edge);
   arrow keys nudge, Shift with an arrow key resizes, and Delete removes.
   Placement is saved when the step is
   left, including by the sidebar. The panel on the right reassigns the selected field, toggles
   Required, and lists what still blocks sending: every signer needs at least
   one signature field. A signer with no signature field in one document is a
   warning, not a block.
3. **Review and send**: a card with the documents, signers, databases and
   field counts. **Send to <first signer>** sends the packet and opens its
   drawer.

## Signing page

`/app/sign/<token>` needs no account. It lists the packet's documents with the
fields left in each, shows progress in the header, and **Next field** scrolls
to the next required field. **Sign here** opens Adopt your signature (Draw,
Type in one of three faces, or Upload an image); on a phone it is a bottom
sheet. Text fields are typed in place; the date, name and email are filled in
at signing. The header counts required fields only. **Finish** enables once
every required field is done and every document has opened; a document that
fails to load offers **Try again**. Finishing records consent to sign
electronically, then the signature. **Other
actions → Decline to sign** declines and closes every link. A link that was
used, replaced, voided or expired, or whose turn has not come, shows "This
signing link isn't active".

## Certificate

**Audit certificate** shows the Certificate of Completion: envelope id, sender,
created and completed times in UTC, routing, each signer's email, link id,
user agent, disclosure and signing times and signature, the SHA-256 state
digest before signing and after each signature, and the event log
(`contract.created`, `contract.sent`, `contract.viewed`,
`contract.signed_by_recipient`, `contract.completed`, and the audit entries).
IP addresses read "Not recorded" until packets are stored on the server. A
line above the page says whether the stored log still matches its hash chain
("Audit log verified"). After a document is replaced, only the digests from
the replacement on are listed.

## Driving it without a backend

`apps/web/src/features/contracts/browser-test/workspace.html` mounts the real
workspace over the browser-local store; add `?seed=demo&now=2026-11-12T18:00:00.000Z`
for a database with a packet in every status. `signing.html?token=<token>` is
the signing page. The viewer in the fixture is a signer named Avery Lee;
**Copy signing link** writes the link to `document.body.dataset.copied`.
