use axum::{Router, routing::get};

use crate::api::context::ApiContext;

mod get_users_in_organization;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/organization/:organization_id/users",
        get(get_users_in_organization::handler),
    )
}
