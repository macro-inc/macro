use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    api::{MACRO_IT_PANEL_PERMISSION, MACRO_ORGANIZATION_IT_ROLE, context::ApiContext},
    model::{
        request::patch_user_role::{OrganizationUserRole, PatchUserRoleRequest},
        response::EmptyResponse,
    },
    service,
};

use model::user::UserContext;

/// Patches the requested users role. Updating whether they have organization_it role or
/// not.
#[utoipa::path(
        patch,
        path = "/users/role",
        responses(
            (status = 200),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id))]
pub async fn patch_user_role_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<PatchUserRoleRequest>,
) -> Result<Response, Response> {
    // Ensure the user is in the organization
    let user_organization_id: i32 =
        match macro_db_client::user::get::get_user_organization::get_user_organization(
            &ctx.db,
            req.user_id.as_str(),
        )
        .await
        {
            Ok(result) => {
                if let Some(organization_id) = result {
                    organization_id
                } else {
                    tracing::error!("user not in organization");
                    return Err(StatusCode::UNAUTHORIZED.into_response());
                }
            }
            Err(e) => {
                tracing::error!(error=?e, "unable to get user organization");
                let result = match e {
                    sqlx::Error::RowNotFound => StatusCode::NOT_FOUND,
                    _ => StatusCode::INTERNAL_SERVER_ERROR,
                }
                .into_response();
                return Err(result);
            }
        };

    if user_organization_id
        != user_context
            .organization_id
            .expect("Organization ID must be supplied")
    {
        tracing::error!("user not in same organization");
        return Err(StatusCode::UNAUTHORIZED.into_response());
    }

    match req.organization_user_role {
        OrganizationUserRole::Owner => {
            make_user_owner(ctx.db.clone(), &ctx.redis_client, req.user_id.as_str()).await
        }
        OrganizationUserRole::Member => {
            make_user_member(ctx.db.clone(), &ctx.redis_client, req.user_id.as_str()).await
        }
    }
    .map_err(|e| {
        tracing::error!(error=?e, "unable to update user roles");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

/// Makes the user an "owner" of the organization. Giving them organization it role.
#[tracing::instrument(skip(db, redis_client))]
async fn make_user_owner(
    db: sqlx::Pool<sqlx::Postgres>,
    redis_client: &service::redis::Redis,
    update_user_id: &str,
) -> anyhow::Result<()> {
    macro_db_client::user::patch::add_user_role::add_user_role(
        db,
        update_user_id,
        MACRO_ORGANIZATION_IT_ROLE,
    )
    .await?;

    redis_client
        .add_user_permission(update_user_id, MACRO_IT_PANEL_PERMISSION)
        .await?;

    Ok(())
}

/// Makes the user a "member" of the organization. Removing the organization_it role if present.
async fn make_user_member(
    db: sqlx::Pool<sqlx::Postgres>,
    redis_client: &service::redis::Redis,
    update_user_id: &str,
) -> anyhow::Result<()> {
    macro_db_client::user::remove::remove_user_role::remove_user_role(
        db.clone(),
        update_user_id,
        MACRO_ORGANIZATION_IT_ROLE,
    )
    .await?;

    let user_permissions =
        macro_db_client::user::get::get_user_permissions::get_user_permissions(db, update_user_id)
            .await?;

    let user_permissions = user_permissions
        .into_iter()
        .collect::<Vec<String>>()
        .join(",");

    redis_client
        .update_user_permissions(update_user_id, user_permissions.as_str())
        .await?;

    Ok(())
}
