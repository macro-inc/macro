use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json, extract};
use entity_access::domain::models::EntityPermission;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractorV2;
use entity_access::inbound::axum_extractors::ThreadAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::share_permission::edit::edit_thread_permission;
use model::response::{
    ErrorResponse, GenericErrorResponse, GenericSuccessResponse, SuccessResponse,
};
use model::thread::EmailThreadPermission;
use models_permissions::share_permission::access_level::{
    AccessLevel, EditAccessLevel, OwnerAccessLevel,
};

#[derive(serde::Deserialize)]
pub struct ThreadParams {
    pub thread_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchThreadRequestV2 {
    /// The new project that the thread will belong to.
    pub project_id: Option<String>,
    /// The share permissions for the thread.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}

/// Edits the share permissions of a thread.
#[utoipa::path(
    tag = "threads",
    patch,
    operation_id="edit_thread_v2",
    path = "/threads/{thread_id}",
    params(
            ("thread_id" = String, Path, description = "thread ID")
    ),
    request_body = PatchThreadRequestV2,
    responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, project, thread_access), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn edit_thread_handler(
    thread_access: ThreadAccessLevelExtractor<
        OwnerAccessLevel,
        EntityAccessService,
        AuthorizationService,
    >,
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    thread_context: Extension<EmailThreadPermission>,
    extract::Path(ThreadParams { thread_id }): extract::Path<ThreadParams>,
    project: ProjectBodyAccessLevelExtractorV2<
        EditAccessLevel,
        PatchThreadRequestV2,
        EntityAccessService,
        AuthorizationService,
    >,
) -> Result<Response, Response> {
    let req = project.into_inner();

    let access_level = match thread_access.entity_access_receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => AccessLevel::Owner,
    };

    if req.project_id.is_some() && access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permissions to move this item".into(),
            }),
        )
            .into_response());
    }

    if req.share_permission.is_some() && access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permission to modify share permissions".into(),
            }),
        )
            .into_response());
    }

    if let Some(share_permission) = req.share_permission {
        edit_thread_share_permission(
            &ctx.db,
            &thread_id,
            &thread_context.share_permission_id,
            &share_permission,
            &user.authorization.user.macro_user_id,
        )
        .await?;
    }

    Ok((
        StatusCode::OK,
        Json(SuccessResponse {
            error: false,
            data: GenericSuccessResponse::default(),
        }),
    )
        .into_response())
}

async fn edit_thread_share_permission(
    db: &sqlx::PgPool,
    thread_id: &str,
    share_permission_id: &str,
    share_permission: &models_permissions::share_permission::UpdateSharePermissionRequestV2,
    actor: &macro_user_id::user_id::MacroUserIdStr<'_>,
) -> Result<(), Response> {
    let mut tx = db.begin().await.map_err(|e| {
        tracing::error!(error=?e, "unable to edit thread");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to edit thread".into(),
            }),
        )
            .into_response()
    })?;

    edit_thread_permission(
        &mut tx,
        &macro_uuid::string_to_uuid(thread_id).unwrap(),
        share_permission_id,
        share_permission,
        actor,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to update thread share permissions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to update thread share permissions".into(),
            }),
        )
            .into_response()
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!(error=?e, "unable to edit thread");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to edit thread".into(),
            }),
        )
            .into_response()
    })?;
    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;
    use macro_user_id::user_id::MacroUserIdStr;
    use models_permissions::share_permission::{LinkShare, access_level::AccessLevel};

    async fn migrate_for_test(pool: &sqlx::PgPool) {
        let migrations = macro_db_migrator::MACRO_DB_MIGRATIONS
            .iter()
            .map(|migration| {
                let mut migration = migration.clone();
                if migration.version == 20261110150956
                    && migration.description == "rox mailbox handles"
                {
                    migration.version = 20261110150959;
                }
                migration
            })
            .collect::<Vec<_>>();
        sqlx::migrate::Migrator {
            migrations: std::borrow::Cow::Owned(migrations),
            ..sqlx::migrate::Migrator::DEFAULT
        }
        .run(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = false)]
    async fn edit_thread_share_permission_commits_the_supplied_actor_audit(
        pool: sqlx::PgPool,
    ) -> anyhow::Result<()> {
        migrate_for_test(&pool).await;
        let thread_id = uuid::Uuid::now_v7();
        let permission_id = thread_id.to_string();
        sqlx::query("INSERT INTO \"SharePermission\" (id) VALUES ($1)")
            .bind(&permission_id)
            .execute(&pool)
            .await?;
        let actor = MacroUserIdStr::parse_from_str("macro|rest-thread@example.com")?;

        edit_thread_share_permission(
            &pool,
            &thread_id.to_string(),
            &permission_id,
            &models_permissions::share_permission::UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Public)),
                link_share_access_level: Some(Some(AccessLevel::Edit)),
                team_share_access_level: None,
                channel_share_permissions: None,
            },
            &actor,
        )
        .await
        .expect("thread permission update commits");

        let audit_actor: String = sqlx::query_scalar(
            "SELECT actor_id FROM enterprise_audit WHERE resource_id = $1 AND action = 'share_link_create'",
        )
        .bind(thread_id.to_string())
        .fetch_one(&pool)
        .await?;
        assert_eq!(audit_actor, actor.as_ref());
        Ok(())
    }
}
