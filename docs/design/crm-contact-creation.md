# CRM contact creation: staged delivery

The first delivery allows named companies without a domain and manual contacts
whose email domain differs from the company. It preserves the current team-owned
records, IDs, visibility checks and email consent behavior. The broader
company-independent contact model is still open; this change does not deliver
phone-only contacts or one contact linked to several companies.

## Current implementation decisions

| Entry point | Decision | Behavior |
| --- | --- | --- |
| Company UI, pipeline form, HTTP, CreateCompany tool | Change | Name required; domain optional. An omitted/null domain creates no domain or enrichment entry. A supplied empty/invalid domain is an actionable validation error. |
| Manual contact UI, pipeline form, HTTP, CreateContact tool | Change | Name, full email and explicit company required. Personal email and mismatched domains are accepted. A domain match can suggest a company in the pipeline form. |
| Duplicate company domain | Keep | Team-scoped case-insensitive conflict. Company names are labels and may repeat. |
| Duplicate contact email | Keep for this stage | Unique within the company; duplicates return conflict. No silent merge or cross-team lookup. |
| CSV company import | Keep | Domain remains its matching key; name-only import needs a durable identifier contract. |
| CSV contact import | Keep for this stage | Existing contacts are found by email; missing contacts use domain inference. Personal-address creation through import remains follow-on work. |
| Email-only contact lookup in imports and pipeline actions | Change | Multiple visible matches produce an ambiguity error requiring an explicit contact ID; never choose a company arbitrarily. Hidden and cross-team records do not participate in a member's lookup. |
| Email sync and backfill | Keep | Existing domain inference, provider exclusions, self-domain checks, sources and consent gates. Explicit creation does not manufacture mailbox-source rows. |
| Ownership and visibility | Keep | Team membership and company receipt authorize creation; hidden companies remain restricted and contacts inherit hidden state. |
| Company domains | Keep | Storage supports multiple domains; this stage does not add domain editing or primary selection. |

`POST /crm/companies` accepts `{"name":"Acme"}` or
`{"name":"Acme","domain":"acme.com"}`. A contact created with
`POST /crm/companies/{id}/contacts` may use
`{"name":"Jane","email":"jane@gmail.com"}` with either company.
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
the import redesign.

Existing IDs, pipeline rows, custom properties, files, tasks, calls, discussions
and grants are untouched. There is no schema or data migration. Rollback is an
application rollback: existing name-only companies remain readable, although
older creation forms cannot add contacts to them. Cross-domain manual contacts
remain readable and retain the manual-creation protection against sync cleanup.

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
