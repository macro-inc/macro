//! Duplicating a database: a new one, owned by whoever duplicates it, with
//! the source's tables, columns, options, views, card places, rows and cells.
//! Grants, the team share, forms, webhooks, saved queries and the change
//! journal stay with the source.

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};

use super::models::{Database, DatabaseError, Writes, WritesOutcome};

/// Persistence for a duplicate: the new database and its contents commit
/// together, or not at all.
pub trait DatabaseDuplicateRepo: Send + Sync + 'static {
    /// Persistence error.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Create `database` with an owner grant for its owner, then apply
    /// `writes` to it, in one transaction. `writes` names `database` and
    /// creates every table it has. Anything but [`WritesOutcome::Applied`]
    /// wrote nothing, the database among it.
    fn duplicate_database(
        &self,
        database: &Database,
        writes: &Writes,
    ) -> impl Future<Output = Result<WritesOutcome, Self::Error>> + Send;
}

/// Duplicate use case; view access to the source is enough.
pub trait DatabaseDuplicateService: Send + Sync + 'static {
    /// Copy the receipt's database for `owner`, named `name`, or "<name>
    /// copy" without one. `acting_bot` is the agent duplicating it for the
    /// owner, `None` when the owner acts; only the creation's attribution
    /// reads it.
    fn duplicate_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        owner: macro_user_id::user_id::MacroUserIdStr<'static>,
        acting_bot: Option<bot_id::BotId>,
        name: Option<String>,
    ) -> impl Future<Output = Result<Database, DatabaseError>> + Send;
}
