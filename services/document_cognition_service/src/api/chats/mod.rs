pub mod chat_history;
pub mod chat_history_batch_messages;

use super::context::{ApiContext, DcsAuthorizationService};
use axum::{
    Router,
    extract::Request,
    middleware::Next,
    response::Response,
    routing::{get, post},
};
use chat::domain::service::ChatServiceImpl;
use chat::inbound::http::router::{ChatRouterState, chat_create_router, chat_id_router};
use chat::outbound::postgres::PgChatRepo;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_authorization::MacroAuthorizationExtractor;
use tower::ServiceBuilder;

/// Requires an authenticated acting user before the request proceeds.
///
/// Chats are created with a public-view share permission by default, so
/// without this gate the `/{chat_id}` routes would serve any chat to fully
/// anonymous callers via the extractor's link-share path. It also keeps the
/// pre-existing ordering where missing/invalid credentials get a 401 before
/// `ensure_chat_exists` performs its lookup (and 404s).
async fn require_authenticated_user(
    _user: MacroAuthorizationExtractor<DcsAuthorizationService>,
    req: Request,
    next: Next,
) -> Response {
    next.run(req).await
}

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let access_repo = PgAccessRepository::new(state.db.clone());
    let access_service = EntityAccessServiceImpl::new(access_repo);
    let chat_repo = PgChatRepo::new(state.db.clone());

    let chat_service = ChatServiceImpl::new(
        chat_repo,
        state.all_tools.clone(),
        state.tool_service_context.clone(),
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(state.db.clone()),
        ),
    );
    let chat_state = ChatRouterState::new(
        chat_service,
        access_service,
        state.authorization_state.clone(),
        state.user_permissions_service.clone(),
    );

    let ensure_chat_exists = axum::middleware::from_fn_with_state(
        state.clone(),
        macro_middleware::cloud_storage::chat::ensure_chat_exists::handler,
    );
    let require_user =
        axum::middleware::from_fn_with_state(state.clone(), require_authenticated_user);

    Router::new()
        // Create route — no ensure_chat_exists; the handler's authorization
        // extractor enforces authentication.
        // Note: free users are intentionally no longer capped by chat/document count,
        // so no quota-enforcement middleware is applied here.
        .merge(chat_create_router(chat_state.clone()))
        // All /{chat_id} routes — require an authenticated user, then
        // ensure_chat_exists for ChatAccessLevelExtractor
        .merge(
            chat_id_router(chat_state).layer(
                ServiceBuilder::new()
                    .layer(require_user.clone())
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        // History routes — remain in DCS
        .route(
            "/history/{chat_id}",
            get(chat_history::get_chat_history_handler).layer(
                ServiceBuilder::new()
                    .layer(require_user)
                    .layer(ensure_chat_exists),
            ),
        )
        .route(
            "/history_batch_messages",
            post(chat_history_batch_messages::get_chat_history_batch_messages_handler),
        )
}
