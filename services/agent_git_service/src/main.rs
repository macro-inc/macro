//! Composition root of the agent workspace git service.

use std::sync::Arc;

use agent_git::domain::models::RepoLimits;
use agent_git::domain::service::{AgentGitAdapters, AgentGitServiceImpl};
use agent_git::domain::template::WORKSPACE_TEMPLATE;
use agent_git::inbound::http::{AgentGitRouterState, agent_git_router};
use agent_git::outbound::bare_repo_store::BareRepoStore;
use agent_git::outbound::git_http_backend::GitHttpBackend;
use agent_git::outbound::pg_repo_repository::PgRepoRepository;
use agent_git::outbound::push_rate_limiter::InMemoryPushRateLimiter;
use agent_git::outbound::repo_directories::RepoDirectories;
use agent_git::outbound::team_admins::TeamRepositoryAdmins;
use axum::{Router, http::StatusCode, routing::get};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, PgUserApiKeyAuthorizationRepo,
    PgUserApiKeyAuthorizer,
};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_service_urls::AgentGitServiceUrl;
use sqlx::postgres::PgPoolOptions;
use tokio_util::task::TaskTracker;
use tower_http::trace::TraceLayer;

mod config;
mod git_runtime;

#[cfg(test)]
mod test;

const PORT: u16 = 8080;
/// Prefix the shared gateway forwards unchanged.
const GATEWAY_PATH_PREFIX: &str = "/agent-git";
const MAX_DATABASE_CONNECTIONS: u32 = 10;
/// Maximum tracker-drain time after Axum's graceful shutdown completes.
const GIT_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    git_runtime::check(std::path::Path::new("git"))?;
    let config = macro_config::ConfigLoader::load::<config::Config>()?;

    let pool = PgPoolOptions::new()
        .max_connections(MAX_DATABASE_CONNECTIONS)
        .connect(config.database_url.as_ref())
        .await?;

    let secrets_manager = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&macro_aws_config::get_macro_aws_config().await),
    );
    let jwt_args =
        JwtValidationArgs::new_with_secret_manager(config.environment, &secrets_manager).await?;
    let authorization_state =
        MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
            MacroAuthJwtValidator::new(jwt_args),
            InternalAuthConfig {
                api_key: config.internal_api_key.to_string(),
                default_user_id: None,
            },
            NoBotAuthorizer,
            PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(pool.clone())),
        )));

    // Fail at startup, not on the first clone, when the volume is missing.
    if !tokio::fs::metadata(&config.repo_storage_root)
        .await?
        .is_dir()
    {
        return Err(rootcause::report!(
            "REPO_STORAGE_ROOT {} is not a directory",
            config.repo_storage_root.display()
        ));
    }
    let directories = RepoDirectories::new(config.repo_storage_root.clone());

    let git_tasks = TaskTracker::new();
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: PgRepoRepository::new(pool.clone()),
            store: BareRepoStore::new(directories.clone()),
            admins: TeamRepositoryAdmins::new(teams::outbound::team_repo::TeamRepositoryImpl::new(
                pool,
            )),
            limiter: InMemoryPushRateLimiter::new(config.pushes_per_minute),
            backend: GitHttpBackend::new(directories, git_tasks.clone()),
        },
        RepoLimits {
            max_repo_size_bytes: config.max_repo_size_bytes,
        },
        WORKSPACE_TEMPLATE,
    );

    let public_base_url = AgentGitServiceUrl::new()?.to_string();
    let routes = agent_git_router(AgentGitRouterState::new(
        Arc::new(service),
        authorization_state,
        public_base_url.trim_end_matches('/').to_owned(),
    ))
    .route("/health", get(|| async { StatusCode::OK }));

    // No compression layer: pack streams are already compressed.
    let app = Router::new()
        .merge(routes.clone())
        .nest(GATEWAY_PATH_PREFIX, routes)
        .layer(macro_cors::cors_layer())
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(macro_tower_layers::MakeSpanWithRemoteParent)
                .on_request(())
                .on_response(macro_tower_layers::CustomOnResponse::new_with_threshold(
                    std::time::Duration::from_millis(200),
                ))
                .on_failure(macro_tower_layers::CustomOnFailure),
        );

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await?;
    tracing::info!(port = PORT, "agent git service listening");

    let result = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await;

    drain_git_tasks(&git_tasks).await?;
    result?;

    Ok(())
}

async fn drain_git_tasks(git_tasks: &TaskTracker) -> Result<(), rootcause::Report> {
    git_tasks.close();
    if tokio::time::timeout(GIT_SHUTDOWN_TIMEOUT, git_tasks.wait())
        .await
        .is_err()
    {
        return Err(rootcause::report!("git backend shutdown drain timed out"));
    }
    Ok(())
}
