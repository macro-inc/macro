//! Agent teammates' workspace repos (`crates/agent_git`): smart HTTP and the
//! internal create/ensure/delete API, under the `/agent-git` gateway prefix.
//!
//! The bare repos live under `REPO_STORAGE_ROOT`, the EFS volume every
//! replica mounts. Each repo's push budget is a row in Postgres and each
//! push and management call holds a Postgres advisory lock on its repo, so
//! the replicas act as one server.

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use agent_git::domain::models::RepoLimits;
use agent_git::domain::service::{AgentGitAdapters, AgentGitServiceImpl};
use agent_git::domain::template::WORKSPACE_TEMPLATE;
use agent_git::inbound::http::{AgentGitRouterState, agent_git_router};
use agent_git::outbound::bare_repo_store::BareRepoStore;
use agent_git::outbound::git_http_backend::GitHttpBackend;
use agent_git::outbound::pg_repo_repository::PgRepoRepository;
use agent_git::outbound::push_rate_limiter::PgPushRateLimiter;
use agent_git::outbound::repo_directories::RepoDirectories;
use agent_git::outbound::team_admins::TeamRepositoryAdmins;
use axum::Router;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_service_urls::AgentGitServiceUrl;
use sqlx::PgPool;
use tokio_util::task::TaskTracker;
use tower_http::trace::TraceLayer;

#[cfg(test)]
mod test;

/// Prefix the shared gateway forwards unchanged.
const GATEWAY_PATH_PREFIX: &str = "/agent-git";
/// Longest wait for running git processes after the HTTP server stops.
const GIT_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// What the repos need from the harness's configuration.
pub(crate) struct AgentGitSettings<'config> {
    /// The repos' directory; must exist.
    pub repo_storage_root: &'config Path,
    /// Pushes are refused once a repo reaches this size.
    pub max_repo_size_bytes: u64,
    /// Push budget per repo.
    pub pushes_per_minute: u32,
}

/// The routes, nested under `/agent-git`. `git_tasks` tracks the running
/// `git http-backend` processes; drain it after the HTTP server stops.
pub(crate) async fn router<Auth>(
    settings: AgentGitSettings<'_>,
    pool: PgPool,
    authorization: MacroAuthorizationState<Auth>,
    git_tasks: TaskTracker,
    feature_flags: Option<feature_flags::outbound::posthog::PostHogFeatureFlags>,
) -> anyhow::Result<Router>
where
    Auth: MacroAuthorizationService,
{
    check_git(Path::new("git"))?;
    // Fail at startup, not on the first clone, when the volume is missing.
    if !tokio::fs::metadata(settings.repo_storage_root)
        .await?
        .is_dir()
    {
        anyhow::bail!(
            "REPO_STORAGE_ROOT {} is not a directory",
            settings.repo_storage_root.display()
        );
    }
    let directories = RepoDirectories::new(settings.repo_storage_root.to_path_buf());
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: PgRepoRepository::new(pool.clone()),
            store: BareRepoStore::new(directories.clone()),
            admins: TeamRepositoryAdmins::new(teams::outbound::team_repo::TeamRepositoryImpl::new(
                pool.clone(),
            )),
            limiter: PgPushRateLimiter::new(pool.clone(), settings.pushes_per_minute),
            backend: GitHttpBackend::new(directories, git_tasks),
            creators: agent_credentials::rollout::PgAgentCreators::new(pool),
            flags: feature_flags,
        },
        RepoLimits {
            max_repo_size_bytes: settings.max_repo_size_bytes,
        },
        WORKSPACE_TEMPLATE,
    );
    let public_base_url = AgentGitServiceUrl::new()?.to_string();
    let routes = agent_git_router(AgentGitRouterState::new(
        Arc::new(service),
        authorization,
        public_base_url.trim_end_matches('/').to_owned(),
    ));
    // No compression layer: pack streams are already compressed.
    Ok(Router::new().nest(GATEWAY_PATH_PREFIX, routes).layer(
        TraceLayer::new_for_http()
            .make_span_with(macro_tower_layers::MakeSpanWithRemoteParent)
            .on_request(())
            .on_response(macro_tower_layers::CustomOnResponse::new_with_threshold(
                std::time::Duration::from_millis(200),
            ))
            .on_failure(macro_tower_layers::CustomOnFailure),
    ))
}

/// The image must carry git with its `http-backend`; say so at startup
/// rather than on the first clone.
fn check_git(git: &Path) -> anyhow::Result<()> {
    let version = Command::new(git)
        .arg("--version")
        .output()
        .map_err(|error| anyhow::anyhow!("agent repos need git in the harness image: {error}"))?;
    if !version.status.success() {
        anyhow::bail!("git --version failed; install git in the harness image");
    }
    let exec_path = Command::new(git).arg("--exec-path").output()?;
    let path = String::from_utf8(exec_path.stdout)?;
    if !exec_path.status.success() || !Path::new(path.trim()).join("git-http-backend").is_file() {
        anyhow::bail!("agent repos need git http-backend; install the full git runtime");
    }
    Ok(())
}

/// Wait, up to [`GIT_SHUTDOWN_TIMEOUT`], for the git processes still running
/// once the HTTP server has stopped.
pub(crate) async fn drain(git_tasks: &TaskTracker) -> anyhow::Result<()> {
    git_tasks.close();
    if tokio::time::timeout(GIT_SHUTDOWN_TIMEOUT, git_tasks.wait())
        .await
        .is_err()
    {
        anyhow::bail!("agent git processes did not finish within {GIT_SHUTDOWN_TIMEOUT:?}");
    }
    Ok(())
}
