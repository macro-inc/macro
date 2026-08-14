use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::{Pool, Postgres, Transaction};
use uuid::Uuid;

use super::*;
use crate::share_permission::create::create_share_permission;

#[derive(Debug, PartialEq)]
struct StoredSharePermission {
    link_share: Option<String>,
    link_share_access_level: Option<String>,
}

fn update_request(
    link_share: Option<Option<LinkShare>>,
    link_share_access_level: Option<Option<AccessLevel>>,
) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share,
        link_share_access_level,
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

async fn edit(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    request: UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    edit_share_permission(
        transaction,
        &Uuid::nil(),
        EntityType::Document,
        share_permission_id,
        &request,
    )
    .await
}

#[sqlx::test]
async fn edit_share_permission_preserves_update_field_semantics(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    let permission = create_share_permission(
        &mut transaction,
        &SharePermissionV2 {
            id: String::new(),
            link_share: Some(LinkShare::Public),
            link_share_access_level: Some(AccessLevel::Edit),
            owner: String::new(),
            channel_share_permissions: None,
        },
    )
    .await?;

    let serialized_omitted_request = serde_json::to_value(update_request(None, None))?;
    let omitted_request: UpdateSharePermissionRequestV2 =
        serde_json::from_value(serialized_omitted_request)?;
    assert_eq!(omitted_request.link_share, None);
    assert_eq!(omitted_request.link_share_access_level, None);

    edit(&mut transaction, &permission.id, omitted_request).await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: Some("PUBLIC".to_string()),
            link_share_access_level: Some("edit".to_string()),
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(None, Some(None)),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: Some("PUBLIC".to_string()),
            link_share_access_level: Some("view".to_string()),
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(None, Some(Some(AccessLevel::Comment))),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: Some("PUBLIC".to_string()),
            link_share_access_level: Some("comment".to_string()),
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(Some(Some(LinkShare::Team)), Some(Some(AccessLevel::Edit))),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: Some("TEAM".to_string()),
            link_share_access_level: Some("edit".to_string()),
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(Some(Some(LinkShare::Public)), None),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: Some("PUBLIC".to_string()),
            link_share_access_level: Some("view".to_string()),
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(Some(None), Some(Some(AccessLevel::Owner))),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: None,
            link_share_access_level: None,
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(None, Some(Some(AccessLevel::Edit))),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: None,
            link_share_access_level: None,
        }
    );

    edit(
        &mut transaction,
        &permission.id,
        update_request(Some(Some(LinkShare::Team)), Some(None)),
    )
    .await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission.id).await?,
        StoredSharePermission {
            link_share: Some("TEAM".to_string()),
            link_share_access_level: Some("view".to_string()),
        }
    );

    Ok(())
}
