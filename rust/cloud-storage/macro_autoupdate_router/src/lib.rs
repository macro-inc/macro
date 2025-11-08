#![deny(missing_docs)]
//! This crate provides the serverside handlers required to dynamically update the tauri application
//! Consumers of this crate should integrate the router
//! by calling [axum::Router::with_state]

use axum::{
    Json, Router,
    extract::{Path, State},
    response::IntoResponse,
    routing::get,
};
use macro_env::{Environment, ext::frontend_url::FrontendUrl};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use thiserror::Error;
use url::Url;

#[cfg(test)]
mod tests;

/// the external facing router to be merged with the root router
pub fn routes<S>(env: Environment) -> Router<S> {
    Router::new()
        .route(
            "/desktop/:desktop_target/:arch/:current_version",
            get(desktop_update_handler),
        )
        .route(
            "/bundle/:all_target/:arch/:current_version",
            get(bundle_update_handler),
        )
        .with_state(env)
}

/// The possible input desktop operating systems
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(strum::EnumIter))]
pub enum DesktopTarget {
    /// the requesting client is on linux
    Linux,
    /// the requesting client is on Windows
    Windows,
    /// the requesting client is on Darwin/MacOS
    Darwin,
}

/// The possible input mobile operating systems
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(strum::EnumIter))]
pub enum MobileTarget {
    /// the requesting client is on ios
    Ios,
    /// the requesting client is on android
    Android,
}

/// an enumeration of all possible tauri targets
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(untagged)]
pub enum AllTargets {
    /// desktop operating system
    Desktop(DesktopTarget),
    /// mobile operating system
    Mobile(MobileTarget),
}

/// The possible input architechtures
/// See https://v2.tauri.app/plugin/updater/#dynamic-update-server
#[derive(Debug, Deserialize, Clone, Copy)]
#[cfg_attr(test, derive(strum::EnumIter))]
#[serde(rename_all = "lowercase")]
pub enum Arch {
    /// the x86 architecture
    X86_64,
    /// this is an old and mostly deprecated system architecture
    /// but it technically could be sent
    I686,
    /// most phones and apple devices use this arch
    Aarch64,
    /// predecessor to the more modern arm architecture
    Armv7,
}

/// a struct which indicates the client should upgrade their desktop app
/// This means the system level rust binary will be updated
#[derive(Debug, Serialize)]
struct DesktopUpdate {
    /// code signing signature of the update bundle
    /// see https://v2.tauri.app/plugin/updater
    signature: Vec<u8>,
    /// the remaining properties of the update
    #[serde(flatten)]
    inner: BundleUpdate,
}

impl IntoResponse for DesktopUpdate {
    fn into_response(self) -> axum::response::Response {
        Json(self).into_response()
    }
}

/// a struct which indicates how to update only the javascript bundle of the application
#[derive(Debug, Serialize)]
pub struct BundleUpdate {
    /// the version that we are going to update to
    version: semver::Version,
    /// some optional notes about the update
    notes: Option<String>,
    /// the fully qualified Url where the update bundle exists
    url: Url,
}

impl IntoResponse for BundleUpdate {
    fn into_response(self) -> axum::response::Response {
        Json(self).into_response()
    }
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

#[axum::debug_handler(state = Environment)]
#[tracing::instrument(ret)]
async fn desktop_update_handler(
    Path((target, arch, cur_ver)): Path<(DesktopTarget, Arch, semver::Version)>,
) -> UpdateResult<DesktopUpdate> {
    UpdateResult::NoUpdateAvailable
}

#[axum::debug_handler(state = Environment)]
#[tracing::instrument(ret)]
async fn bundle_update_handler(
    Path(params): Path<(AllTargets, Arch, semver::Version)>,
    State(env): State<Environment>,
) -> UpdateResult<BundleUpdate> {
    match bundle_update_handle_inner::<DefaultBundleFetcher>(params, env).await {
        Ok(Some(update)) => UpdateResult::UpdateFound(update),
        Ok(None) | Err(_) => UpdateResult::NoUpdateAvailable,
    }
}

#[derive(Debug, Error)]
enum UpdateErr {
    #[error("A network error occurred: {0:?}")]
    Reqwest(#[from] reqwest::Error),
    #[error("Failed to parse semver {0}")]
    Semver(#[from] semver::Error),
}

/// the inner implementation of [bundle_update_handler]
/// this allows dependency injection of [GetAppSemver] for testing purposes
/// returns an `Option<BundleUpdate>` to denote that no errors occurred but there is no
/// update available
#[tracing::instrument(err)]
async fn bundle_update_handle_inner<T: GetJsBundleSemver>(
    (target, arch, cur_ver): (AllTargets, Arch, semver::Version),
    env: Environment,
) -> Result<Option<BundleUpdate>, UpdateErr> {
    let most_recent = T::get_app_semver(&env).await?;
    if most_recent > cur_ver {
        return Ok(Some(BundleUpdate {
            version: most_recent,
            notes: None,
            url: T::get_app_bundle_path(&env),
        }));
    }

    Ok(None)
}

trait GetJsBundleSemver {
    /// fetch the semver of the current app over the network
    fn get_app_semver(
        env: &Environment,
    ) -> impl Future<Output = Result<semver::Version, UpdateErr>>;
    /// get the Url of the bundle
    fn get_app_bundle_path(env: &Environment) -> Url;
}

/// unit struct to define the default behaviour of the service
/// (not mocked service)
struct DefaultBundleFetcher;

/// the name of the semver file as it exists in the s3 bucket
static SEMVER_FILE_NAME: &str = "/app/semver.txt";
static BUNDLE_ARCHIVE_NAME: &str = "app-archive.zip";

impl GetJsBundleSemver for DefaultBundleFetcher {
    #[tracing::instrument(ret, err)]
    async fn get_app_semver(env: &Environment) -> Result<semver::Version, UpdateErr> {
        let url = env.get_frontend_url().join(SEMVER_FILE_NAME).unwrap();
        let res = reqwest::get(url).await?.error_for_status()?.text().await?;
        let cur_ver = semver::Version::from_str(res.trim())?;
        Ok(cur_ver)
    }

    fn get_app_bundle_path(env: &Environment) -> Url {
        env.get_frontend_url().join(BUNDLE_ARCHIVE_NAME).unwrap()
    }
}
