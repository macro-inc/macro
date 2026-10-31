use crate::settings::{fetch_settings, patch_settings};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::settings::SettingsPatch;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

async fn insert_link(pool: &Pool<Postgres>) -> Uuid {
    let link_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, 'macro|owner@corp.test', 'macro|owner@corp.test', 'owner@corp.test', 'GMAIL')"#,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

fn patch(link_id: Uuid) -> SettingsPatch {
    SettingsPatch {
        link_id,
        signature_on_replies_forwards: None,
        signature: None,
        read_receipts_enabled: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn read_receipts_default_off_and_patch_independently(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = insert_link(&pool).await;

    let created = patch_settings(
        &pool,
        SettingsPatch {
            signature: Some("<p>sig</p>".into()),
            ..patch(link_id)
        },
    )
    .await?;
    assert!(!created.read_receipts_enabled);

    let enabled = patch_settings(
        &pool,
        SettingsPatch {
            read_receipts_enabled: Some(true),
            ..patch(link_id)
        },
    )
    .await?;
    assert!(enabled.read_receipts_enabled);
    assert_eq!(enabled.signature.as_deref(), Some("<p>sig</p>"));

    let untouched = patch_settings(
        &pool,
        SettingsPatch {
            signature_on_replies_forwards: Some(true),
            ..patch(link_id)
        },
    )
    .await?;
    assert!(untouched.read_receipts_enabled);
    assert!(fetch_settings(&pool, link_id).await?.read_receipts_enabled);

    Ok(())
}
