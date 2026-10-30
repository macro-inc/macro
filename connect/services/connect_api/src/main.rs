//! HTTP API for the embedded Macro Connect registry and customer connections.

mod domain;
mod mcp;
mod outbound;
#[cfg(test)]
mod test_support;

use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use clap::{Parser, Subcommand};
use connect_platform::{ConfigLoader, Telemetry, http_trace_layer, load_aws_config};
use connect_registry::{Access, App, ClientRegistration, Status, all_apps};
use domain::oauth::{
    Client, ConnectSessionResponse, OAuthService, set_redirect_origins as update_redirect_origins,
    validate_origin,
};
use domain::{Connection, ConnectionStatus, Error, GrantCipher, Service};
use outbound::{EnvelopeCipher, KmsKeyWrapper, LocalKeyWrapper, MIGRATOR, PostgresRepository};
use outbound::{mcp::VendorMcp, oauth::VendorOAuth};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use std::{collections::HashMap, sync::Arc};
use tokio::net::TcpListener;
use utoipa::{
    Modify, OpenApi, ToSchema,
    openapi::security::{Http, HttpAuthScheme, SecurityScheme},
};
use zeroize::Zeroize as _;

struct Config {
    port: u16,
    database_url: String,
    kms_key_id: Option<String>,
    local_wrapping_key: Option<zeroize::Zeroizing<String>>,
    public_url: url::Url,
    own_apps: HashMap<String, Client>,
}

impl Config {
    fn load(source: &ConfigLoader, apps: &[App]) -> Result<Self, connect_platform::ConfigError> {
        let public_url_text: String = source.required("CONNECT_PUBLIC_URL")?;
        let public_url = parse_public_url(&public_url_text)?;
        let own_apps = load_own_apps(apps, |key| source.optional(key).map(str::to_owned))?;
        Ok(Self {
            port: source.with_default("PORT", 8080_u16)?,
            database_url: source.required("DATABASE_URL")?,
            kms_key_id: source.optional("CONNECT_KMS_KEY_ID").map(str::to_owned),
            local_wrapping_key: source
                .optional("CONNECT_LOCAL_WRAPPING_KEY")
                .map(|value| zeroize::Zeroizing::new(value.to_owned())),
            public_url,
            own_apps,
        })
    }
}

fn parse_public_url(text: &str) -> Result<url::Url, connect_platform::ConfigError> {
    let invalid = || connect_platform::ConfigError::Invalid("CONNECT_PUBLIC_URL");
    let url = url::Url::parse(text).map_err(|_| invalid())?;
    if validate_origin(&url.origin().ascii_serialization()).is_err()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "/" | "/connect")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(url)
}

fn load_own_apps(
    apps: &[App],
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<HashMap<String, Client>, connect_platform::ConfigError> {
    let mut clients = HashMap::new();
    for app in apps.iter().filter(|app| {
        app.status == Status::Live && app.client_registration == ClientRegistration::OwnApp
    }) {
        let prefix = app.id.as_str().to_ascii_uppercase();
        let id = lookup(&format!("{prefix}_CLIENT_ID"));
        let secret = lookup(&format!("{prefix}_CLIENT_SECRET"));
        let (Some(id), Some(secret)) = (id, secret) else {
            return Err(connect_platform::ConfigError::Invalid(
                "own-app client credentials",
            ));
        };
        if id.is_empty() || secret.is_empty() {
            return Err(connect_platform::ConfigError::Invalid(
                "own-app client credentials",
            ));
        }
        clients.insert(
            app.id.as_str().to_owned(),
            Client {
                id,
                secret: Some(zeroize::Zeroizing::new(secret)),
                kind: ClientRegistration::OwnApp,
            },
        );
    }
    Ok(clients)
}

#[derive(Serialize, ToSchema)]
struct CatalogEntry {
    id: String,
    name: String,
    description: String,
    access: Vec<String>,
    mcp_url: String,
    icon_url: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct TokenResponse {
    access_token: String,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl Drop for TokenResponse {
    fn drop(&mut self) {
        self.access_token.zeroize();
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct DeleteResponse {
    vendor_grant_revoked: bool,
}

#[derive(Serialize, ToSchema)]
struct ErrorResponse {
    error: &'static str,
}

#[derive(Deserialize, ToSchema)]
struct ConnectSessionRequest {
    #[serde(alias = "externalUserId")]
    external_user_id: String,
    #[serde(alias = "appId")]
    app_id: String,
    #[serde(alias = "redirectUrl")]
    redirect_url: String,
}

#[derive(Deserialize)]
struct CallbackQuery {
    state: String,
    code: Option<String>,
    error: Option<String>,
}

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    CreateCustomer {
        name: String,
        #[arg(long = "redirect-origin", required = true)]
        redirect_origin: Vec<String>,
    },
    SetRedirectOrigins {
        customer_id: uuid::Uuid,
        #[arg(required = true)]
        origins: Vec<String>,
    },
}

#[derive(Clone)]
struct AppState {
    apps: &'static [App],
    service: Arc<Service>,
    oauth: Arc<OAuthService>,
    mcp_http: VendorMcp,
}

struct SecurityAddon;
impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "customer_key",
                SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
            );
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        health,
        catalog,
        icon,
        list_connections,
        delete_connection,
        export_token,
        create_connect_session,
        authorize_connect,
        client_metadata,
        oauth_callback,
        mcp::proxy
    ),
    components(schemas(CatalogEntry, Connection, ConnectionStatus, TokenResponse, DeleteResponse, ErrorResponse, mcp::McpErrorResponse, ConnectSessionRequest, ConnectSessionResponse)),
    modifiers(&SecurityAddon)
)]
struct ApiDoc;

