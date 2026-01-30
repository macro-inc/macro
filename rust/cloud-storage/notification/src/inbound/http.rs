//! This module exposes the http adapter for inbound http requests via an axum router

use std::sync::Arc;

use axum::Router;

use crate::domain::service::NotificationIngress;

/// the router state for a notification router
pub struct NotificationRouterState<S> {
    inner: Arc<S>,
}

impl<S> Clone for NotificationRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<S: NotificationIngress> NotificationRouterState<S> {
    /// create a new instance of self
    pub fn new(val: S) -> Self {
        NotificationRouterState {
            inner: Arc::new(val),
        }
    }
}

// pub fn router<S, T>(state: NotificationRouterState<S>) -> Router<T> {
//     Router::new().route("/", get(list_user_notifications)).route("bulk", )

// }
