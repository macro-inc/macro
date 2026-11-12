# CRM contact creation: staged delivery

The first delivery allows named companies without a domain and manual contacts
whose email domain differs from the company. The second makes a contact's email
and company optional, files personal-provider addresses from email sync as
contacts without a company when the team allows it, and adds a team domain
blocklist. Both preserve team-owned records, IDs, visibility checks and email
consent behavior. Phone-only contacts and one contact linked to several
companies remain open.

## Current implementation decisions

| Entry point | Decision | Behavior |
| --- | --- | --- |
| Company UI, pipeline form, HTTP, CreateCompany tool | Change | Name required; domain optional. An omitted/null domain creates no domain or enrichment entry. A supplied empty/invalid domain is an actionable validation error. |
| Standalone manual contact UI, HTTP, CreateContact tool | Change | Name required; email and company optional. `POST /crm/contacts` adds a contact without a company. Personal email and mismatched domains are accepted. |
| Pipeline contact form | Keep | Name, email and an explicitly selected company are required. A domain match offers a suggestion; accepting it is a separate action. |
| Duplicate company domain | Keep | Team-scoped case-insensitive conflict. Company names are labels and may repeat. |
| Editing existing contacts | Change | Add a missing email only; populated addresses are read-only. Link/switch company only for known personal-provider addresses, with no unlink. Reject same-team duplicates without merging. Preserve ID, references, history and archive state; personal sync reuses one existing identity and preserves its chosen company through cleanup. Email replacement and alias/history redesign are deferred. |
| Duplicate contact email | Keep for this stage | Unique within the company, and within the team for contacts without a company; duplicates return conflict. Contacts without an email never conflict. No silent merge or cross-team lookup. |
| CSV company import | Keep | Domain remains its matching key; name-only import needs a durable identifier contract. |
| CSV contact import | Keep for this stage | Existing contacts are found by email; missing contacts use domain inference. Personal-address creation through import remains follow-on work. |
| Email-only contact lookup in imports and pipeline actions | Change | Multiple visible matches produce an ambiguity error requiring an explicit contact ID; never choose a company arbitrarily. Hidden and cross-team records do not participate in a member's lookup. |
| Email sync and backfill | Change | Existing domain inference, self-domain checks, sources and consent gates. Sent mail to personal-provider addresses creates a company-less contact only when no same-team identity exists; otherwise sent and received mail refresh the unique existing contact without changing its selected company. Personal sync requires the team to turn off "Keep personal emails out" (on by default); received mail only updates existing contacts. Other generic providers stay excluded. Turning the setting back on stops future sync only; contacts it added stay. An assigned company with email sync disabled suppresses email-derived interaction/source updates without changing the manual contact or relation. Enabled-parent refresh still requires exact-primary consent and eligible stored history. Domain exclusions suppress matching email contribution and backfill; adding or removing an exclusion does not hide, restore or delete company/contact records. Team exclusions apply to all contributors, personal exclusions only to their owner, and whole-thread participant checks also cover subdomains. Explicit creation does not manufacture mailbox-source rows. |
| Ownership and visibility | Keep | Team membership and company receipt authorize creation; hidden companies remain restricted and contacts inherit hidden state. |
| Company domains | Keep | Storage supports multiple domains; this stage does not add domain editing or primary selection. |

`POST /crm/companies` accepts `{"name":"Acme"}` or
`{"name":"Acme","domain":"acme.com"}`. A contact created with
`POST /crm/companies/{id}/contacts` may use
`{"name":"Jane","email":"jane@example.com"}` with either company.
The create API remains an insert, not an idempotent import/upsert API; callers
must retain a successful response instead of retrying a confirmed create.

The company Emails view and automatic call association remain domain-based;
use the contact's Emails view for an explicitly attached off-domain address.
Address prechecks aggregate repeated emails within the team, preserving any
hidden or disabled association rather than letting a second company bypass it.
The existing People listing still displays one representative per email; each
company's contact list retains its own records. Email-only API and agent lookups
surface ambiguity errors. The current UI CSV importer counts failed lookups as
skipped rows, so per-row error reporting and ID-based recovery remain part of
the import redesign. Agent CSV imports report ambiguous emails as unresolved
records with the lookup's reason and continue importing valid rows. Refused
lookups never create a company or contact; storage and authorization failures
during lookup still fail the import.

