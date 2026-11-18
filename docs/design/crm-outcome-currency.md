# Pipeline outcomes and currencies

Deals remain database rows in a CRM pipeline, identified by `(pipeline_id,
row_id)`. This implementation starts from supported main and does not reuse the
external deal proposal. It creates no project or separate deal entity.

## Outcome

Every pipeline that tracks a company or contact has a protected single-select
Outcome field: Open, Won, Lost. A generic pipeline is a free-form table and has
no Outcome or currency fields, at creation or after the backfill. Outcome uses the ordinary table, board, record and Add deal editors,
filters, grouping, CSV and agent field APIs. Outcome is independent of Stage;
changing it does not move a row. Stage requirements validate at the same
pipeline operation boundary: `apply_ops` holds `repo.lock_write`, runs
`commercial_fields.prepare`, then `validate_stage_requirements`, then
`apply_storage_ops`, so insert defaults satisfy a stage that requires Outcome
or a currency. No additional closing requirements are introduced here.

Existing rows start Open, except exact case-insensitive `Closed won` and
`Closed lost` labels in the Stage field seed Won and Lost once. Stage names, option IDs and
values remain intact. `closed_stage_ids` cannot distinguish a win from a loss
and does not define Outcome. Existing user fields with reserved names are kept
under an unambiguous legacy name.

## Currency

Each existing numeric Amount or Revenue field gets a paired currency select,
initially named `<amount name> currency`. A new pipeline starts with Revenue
and Revenue currency. Stable column IDs associate the two; renaming an amount
does not change its currency association. Other numeric fields remain numbers.
The pair cannot be deleted or converted to another type; unused fields can be
hidden in a view. Amount fields can be renamed.
Each row chooses its own currency for each amount. Currency options are fixed
supported three-letter codes; USD is the documented default for existing values
and new rows. This is a denomination assumption, never an exchange conversion.

Display uses the currency code with locale number formatting. Money editors accept
locale decimals and grouping as well as canonical dot-decimal input, which takes
precedence where a separator is ambiguous. Editing still starts from the exact
stored value. Bulk clearing skips required Outcome and currency cells.
CSV stores the
numeric amount and its currency in separate columns, and agents read/write the
same fields. `ListPipelines` and the SDK's pipeline fields name each amount's
`currencyField`, including after the amount is renamed, and SDK totals carry
their `currency`. Imports without currency use USD; invalid currencies must fail
the row rather than silently losing the supplied denomination. Totals group by
currency and never convert or combine different denominations.

Agent entry results include currency codes keyed by monetary field name, and
updates include the before/after denomination. Compact tool cards retain the
code beside each displayed amount even when the separate currency column is omitted.
Older tool results remain readable when that metadata is absent.

## Storage and rollout

CRM owns the stable Outcome and amount/currency column identities; the shared
database engine owns their columns, options and cells. Pipeline authorization
and operation validation remain the common boundary for app and agent writes.
Three migrations ship it. The first adds
`crm_pipeline_entities.commercial_fields` with a constant default. The second
gives every existing tracked pipeline its columns and options in one
transaction; it locks each pipeline row and then its table row, in the order
the write guard and row writers take them, so it does nothing else. The third
seeds the rows' Outcome and currency cells one pipeline per transaction, holding
a table's row lock only while that pipeline's own rows are written. All are
additive and preserve amounts, stages and row identities.

Both backfill files follow the storage contract for a change made outside the
service: each bumps the table's version and writes a journal entry for it,
indexed by the columns or rows it touched, with no ops and an incomplete
inverse, so it cannot be undone. Without the bump an open editor, which reloads
only when the version moves, would keep the old schema, and an edit made
against it would pass its `baseVersions` check instead of answering a conflict.
Services provision the fields of a new pipeline and add Open/USD to each
inserted row in their ordinary operation batches.

No database trigger fills these in. Migrations run before services roll, so a
service instance still on the previous version can, for the length of the
rollout, create a tracked pipeline without the fields or add a row without
Open/USD. Readers accept both: a pipeline whose `outcome` is null has no system
fields and takes writes as before, a blank Outcome shows empty, and an amount
with no currency counts as USD in every total. The backfill statements are
idempotent, so a later migration that repeats them repairs such pipelines and
rows; none is scheduled, because the window is one rollout. Such an instance can
also still rename or remove an option of a system field; an insert whose
default label is gone is saved without that default instead of being refused. A trigger on `database_rows` would instead charge every row insert
of every database for a CRM default. Mobile uses the existing responsive field
editors and Add deal form.

This feature is part of the existing CRM rollout; no additional milestone or
feature flag is needed.
