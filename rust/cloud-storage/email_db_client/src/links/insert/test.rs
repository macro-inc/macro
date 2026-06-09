use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::link::{Link, UserProvider};
use sqlx::{Pool, Postgres};

/// Mirrors the self-link bootstrap write: the row is owned by the child's macro_id while
/// the OAuth grant (fusionauth_user_id) lives under the primary's fusion id. Exercises the
/// `&mut PgConnection` path so the link, its default settings, and the gmail history all
/// commit atomically within one transaction.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_link_in_transaction_persists_divergent_ids(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let child_macro_id = "macro|child@personal.test";
    let primary_fusion_id = "11111111-1111-1111-1111-111111111111";
    let child_email = "child@personal.test";

    let link = Link {
        id: macro_uuid::generate_uuid_v7(),
        macro_id: MacroUserIdStr::try_from(child_macro_id.to_string())?,
        fusionauth_user_id: primary_fusion_id.to_string(),
        email_address: EmailStr::try_from(child_email.to_string())?,
        provider: UserProvider::Gmail,
        is_sync_active: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    };

    let mut tx = pool.begin().await?;
    let inserted = upsert_link(&mut tx, link).await?;
    crate::histories::upsert_gmail_history(&mut *tx, inserted.id, "history-123").await?;

    // Invisible outside the transaction until commit.
    assert!(
        crate::links::get::fetch_link_by_id(&pool, inserted.id)
            .await?
            .is_none()
    );

    tx.commit().await?;

    let row = sqlx::query!(
        r#"SELECT macro_id, fusionauth_user_id FROM email_links WHERE id = $1"#,
        inserted.id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.macro_id, child_macro_id);
    assert_eq!(row.fusionauth_user_id, primary_fusion_id);

    assert_eq!(
        crate::histories::fetch_history_id_for_link(&pool, child_email, UserProvider::Gmail)
            .await?
            .as_deref(),
        Some("history-123"),
    );

    let settings_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM email_settings WHERE link_id = $1"#,
        inserted.id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(settings_count, 1);

    Ok(())
}