Existing IDs, pipeline rows, custom properties, files, tasks, calls, discussions
and grants are untouched. The first delivery has no schema or data migration.
The second adds `crm_contacts.team_id` (backfilled from the company, with an
insert trigger that fills it for writers on the previous code during a rolling
deploy), makes `crm_contacts.email` and `company_id` nullable, and adds
`team_crm_settings.exclude_personal_emails` and `crm_blocked_domains`.

A later delivery adds `crm_contact_emails`, one row per address a contact is
known by, with `crm_contacts.email` kept as the primary. A trigger records the
primary there, so writers from before the table keep it complete during a
rolling deploy, and a backfill covers existing contacts. Address lookups (personal
sync and teardown, email scope prechecks, thread access, call linking, lookup
by email) read that table; the team-wide activity scope still reads the primary. Until an API adds further addresses
the table mirrors the primary and behavior is unchanged.

Deploy nullable-aware readers to every consuming service before enabling
nullable writes; use a reader-only compatibility release before deploying the
new writers. The insert trigger supports old writers against the expanded
schema, but does not make old readers compatible with nullable rows. Once such
rows exist, retain the additive schema and records and roll forward, or roll
back only to a version that reads nullable contacts. Hiding records does not
isolate them from old admin readers: an attached contact without an email still
reaches their non-null decoder. Moving contact rows to a holding table is not
a verified isolation plan either: deleting contacts cascades source and message
records, so restoring only the contacts loses dependent data. Do not hide, move
or delete contacts as a rollback shortcut. Rolling back past nullable-aware
readers requires a separately verified compatibility or isolation plan; this
delivery provides neither. Existing name-only companies and cross-domain manual
contacts remain readable and retain the manual-creation protection against sync
cleanup.

## Remaining implementation sequence

1. **Identity and ownership contract** — contact worker with the CRM triage and
   consent owners. The agreed pilot model is stable UUID identity with deduplication
   within each personal/team ownership scope. Matching identifiers across teams
   must not merge records or reveal private records. Email normalization trims
   and lowercases without stripping plus tags or dots. Aliases, shared and
   recycled addresses need explicit conflict/merge decisions; email is not a
   proof of personhood. The ownership model is decided; the conflict-resolution
   and migration details still need implementation.
2. **Additive independent records and associations** — contact worker, coordinated
   with company merge. Give contacts independent ownership; support optional
   email, phone and zero/one/many explicit company links. Preserve IDs and source
   provenance. Introduce durable merge redirects before deduplicating legacy
   records. Serialize create/find/link and give imports durable idempotency keys.
   Backfill existing links without deleting contacts or rewriting references.
3. **Authorization and capture** — contact and consent owners. Personal records
   must remain private until explicitly shared; linking must authorize both ends
   and must not widen email access. Migrate the current parent-company checks in
   entity access, message parents, properties, associations, and cleanup before
   enabling independent records. Company unlink/delete must retain contacts.
4. **Unified UI/API/tools/import editing** — contact worker. Select an existing
   visible contact before creation, expose aliases/phone and explicit links,
   reuse properties/database storage for imported fields, and add domain
   management with an explicit primary. Company merge owns its survivor,
   conflicts, domain union and durable redirects; do not auto-merge by name.
5. **Pilot and verification** — the launch owner decides scope after migration and
   permission tests. Initially exercise manual team-owned creation only; broad
   personal-contact capture remains off this change. Verify repeat/concurrent
   imports, phone-only then email-added records, cross-team isolation, link and
   unlink, references and rollback before expanding the pilot. Use a rolling
   migration with compatible writers, then reader cutover; remove old columns
   only after deployment. Roll back readers/writers, never erase new user data.

The GQL backfill worker continues against main's existing contact APIs; this
stage adds no dependency to that work. Consent/exclusions and company merging
remain separate coordinated deliveries. No external implementation is assumed.

No hands-on reference CRM comparison or p50/p95 benchmark has been completed. Measure
create/find/link/import clicks, required fields, errors and recovery, plus open
and save latency on small and realistic datasets before claiming parity. Search
work and search performance measurement remain outside this non-search change.
