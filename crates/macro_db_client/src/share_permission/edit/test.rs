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
        team_share_access_level: None,
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
async fn supplied_unvalidated_team_fields_reject_before_any_writes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;
    let permission = create_share_permission(
        &mut transaction,
        &SharePermissionV2::new_document_share_permission(None, None),
    )
    .await?;
    let before = get_stored_share_permission(&mut transaction, &permission.id).await?;
    let actor = MacroUserIdStr::parse_from_str(THREAD_AUDIT_ACTOR)?;
    for level in [None, Some(AccessLevel::View), Some(AccessLevel::Owner)] {
        let mut request = update_request(Some(Some(LinkShare::Team)), None);
        request.team_share_access_level = Some(level);
        assert!(
            edit(&mut transaction, &permission.id, request.clone())
                .await
                .is_err()
        );
        assert!(
            edit_thread_permission(
                &mut transaction,
                &Uuid::nil(),
                &permission.id,
                &request,
                &actor,
            )
            .await
            .is_err()
        );
        assert_eq!(
            get_stored_share_permission(&mut transaction, &permission.id).await?,
            before
        );
    }
    Ok(())
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
            team_share_access_level: None,
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

const THREAD_AUDIT_ACTOR: &str = "macro|thread-owner@example.com";
const THREAD_AUDIT_RESOURCE: Uuid = uuid::uuid!("01900000-0000-7000-8000-000000000001");

#[derive(Debug, PartialEq)]
struct ThreadAudit {
    actor_id: String,
    action: String,
    resource_id: String,
    result: String,
}

async fn create_private_thread_permission(pool: &Pool<Postgres>) -> anyhow::Result<String> {
    let mut transaction = pool.begin().await?;
    let permission = create_share_permission(
        &mut transaction,
        &SharePermissionV2 {
            id: String::new(),
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            owner: String::new(),
            channel_share_permissions: None,
        },
    )
    .await?;
    transaction.commit().await?;
    Ok(permission.id)
}

async fn edit_thread_link(
    pool: &Pool<Postgres>,
    permission_id: &str,
    request: UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    let actor = MacroUserIdStr::parse_from_str(THREAD_AUDIT_ACTOR)?;
    let mut transaction = pool.begin().await?;
    edit_thread_permission(
        &mut transaction,
        &THREAD_AUDIT_RESOURCE,
        permission_id,
        &request,
        &actor,
    )
    .await?;
    transaction.commit().await?;
    Ok(())
}

async fn thread_audits(pool: &Pool<Postgres>) -> anyhow::Result<Vec<ThreadAudit>> {
    Ok(sqlx::query_as!(
        ThreadAudit,
        r#"
        SELECT actor_id, action, resource_id, result
        FROM enterprise_audit
        WHERE resource_id = $1
        ORDER BY id
        "#,
        THREAD_AUDIT_RESOURCE.to_string(),
    )
    .fetch_all(pool)
    .await?)
}

fn expected_thread_audit() -> Vec<ThreadAudit> {
    vec![ThreadAudit {
        actor_id: THREAD_AUDIT_ACTOR.to_string(),
        action: "share_link_create".to_string(),
        resource_id: THREAD_AUDIT_RESOURCE.to_string(),
        result: "success".to_string(),
    }]
}

#[sqlx::test]
async fn thread_link_enable_writes_one_audit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let permission_id = create_private_thread_permission(&pool).await?;

    edit_thread_link(
        &pool,
        &permission_id,
        update_request(Some(Some(LinkShare::Public)), Some(Some(AccessLevel::Edit))),
    )
    .await?;

    assert_eq!(thread_audits(&pool).await?, expected_thread_audit());
    Ok(())
}

#[sqlx::test]
async fn thread_link_repeat_and_disable_do_not_duplicate_audit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let permission_id = create_private_thread_permission(&pool).await?;
    for _ in 0..2 {
        edit_thread_link(
            &pool,
            &permission_id,
            update_request(Some(Some(LinkShare::Public)), None),
        )
        .await?;
    }
    assert_eq!(thread_audits(&pool).await?, expected_thread_audit());

    edit_thread_link(
        &pool,
        &permission_id,
        update_request(Some(None), Some(Some(AccessLevel::Owner))),
    )
    .await?;
    let mut transaction = pool.begin().await?;
    assert_eq!(
        get_stored_share_permission(&mut transaction, &permission_id).await?,
        StoredSharePermission {
            link_share: None,
            link_share_access_level: None,
        }
    );
    transaction.rollback().await?;
    assert_eq!(thread_audits(&pool).await?, expected_thread_audit());
    Ok(())
}

#[sqlx::test]
async fn concurrent_thread_link_enablers_write_one_audit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let permission_id = create_private_thread_permission(&pool).await?;
    let first = edit_thread_link(
        &pool,
        &permission_id,
        update_request(Some(Some(LinkShare::Public)), None),
    );
    let second = edit_thread_link(
        &pool,
        &permission_id,
        update_request(Some(Some(LinkShare::Team)), None),
    );

    let (first, second) = futures::future::join(first, second).await;
    first?;
    second?;

    assert_eq!(thread_audits(&pool).await?, expected_thread_audit());
    Ok(())
}
