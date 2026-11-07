# Legacy CRM → Sales

The normal SQLx migration runner copies existing CRM sales data automatically.
There is no operator command, per-team checkpoint table, or separate deployment step.
The migration record and complete copy commit together. Failure rolls everything
back; rerunning completed migrations does not overwrite edits or recreate deleted pipelines.

Each CRM-enabled team with visible companies receives a team-shared **Sales**
pipeline owned by its team owner. Every visible company gets a row, including
Customer, Churned, and unstaged companies. Stage, Owner, and Revenue are copied;
custom stage order, labels, and legacy mappings are preserved in independent
pipeline options. Invalid values or unmappable stages abort the migration.
Hidden companies, disabled CRMs, and private custom properties are not copied.

Source records and properties remain intact. The migration locks its source
tables while taking the snapshot. Later legacy CRM writes do not update Sales;
Sales is an independent workflow. Company details, contacts, and activity stay
on the linked CRM entities. This does not retarget legacy CRM or AI writers.

The data copy is forward-only: its down migration refuses to erase completion
or user edits. Revert application code without undoing this additive migration.
Column protections reuse the shared database engine used by Forms. Company
cells are non-nullable, single-company references; CRM checks the editor's record
access, without requiring the record and pipeline to belong to the same team.
