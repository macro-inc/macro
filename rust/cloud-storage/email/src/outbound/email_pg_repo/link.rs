use crate::domain::models::{Link, UserProvider};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use super::db_types::{DbLink, DbUserProvider};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn link_by_fusionauth_and_macro_id(
    pool: &PgPool,
    fusionauth_user_id: &str,
    macro_id: MacroUserIdStr<'_>,
    provider: UserProvider,
) -> Result<Option<Link>, sqlx::Error> {
    let provider: DbUserProvider = match provider {
        UserProvider::Gmail => DbUserProvider::Gmail,
    };

    let db_link = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE fusionauth_user_id = $1 AND macro_id = $2 AND provider = $3
        LIMIT 1
        "#,
        fusionauth_user_id,
        macro_id.as_ref(),
        provider as _
    )
    .fetch_optional(pool)
    .await?;

    db_link
        .map(|v| v.try_into_model())
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn link_by_macro_id(
    pool: &PgPool,
    macro_id: MacroUserIdStr<'_>,
) -> Result<Option<Link>, sqlx::Error> {
    let db_link: Option<DbLink> = sqlx::query_as!(
        DbLink,
        r#"
        SELECT id, macro_id, fusionauth_user_id, email_address, provider as "provider: _",
               is_sync_active, created_at, updated_at
        FROM email_links
        WHERE macro_id = $1
        LIMIT 1
        "#,
        macro_id.as_ref()
    )
    .fetch_optional(pool)
    .await?;

    db_link
        .map(|v: DbLink| v.try_into_model())
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))
}
