use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use models_permissions::share_permission::{LinkShare, SharePermissionV2};
use sqlx::{Pool, Postgres, Transaction};

use super::*;

#[derive(Debug, PartialEq)]
struct StoredSharePermission {
    link_share: Option<String>,
    link_share_access_level: Option<String>,
}

fn share_permission(
    link_share: Option<LinkShare>,
    link_share_access_level: Option<AccessLevel>,
) -> SharePermissionV2 {
    SharePermissionV2 {
        id: String::new(),
        link_share,
        link_share_access_level,
        owner: String::new(),
        channel_share_permissions: None,
    }
}

async fn get_stored_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    id: &str,
) -> anyhow::Result<StoredSharePermission> {
    Ok(sqlx::query_as!(
        StoredSharePermission,
        r#"
        SELECT
            "linkShare" as link_share,
            "linkShareAccessLevel"::text as link_share_access_level
        FROM "SharePermission"
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(transaction.as_mut())
    .await?)
}

#[sqlx::test]
async fn create_share_permission_writes_link_columns(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;

    let public_permission = SharePermissionV2 {
        channel_share_permissions: Some(vec![ChannelSharePermission {
            channel_id: "channel-one".to_string(),
            access_level: AccessLevel::View,
        }]),
        ..share_permission(Some(LinkShare::Public), Some(AccessLevel::Edit))
    };
    let public_result = create_share_permission(&mut transaction, &public_permission).await?;
    assert_eq!(public_result.link_share, Some(LinkShare::Public));
    assert_eq!(
        public_result.link_share_access_level,
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        get_stored_share_permission(&mut transaction, &public_result.id).await?,
        StoredSharePermission {
            link_share: Some("PUBLIC".to_string()),
            link_share_access_level: Some("edit".to_string()),
        }
    );

    let team_result = create_share_permission(
        &mut transaction,
        &share_permission(Some(LinkShare::Team), Some(AccessLevel::Comment)),
    )
    .await?;
    assert_eq!(team_result.link_share, Some(LinkShare::Team));
    assert_eq!(
        get_stored_share_permission(&mut transaction, &team_result.id).await?,
        StoredSharePermission {
            link_share: Some("TEAM".to_string()),
            link_share_access_level: Some("comment".to_string()),
        }
    );

    let disabled_result = create_share_permission(
        &mut transaction,
        &share_permission(None, Some(AccessLevel::Owner)),
    )
    .await?;
    assert_eq!(disabled_result.link_share, None);
    assert_eq!(disabled_result.link_share_access_level, None);
    assert_eq!(
        get_stored_share_permission(&mut transaction, &disabled_result.id).await?,
        StoredSharePermission {
            link_share: None,
            link_share_access_level: None,
        }
    );

    Ok(())
}

#[sqlx::test]
async fn create_share_permission_defaults_enabled_links_to_view(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;

    for link_share in [LinkShare::Public, LinkShare::Team] {
        let result =
            create_share_permission(&mut transaction, &share_permission(Some(link_share), None))
                .await?;

        assert_eq!(result.link_share_access_level, Some(AccessLevel::View));
        assert_eq!(
            get_stored_share_permission(&mut transaction, &result.id).await?,
            StoredSharePermission {
                link_share: Some(link_share.to_string()),
                link_share_access_level: Some("view".to_string()),
            }
        );
    }

    Ok(())
}
