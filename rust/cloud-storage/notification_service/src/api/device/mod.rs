//! Device registration router assembly.
//!
//! Wraps the notification crate's device handlers with application-level middleware
//! (e.g., `ensure_user_exists` on the register endpoint).

use axum::{
    Router,
    routing::{delete, post},
};
use tower::ServiceBuilder;

use ::notification::domain::service::NotificationReader;
use ::notification::inbound::http::NotificationRouterState;

/// Build the device registration router.
///
/// Applies `ensure_user_exists` middleware to the register endpoint only.
pub fn router<S: NotificationReader, O: Clone + Send + Sync + 'static>(
    state: NotificationRouterState<S>,
) -> Router<O> {
    Router::new()
        .route(
            "/register",
            post(::notification::inbound::http::device::register_device::<S>).layer(
                ServiceBuilder::new().layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                )),
            ),
        )
        .route(
            "/unregister",
            delete(::notification::inbound::http::device::unregister_device::<S>),
        )
        .with_state(state)
}
