use axum::Router;

use crate::api::ApiContext;

pub fn router() -> Router<ApiContext> {
    email::inbound::email_filter_router::<ApiContext, crate::api::context::EmailSvc>()
}
