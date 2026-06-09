use std::sync::Arc;

use axum::Json;
use axum::response::IntoResponse;
use axum::{
    Router,
    extract::{Path, Query, State},
    routing::get,
};
use serde::Deserialize;

use crate::domain::models::{
    AllTargets, Arch, BundleAction, BundleUpdateRequest, DesktopTarget, DesktopUpdate, IOSVerifier,
};
use crate::domain::ports::NativeAppService;

/// the type of router state for this axum router
pub struct RouterState<S> {
    /// the inner service implementation S
    pub inner: Arc<S>,
}

impl<S> Clone for RouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

/// the external facing router to be merged with the root router
pub fn native_app_router<S: NativeAppService, T>(state: RouterState<S>) -> Router<T> {
    Router::new()
        .route(
            "/update/desktop/{desktop_target}/{arch}/{current_version}",
            get(desktop_update_handler),
        )
        .route(
            "/update/bundle/{all_target}/{arch}",
            get(bundle_update_handler),
        )
        .route(
            "/.well-known/apple-app-site-association",
            get(verify_ios_app_handler),
        )
        .with_state(state)
}

#[tracing::instrument(ret)]
async fn desktop_update_handler(
    Path((target, arch, cur_ver)): Path<(DesktopTarget, Arch, semver::Version)>,
) -> UpdateResult<Json<DesktopUpdate>> {
    UpdateResult::NoUpdateAvailable
}

async fn bundle_update_handler<S: NativeAppService>(
    State(s): State<RouterState<S>>,
    Path((target, arch)): Path<(AllTargets, Arch)>,
    Query(query): Query<BundleUpdateQuery>,
) -> UpdateResult<Json<BundleAction>> {
    match s
        .inner
        .get_bundle_update(BundleUpdateRequest {
            target,
            arch,
            current_bundle_build: query.current_bundle_build,
            native_build: query.native_build,
        })
        .await
    {
        Ok(Some(update)) => UpdateResult::UpdateFound(Json(update)),
        Ok(None) | Err(_) => UpdateResult::NoUpdateAvailable,
    }
}

#[derive(Debug, Deserialize)]
struct BundleUpdateQuery {
    current_bundle_build: u64,
    native_build: u64,
}

#[derive(Debug)]
enum UpdateResult<T> {
    UpdateFound(T),
    NoUpdateAvailable,
}

impl<T> IntoResponse for UpdateResult<T>
where
    T: IntoResponse,
{
    fn into_response(self) -> axum::response::Response {
        match self {
            UpdateResult::UpdateFound(update_found) => update_found.into_response(),
            UpdateResult::NoUpdateAvailable => (reqwest::StatusCode::NO_CONTENT).into_response(),
        }
    }
}

async fn verify_ios_app_handler<S: NativeAppService>(
    State(s): State<RouterState<S>>,
) -> Json<serde_json::Value> {
    Json(s.inner.verification_data(IOSVerifier))
}
