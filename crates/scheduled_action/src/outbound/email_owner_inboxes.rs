//! The inboxes an owner receives mail in, as the email domain lists them:
//! the `email_links` they own and those `macro_user_links` delegates to them.

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::ports::OwnerInboxes;

#[cfg(test)]
mod test;

pub struct PgOwnerInboxes {
    pool: PgPool,
}

impl PgOwnerInboxes {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl OwnerInboxes for PgOwnerInboxes {
    // The owner is an email address: never a span field.
    #[tracing::instrument(
        name = "routine.owner_inboxes",
        skip_all,
        fields(inboxes = tracing::field::Empty),
        err
    )]
    async fn inboxes(&self, owner: &MacroUserIdStr<'_>) -> anyhow::Result<Vec<Uuid>> {
        let inboxes = sqlx::query_scalar!(
            r#"
            SELECT id AS "id!"
            FROM email_links
            WHERE macro_id = $1
            UNION
            SELECT link_id
            FROM macro_user_links
            WHERE primary_macro_id = $1
            "#,
            owner.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        tracing::Span::current().record("inboxes", inboxes.len());
        Ok(inboxes)
    }
}
