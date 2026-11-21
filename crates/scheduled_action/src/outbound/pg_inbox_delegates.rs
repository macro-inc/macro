//! Who an inbox is delegated to, read from `macro_user_links` (multi-inbox):
//! each edge lets its primary read one of its child's inboxes.

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::event_runs::InboxDelegates;

#[cfg(test)]
mod test;

pub struct PgInboxDelegates {
    pool: PgPool,
}

impl PgInboxDelegates {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl InboxDelegates for PgInboxDelegates {
    // The owner is an email address: never a span field.
    #[tracing::instrument(
        name = "routine.inbox_delegates",
        skip_all,
        fields(link_id = %link_id, delegates = tracing::field::Empty),
        err
    )]
    async fn delegates(
        &self,
        owner: &MacroUserIdStr<'static>,
        link_id: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        // An edge whose child isn't the inbox's owner grants nothing.
        let primaries = sqlx::query_scalar!(
            r#"
            SELECT primary_macro_id
            FROM macro_user_links
            WHERE link_id = $1
              AND child_macro_id = $2
            "#,
            link_id,
            owner.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| Report::new(error).into_dynamic())?;
        // "User" ids are all user ids; one that isn't can't own a routine.
        let delegates: Vec<_> = primaries
            .into_iter()
            .filter_map(|primary| MacroUserIdStr::try_from(primary).ok())
            .collect();
        tracing::Span::current().record("delegates", delegates.len());
        Ok(delegates)
    }
}
