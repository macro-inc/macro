use crate::cloud_storage::ensure_access::{AccessLevelErr, get_users_access_level_v2};
use axum::async_trait;
use axum::extract::FromRef;
use axum::http::request::Parts;
use axum::{
    Extension,
    extract::{FromRequestParts, Path},
};
use model::user::UserContext;
use models_permissions::entity_permission::{
    EntityPermission, EntityPermissionResponse, ParticipantRole,
};
use sqlx::PgPool;
use uuid::Uuid;

fn convert_role(role: model::comms::ParticipantRole) -> ParticipantRole {
    match role {
        model::comms::ParticipantRole::Owner => ParticipantRole::Owner,
        model::comms::ParticipantRole::Admin => ParticipantRole::Admin,
        model::comms::ParticipantRole::Member => ParticipantRole::Member,
    }
}

#[derive(serde::Deserialize)]
struct Params {
    entity_type: String,
    entity_id: String,
}

pub struct EntityPermissionExtractor(pub EntityPermissionResponse);

#[async_trait]
impl<S> FromRequestParts<S> for EntityPermissionExtractor
where
    PgPool: FromRef<S>,
    S: Send + Sync + 'static,
{
    type Rejection = AccessLevelErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let user_context: Extension<UserContext> =
            <Extension<UserContext>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AccessLevelErr::InternalErr)?;
        let Path(Params {
            entity_type,
            entity_id,
        }) = <Path<Params>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AccessLevelErr::BadRequest)?;

        let response = match entity_type.as_str() {
            "document" | "chat" | "project" | "thread" | "email_thread" => {
                resolve_item_permission(&db, &user_context, &entity_type, &entity_id).await?
            }
            "channel" => resolve_channel_permission(&db, &user_context, &entity_id).await?,
            _ => return Err(AccessLevelErr::BadRequest),
        };

        Ok(EntityPermissionExtractor(response))
    }
}

async fn resolve_item_permission(
    db: &PgPool,
    user_context: &UserContext,
    entity_type: &str,
    entity_id: &str,
) -> Result<EntityPermissionResponse, AccessLevelErr> {
    let item_type = if entity_type == "email_thread" {
        "thread"
    } else {
        entity_type
    };

    let access_level =
        get_users_access_level_v2(db, &user_context.user_id, entity_id, item_type)
            .await
            .map_err(AccessLevelErr::DbErr)?;

    Ok(match access_level {
        Some(access_level) => EntityPermissionResponse::Access {
            permission: EntityPermission::AccessLevel { access_level },
        },
        None => EntityPermissionResponse::NoAccess,
    })
}

async fn resolve_channel_permission(
    db: &PgPool,
    user_context: &UserContext,
    entity_id: &str,
) -> Result<EntityPermissionResponse, AccessLevelErr> {
    let channel_id: Uuid = entity_id.parse().map_err(|_| AccessLevelErr::BadRequest)?;
    let org_id = user_context.organization_id.map(|id| id as i64);

    let role = macro_db_client::item_access::get::get_user_channel_role(
        db,
        &channel_id,
        &user_context.user_id,
        org_id,
    )
    .await
    .inspect_err(|e| tracing::error!(error=?e, "failed to get user channel role"))
    .map_err(|_| AccessLevelErr::InternalErr)?;

    Ok(match role {
        Some(role) => EntityPermissionResponse::Access {
            permission: EntityPermission::ChannelRole {
                role: convert_role(role),
            },
        },
        None => EntityPermissionResponse::NoAccess,
    })
}
