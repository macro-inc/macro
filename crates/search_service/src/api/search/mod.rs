use axum::{Router, routing::post};
use macro_authorization::MacroAuthorizationService;

use crate::api::context::{SearchAuthorizationService, SearchRouterState};

pub(in crate::api) mod call_record;
pub(in crate::api) mod channel;
pub(in crate::api) mod chat;
pub(in crate::api) mod crm_company;
pub(in crate::api) mod document;
pub(in crate::api) mod email;
pub(in crate::api::search) mod enrich;
pub(in crate::api) mod project;
pub mod simple;
pub(in crate::api::search) mod terms;
pub mod unified;

pub fn router() -> Router<SearchRouterState> {
    router_with_authorization::<SearchAuthorizationService>()
}

pub(crate) fn router_with_authorization<Auth>() -> Router<SearchRouterState<Auth>>
where
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route("/", post(unified::handler::<Auth>))
        .nest("/simple", simple::router_with_authorization::<Auth>())
        .nest("/channel", channel::router_with_authorization::<Auth>())
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct SearchPaginationParams {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub cursor: Option<String>,
}
