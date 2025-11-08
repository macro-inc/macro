use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, patch, post},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::ServiceBuilder;

pub(in crate::api) mod create_team;
pub(in crate::api) mod delete_team;
pub(in crate::api) mod delete_team_invite;
pub(in crate::api) mod get_team;
pub(in crate::api) mod get_team_invites;
pub(in crate::api) mod get_user_invites;
pub(in crate::api) mod get_user_teams;
pub(in crate::api) mod invite_to_team;
pub(in crate::api) mod join_team;
pub(in crate::api) mod patch_team;
pub(in crate::api) mod reinvite_to_team;
pub(in crate::api) mod reject_invitation;
pub(in crate::api) mod remove_user_from_team;

pub fn router(jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_team::handler))
        .route("/join/:team_invite_id", get(join_team::handler))
        .route("/user", get(get_user_teams::handler))
        .route("/user/invites", get(get_user_invites::handler))
        .route("/:team_id", get(get_team::handler))
        .route("/:team_id", patch(patch_team::handler))
        .route("/:team_id", delete(delete_team::handler))
        .route("/:team_id/invites", get(get_team_invites::handler))
        .route("/:team_id/invite", post(invite_to_team::handler))
        .route(
            "/:team_id/reinvite/:team_invite_id",
            get(reinvite_to_team::handler),
        )
        .route("/join/:team_invite_id", delete(reject_invitation::handler))
        .route(
            "/:team_id/remove/:remove_user_id",
            delete(remove_user_from_team::handler),
        )
        .route(
            "/:team_id/invite/:team_invite_id",
            delete(delete_team_invite::handler),
        )
        .layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                jwt_args,
                macro_middleware::auth::decode_jwt::handler,
            )),
        )
}

#[derive(serde::Deserialize)]
pub(in crate::api) struct TeamPathParam {
    pub team_id: uuid::Uuid,
}
