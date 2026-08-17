use models_permissions::share_permission::LinkShare;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::{Pool, Postgres};

use super::*;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
async fn get_document_share_permission_reads_link_fields(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let public_permission = get_document_share_permission(&pool, "d1").await?;
    assert_eq!(public_permission.id, "sp-d1");
    assert_eq!(public_permission.link_share, Some(LinkShare::Public));
    assert_eq!(
        public_permission.link_share_access_level,
        Some(AccessLevel::Edit)
    );
    assert_eq!(public_permission.owner, "macro|user@user.com");
    assert_eq!(
        public_permission.channel_share_permissions,
        Some(vec![
            ChannelSharePermission {
                channel_id: "c1".to_string(),
                access_level: AccessLevel::View,
            },
            ChannelSharePermission {
                channel_id: "c2".to_string(),
                access_level: AccessLevel::Edit,
            }
        ])
    );

    let disabled_permission = get_document_share_permission(&pool, "d2").await?;
    assert_eq!(disabled_permission.id, "sp-d2");
    assert_eq!(disabled_permission.link_share, None);
    assert_eq!(disabled_permission.link_share_access_level, None);
    assert_eq!(disabled_permission.owner, "macro|user2@user.com");
    assert_eq!(disabled_permission.channel_share_permissions, None);

    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET
            "linkShare" = 'TEAM',
            "linkShareAccessLevel" = 'comment'
        WHERE id = 'sp-d2'
        "#,
    )
    .execute(&pool)
    .await?;

    let team_permission = get_document_share_permission(&pool, "d2").await?;
    assert_eq!(team_permission.link_share, Some(LinkShare::Team));
    assert_eq!(
        team_permission.link_share_access_level,
        Some(AccessLevel::Comment)
    );

    let error = sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET "linkShareAccessLevel" = $1::text::"AccessLevel"
        WHERE id = 'sp-d2'
        "#,
        "invalid",
    )
    .execute(&pool)
    .await
    .expect_err("the database must reject invalid access levels");
    assert!(error.to_string().contains("invalid input value for enum"));

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
async fn get_chat_share_permission_reads_link_fields(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let public_permission = get_chat_share_permission(&pool, "c1").await?;
    assert_eq!(public_permission.id, "sp-c1");
    assert_eq!(public_permission.link_share, Some(LinkShare::Public));
    assert_eq!(
        public_permission.link_share_access_level,
        Some(AccessLevel::Edit)
    );
    assert_eq!(public_permission.owner, "macro|user@user.com");
    assert_eq!(
        public_permission.channel_share_permissions,
        Some(vec![
            ChannelSharePermission {
                channel_id: "c1".to_string(),
                access_level: AccessLevel::View,
            },
            ChannelSharePermission {
                channel_id: "c2".to_string(),
                access_level: AccessLevel::Edit,
            }
        ])
    );

    let disabled_permission = get_chat_share_permission(&pool, "c2").await?;
    assert_eq!(disabled_permission.id, "sp-c2");
    assert_eq!(disabled_permission.link_share, None);
    assert_eq!(disabled_permission.link_share_access_level, None);
    assert_eq!(disabled_permission.owner, "macro|user2@user.com");
    assert_eq!(disabled_permission.channel_share_permissions, None);

    Ok(())
}
