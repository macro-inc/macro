use anyhow::{Context, anyhow};
use doppleganger::Mirror;
use models_email::gmail::history::{GmailHistory, GmailHistoryDb};
use sqlx::PgPool;
use sqlx::types::Uuid;

use crate::links::types::DbUserProvider;

#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_history_id_for_link(
    pool: &PgPool,
    email_address: &str,
    provider: models_email::service::link::UserProvider,
) -> anyhow::Result<Option<String>> {
    if email_address.is_empty() {
        return Err(anyhow!("Email address cannot be empty"));
    }

    let normalized_email = email_address.to_lowercase();
    let db_provider = DbUserProvider::mirror(provider);

    let result = sqlx::query!(
        r#"
        SELECT gh.history_id
        FROM email_links l
        LEFT JOIN email_gmail_histories gh ON l.id = gh.link_id
        WHERE l.email_address = $1 AND l.provider = $2
        "#,
        normalized_email,
        db_provider as _
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch history_id for email {} and provider {}",
            email_address,
            db_provider.as_str()
        )
    })?;

    // Extract the history_id field from the result
    Ok(result.map(|r| r.history_id))
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn upsert_gmail_history(
    pool: &PgPool,
    link_id: Uuid,
    history_id: &str,
) -> anyhow::Result<()> {
    let service_history = GmailHistory {
        link_id,
        history_id: history_id.to_string(),
        created_at: Default::default(), // unused
        updated_at: Default::default(), // unused
    };

    let db_history: GmailHistoryDb = service_history.into();

    sqlx::query!(
        r#"
        INSERT INTO email_gmail_histories (link_id, history_id, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (link_id)
        DO UPDATE SET
            history_id = EXCLUDED.history_id,
            updated_at = NOW()
        "#,
        db_history.link_id,
        db_history.history_id
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to upsert gmail_history for link_id {} with history_id {}",
            db_history.link_id, db_history.history_id
        )
    })?;

    Ok(())
}
