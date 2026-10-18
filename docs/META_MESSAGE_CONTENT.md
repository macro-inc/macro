# Message content coverage

Supported content for Instagram Login and WhatsApp Cloud API v26. Connection,
sending and access rules are in [META_MESSAGING.md](META_MESSAGING.md).

| Content | Meta evidence / shape | Inbound native display | Outbound / deliberate limit |
| --- | --- | --- | --- |
| Instagram post (`ig_post`) | `url`, `title`, `ig_post_media_id` | Supplied title and a private native preview attachment, or a validated supplied content permalink | No public URL is constructed from a numeric media ID. A preview does not establish full-post playback or carousel completeness. |
| Instagram reel (`ig_reel`) | `url`, `title`, `reel_video_id` | Supplied title and valid Instagram content link; CDN-only resources use the preview path | No custom embed, scraping, or reel publishing action. |
| Carousels, legacy shares, shared profiles, story mentions | Partial or unverified attachment shapes | Supported parts remain; unfamiliar attachment shapes have a quiet “Content unavailable” fallback | No undocumented resource expansion or public/private-account scraping. |
| Instagram story reply | Official sample: `message.reply_to.story.{id,url}` alongside text | Customer text and the supplied story resource stay in one message, explicitly labelled as story context / preview | Story IDs are not message/thread IDs. Expired resources become unavailable; no renewed access is promised. |
| Provider quoted replies | WhatsApp `context.id`; Instagram `reply_to.mid`; existing mapping/transport | Existing connection/customer-scoped `reply_to` identity and outgoing validation retained | Native root-message quote display and composer actions deferred. Macro thread replies are not provider quotes. Missing originals do not break ordinary ingestion. |
| Reactions, both providers | Official Instagram react/unreact example uses `love`; WhatsApp exposes emoji reactions | Retained receipts, no synthetic customer message or reply-window update; reaction display deferred | Meta supports Instagram react/unreact (the official example uses `love`) and WhatsApp emoji reactions. Native reaction rows require Macro users and do not model one shared business reaction. No fake users or misleading teammate picker is added. |
| Instagram edit / unsend | Real `message_edit.{mid,text,num_edit}` and `message.is_deleted` events | Same native message updated by edit counter; unsend tombstones it and removes attachment references | No external edit/delete UI. Pending revisions can precede originals; deletion dominates late edits and replays. |
| WhatsApp edits / deletes | Consumer-app parity not verified for this Cloud API path | No external mutation support added | Do not infer consumer WhatsApp actions from the Cloud API. |
| Images, audio/voice notes, video, GIF/WebP stickers, documents | WhatsApp media ID/MIME and Instagram typed CDN attachment URLs | Existing private native file views and byte/MIME validation; healthy mixed attachments survive another item's download/format failure | Existing explicit outbound format/size matrix remains. Inbound GIF/WebP acceptance does not enable sending stickers/GIFs. No conversion or transcription. |
| WhatsApp locations / contacts | Official location/contact field objects and arrays | Bounded name/address/coordinates or contact name/phone/email/company text, without raw JSON | No CRM creation, map product, or new structured-content composer. |
| WhatsApp button/list selections and referrals | Button text, interactive reply labels/descriptions, referral headline | Visible selected labels/descriptions; supplied ad headline accompanies customer text | Opaque button payloads and referral tracking/capability URLs stay out of chat. No interactive builder. |
| Commerce, orders, payments, unknown content | Provider may expose richer objects; not implemented here | Quiet fallback; recognized accompanying content survives | Deferred. Presence, calling, groups, payments and personal-account integrations remain outside scope. |

## Implementation boundaries

Provider decoding remains in the Meta adapter. Native attachment storage still
requires channel/document access and verifies bounded bytes; downloads allow only
Meta HTTPS CDN hosts and do not follow redirects. Instagram public content URLs
are syntactically restricted to supplied `p`, `reel` or `tv` paths with a shortcode;
they are not fetched by a new backend preview service. A valid permalink is not a
promise that the viewer can access a private/deleted post.

Titles and structured labels are bounded and escaped by the ordinary external
message renderer. Signed media URLs remain in the private receipt evidence, never
in native file links, fixtures, log messages or the report. Stable source message,
customer/account and resource identifiers remain in retained provider evidence;
attachments use existing stable ordinal/hash reservations. No expiring URL is used
as the canonical native attachment identity.

`meta_messaging_revision` is additive and source-scoped. It retains the latest edit
counter or permanent tombstone without creating a channel. Revisions do not advance
reply windows; receipt generation and account locks fence reconnect races. Native
updates and attachment removal use the owning message adapter in the same
transaction. Deleted content cannot be restored by a late media notice/download.
Updates to already-published messages remain quiet. An original arriving already
deleted does not notify as fresh customer content.

## Recovery and verification

Source replays deduplicate by provider message identity and preserve native
permissions and timestamps.
Edits and unsends still use revision fences and tombstones, including across
WhatsApp identity updates. Replaying a receipt never resets send state.

For release verification, run the affected `meta_messaging`, `messages` and DSS
native messaging tests with `SQLX_OFFLINE` unset and an isolated database. Regenerate
SQLx metadata when queries change, then run `just check`,
affected Clippy and the local service build. Check the actual native timeline,
private viewer, refused uninvited access, and real signed provider events separately
from fixture results. See [the test walkthrough](META_MESSAGING_TESTING.md).

## Primary evidence

Meta's current published [Instagram sample collection](https://github.com/fbsamples/messenger-platform-samples/blob/main/postman/instagram-platform-api.postman_collection.json)
contains separate Instagram Login examples for reactions, `message_edit` with
`num_edit`, story reply context, and sending media/posts. Only that Login section
was used; the Facebook Login section is a different authorization path.
Meta's [WhatsApp Cloud API collection](https://www.postman.com/collections/13382743-84d01ff8-4253-4720-b454-af661f36acc2)
supplies reaction, location, contact, button and referral examples. Its older
webhook samples contain omissions/typos, so they are shape evidence rather than
proof of live behavior.