#[utoipa::path(get, path = "/health", responses((status = 200, description = "Service is ready")))]
async fn health() -> StatusCode {
    StatusCode::OK
}

#[utoipa::path(get, path = "/v1/catalog", responses((status = 200, body = [CatalogEntry])))]
async fn catalog(State(state): State<AppState>) -> Json<Vec<CatalogEntry>> {
    Json(
        state
            .apps
            .iter()
            .filter(|app| app.status == Status::Live)
            .map(|app| CatalogEntry {
                id: app.id.as_str().to_owned(),
                name: app.name.clone(),
                description: app.description.clone(),
                access: app
                    .access
                    .iter()
                    .map(|access| match access {
                        Access::Mcp => "mcp".to_owned(),
                        Access::Api => "api".to_owned(),
                    })
                    .collect(),
                mcp_url: app.mcp_url.clone(),
                icon_url: app.icon_svg.map(|_| {
                    format!(
                        "{}/v1/catalog/{}/icon.svg",
                        state.oauth.public_path(),
                        app.id
                    )
                }),
            })
            .collect(),
    )
}

#[utoipa::path(
    get,
    path = "/v1/catalog/{id}/icon.svg",
    params(("id" = String, Path, description = "Catalog app id")),
    responses(
        (status = 200, content_type = "image/svg+xml", body = String),
        (status = 404, description = "Unknown app or missing icon")
    )
)]
async fn icon(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<([(header::HeaderName, &'static str); 1], &'static str), StatusCode> {
    let icon = state
        .apps
        .iter()
        .find(|app| app.status == Status::Live && app.id.as_str() == id)
        .and_then(|app| app.icon_svg)
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(([(header::CONTENT_TYPE, "image/svg+xml")], icon))
}

async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

#[utoipa::path(post, path = "/v1/connect-sessions", request_body = ConnectSessionRequest, responses((status = 200, body = ConnectSessionResponse), (status = 400), (status = 401)), security(("customer_key" = [])))]
async fn create_connect_session(
    State(state): State<AppState>,
    axum::extract::Extension(customer_id): axum::extract::Extension<uuid::Uuid>,
    Json(request): Json<ConnectSessionRequest>,
) -> Result<Json<ConnectSessionResponse>, (StatusCode, Json<ErrorResponse>)> {
    state
        .oauth
        .create_session(
            customer_id,
            request.external_user_id,
            request.app_id,
            request.redirect_url,
        )
        .await
        .map(Json)
        .map_err(api_error)
}

#[utoipa::path(get, path = "/v1/connect/{token}", params(("token" = String, Path)), responses((status = 303, description = "Redirect to vendor authorization"), (status = 400)))]
async fn authorize_connect(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Redirect, (StatusCode, Json<ErrorResponse>)> {
    state
        .oauth
        .authorize(&token)
        .await
        .map(|url| Redirect::to(&url))
        .map_err(api_error)
}

#[utoipa::path(get, path = "/v1/oauth/client-metadata.json", responses((status = 200, description = "OAuth client metadata document")))]
async fn client_metadata(State(state): State<AppState>) -> Json<serde_json::Value> {
    let client_id = state.oauth.client_metadata_url();
    Json(serde_json::json!({
        "client_id": client_id,
        "client_name": "Macro Connect",
        "redirect_uris": [client_id.replace("/client-metadata.json", "/callback")],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none"
    }))
}

#[utoipa::path(get, path = "/v1/oauth/callback", responses((status = 303, description = "Return to customer"), (status = 400)))]
async fn oauth_callback(
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
) -> Result<Redirect, (StatusCode, Json<ErrorResponse>)> {
    state
        .oauth
        .callback(&query.state, query.code.as_deref(), query.error.as_deref())
        .await
        .map(|(url, _)| Redirect::to(&url))
        .map_err(api_error)
}

async fn customer_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let Some(key) = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    match state.service.authenticate(key).await {
        Ok(customer_id) => {
            request.extensions_mut().insert(customer_id);
            next.run(request).await
        }
        Err(Error::InvalidKey) => StatusCode::UNAUTHORIZED.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn api_error(error: Error) -> (StatusCode, Json<ErrorResponse>) {
    let (status, code) = match error {
        Error::NotFound => (StatusCode::NOT_FOUND, "not_found"),
        Error::NeedsReauth => (StatusCode::CONFLICT, "needs_reauth"),
        Error::InvalidKey => (StatusCode::UNAUTHORIZED, "invalid_key"),
        Error::InvalidRequest(reason) => (StatusCode::BAD_REQUEST, reason),
        Error::InvalidState => (StatusCode::BAD_REQUEST, "invalid_state"),
        Error::OAuth => (StatusCode::BAD_GATEWAY, "oauth_failed"),
        Error::Storage(_) | Error::Cipher => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
    };
    (status, Json(ErrorResponse { error: code }))
}

#[utoipa::path(get, path = "/v1/users/{external_user_id}/connections", params(("external_user_id" = String, Path)), responses((status = 200, body = [Connection]), (status = 401)), security(("customer_key" = [])))]
async fn list_connections(
    State(state): State<AppState>,
    axum::extract::Extension(customer_id): axum::extract::Extension<uuid::Uuid>,
    Path(user_id): Path<String>,
) -> Result<Json<Vec<Connection>>, (StatusCode, Json<ErrorResponse>)> {
    state
        .service
        .list(customer_id, &user_id)
        .await
        .map(Json)
        .map_err(api_error)
}

#[utoipa::path(delete, path = "/v1/users/{external_user_id}/connections/{app_id}", params(("external_user_id" = String, Path), ("app_id" = String, Path)), responses((status = 200, body = DeleteResponse, description = "Deleted locally; vendor grant is not revoked upstream"), (status = 401), (status = 404)), security(("customer_key" = [])))]
async fn delete_connection(
    State(state): State<AppState>,
    axum::extract::Extension(customer_id): axum::extract::Extension<uuid::Uuid>,
    Path((user_id, app_id)): Path<(String, String)>,
) -> Result<Json<DeleteResponse>, (StatusCode, Json<ErrorResponse>)> {
    if state
        .service
        .delete(customer_id, &user_id, &app_id)
        .await
        .map_err(api_error)?
    {
        Ok(Json(DeleteResponse {
            vendor_grant_revoked: false,
        }))
    } else {
        Err(api_error(Error::NotFound))
    }
}

#[utoipa::path(get, path = "/v1/users/{external_user_id}/connections/{app_id}/token", params(("external_user_id" = String, Path), ("app_id" = String, Path)), responses((status = 200, body = TokenResponse), (status = 401), (status = 404), (status = 409, body = ErrorResponse, description = "Token expired; reauthorization required")), security(("customer_key" = [])))]
async fn export_token(
    State(state): State<AppState>,
    axum::extract::Extension(customer_id): axum::extract::Extension<uuid::Uuid>,
    Path((user_id, app_id)): Path<(String, String)>,
) -> Result<Json<TokenResponse>, (StatusCode, Json<ErrorResponse>)> {
    let mut grant = state
        .oauth
        .export(customer_id, &user_id, &app_id)
        .await
        .map_err(api_error)?;
    Ok(Json(TokenResponse {
        access_token: std::mem::take(&mut grant.access_token),
        expires_at: grant.expires_at,
    }))
}

fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/connect-sessions", post(create_connect_session))
        .route(
            "/v1/users/{external_user_id}/connections",
            get(list_connections),
        )
        .route(
            "/v1/users/{external_user_id}/connections/{app_id}",
            axum::routing::delete(delete_connection),
        )
        .route(
            "/v1/users/{external_user_id}/connections/{app_id}/token",
            get(export_token),
        )
        .route(
            "/v1/users/{external_user_id}/mcp/{app_id}",
            post(mcp::proxy).get(mcp::proxy).delete(mcp::proxy),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), customer_auth));
    let routes = Router::new()
        .route("/health", get(health))
        .route("/v1/catalog", get(catalog))
        .route("/v1/catalog/{id}/icon.svg", get(icon))
        .route("/v1/connect/{token}", get(authorize_connect))
        .route("/v1/oauth/client-metadata.json", get(client_metadata))
        .route("/v1/oauth/callback", get(oauth_callback))
        .route("/openapi.json", get(openapi))
        .merge(protected)
        .with_state(state);
    Router::new()
        .merge(routes.clone())
        .nest("/connect", routes)
        .layer(http_trace_layer())
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let cli = Cli::parse();
    let apps = all_apps().map_err(rootcause::Report::new)?;
    let mut keys: Vec<String> = [
        "DATABASE_URL",
        "CONNECT_KMS_KEY_ID",
        "CONNECT_LOCAL_WRAPPING_KEY",
        "CONNECT_PUBLIC_URL",
        "PORT",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_SERVICE_NAME",
        "RUST_LOG",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    for app in apps.iter().filter(|app| {
        app.status == Status::Live && app.client_registration == ClientRegistration::OwnApp
    }) {
        let prefix = app.id.as_str().to_ascii_uppercase();
        keys.push(format!("{prefix}_CLIENT_ID"));
        keys.push(format!("{prefix}_CLIENT_SECRET"));
    }
    let key_refs: Vec<&str> = keys.iter().map(String::as_str).collect();
    let source = ConfigLoader::load(&key_refs)?;
    let config = Config::load(&source, apps)?;
    let telemetry = Telemetry::init("connect_api", &source)?;
    drop(source);
    let result = match cli.command {
        Some(Command::CreateCustomer {
            name,
            redirect_origin,
        }) => create_customer(&config, &name, &redirect_origin).await,
        Some(Command::SetRedirectOrigins {
            customer_id,
            origins,
        }) => set_redirect_origins(&config, customer_id, &origins).await,
        None => run(&config, apps).await,
    };
    telemetry.shutdown()?;
    result
}

async fn run(config: &Config, apps: &'static [App]) -> Result<(), rootcause::Report> {
    let pool = PgPoolOptions::new().connect(&config.database_url).await?;
    MIGRATOR.run(&pool).await?;
    let wrapper: Arc<dyn outbound::KeyWrapper> = if let Some(key_id) = &config.kms_key_id {
        let aws = load_aws_config().await;
        Arc::new(KmsKeyWrapper::new(
            aws_sdk_kms::Client::new(&aws),
            key_id.clone(),
        ))
    } else if let Some(key) = &config.local_wrapping_key {
        Arc::new(LocalKeyWrapper::from_base64(key).map_err(rootcause::Report::new)?)
    } else {
        return Err(
            rootcause::Report::new(connect_platform::ConfigError::Missing(
                "CONNECT_KMS_KEY_ID or CONNECT_LOCAL_WRAPPING_KEY",
            ))
            .into(),
        );
    };
    let cipher: Arc<dyn GrantCipher> = Arc::new(EnvelopeCipher::new(wrapper));
    let repository = Arc::new(PostgresRepository::new(pool));
    let service = Arc::new(Service::new(repository.clone()));
    let oauth = Arc::new(OAuthService::new(
        repository,
        cipher,
        Arc::new(VendorOAuth::new().map_err(rootcause::Report::new)?),
        apps,
        config.public_url.clone(),
        config.own_apps.clone(),
    ));
    let mcp_http = VendorMcp::new().map_err(rootcause::Report::new)?;
    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, "connect_api listening");
    axum::serve(
        listener,
        router(AppState {
            apps,
            service,
            oauth,
            mcp_http,
        }),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}

async fn create_customer(
    config: &Config,
    name: &str,
    origins: &[String],
) -> Result<(), rootcause::Report> {
    for origin in origins {
        validate_origin(origin).map_err(rootcause::Report::new)?;
    }
    let pool = PgPoolOptions::new().connect(&config.database_url).await?;
    MIGRATOR.run(&pool).await?;
    let key = PostgresRepository::new(pool)
        .create_customer_with_origins(name, origins)
        .await
        .map_err(rootcause::Report::new)?;
    println!("{}", key.as_str());
    Ok(())
}

async fn set_redirect_origins(
    config: &Config,
    customer_id: uuid::Uuid,
    origins: &[String],
) -> Result<(), rootcause::Report> {
    for origin in origins {
        validate_origin(origin).map_err(rootcause::Report::new)?;
    }
    let pool = PgPoolOptions::new().connect(&config.database_url).await?;
    MIGRATOR.run(&pool).await?;
    let updated = update_redirect_origins(&PostgresRepository::new(pool), customer_id, origins)
        .await
        .map_err(rootcause::Report::new)?;
    if !updated {
        return Err(rootcause::Report::new(Error::NotFound).into());
    }
    Ok(())
}

#[cfg(test)]
mod oauth_test;
#[cfg(test)]
mod test;
