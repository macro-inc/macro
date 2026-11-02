//! Standalone browser customer for exercising Macro Connect.

mod mcp;
#[cfg(test)]
mod test;

use std::{collections::HashSet, sync::Arc, time::Duration};

use axum::{
    Extension, Form, Router,
    extract::{Path, Query, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use connect_client::{
    ConnectClient,
    wire::{ConnectionStatus, OAuthClient, UsersQuery},
};
use connect_platform::{ConfigLoader, Telemetry, http_trace_layer};
use serde::Deserialize;
use serde_json::Value;
use tokio::net::TcpListener;
use tracing::Span;
use url::Url;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    client: Arc<ConnectClient>,
    http: reqwest::Client,
    public_url: Url,
}

#[derive(Clone)]
struct DemoUser(String);

fn page(title: &str, content: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>{}</style></head><body><h1>Macro Connect demo</h1><nav><a href=\"/demo\">Catalog</a><a href=\"/demo/dashboard\">Dashboard</a></nav>{content}<script>{}</script></body></html>",
        escape(title),
        include_str!("style.css"),
        include_str!("app.js")
    ))
}

fn escape(text: &str) -> String {
    html_escape::encode_safe(text).into_owned()
}

fn path_id(id: &str) -> String {
    url::form_urlencoded::byte_serialize(id.as_bytes()).collect()
}

fn error_page(error: impl std::fmt::Display) -> Response {
    (
        StatusCode::BAD_GATEWAY,
        page(
            "Demo error",
            &format!(
                "<p class=\"error\">{}</p><a href=\"/demo\">Back to catalog</a>",
                escape(&error.to_string())
            ),
        ),
    )
        .into_response()
}

fn error_fragment(error: impl std::fmt::Display) -> Response {
    (
        StatusCode::BAD_GATEWAY,
        Html(format!(
            "<p class=\"error\">{}</p>",
            escape(&error.to_string())
        )),
    )
        .into_response()
}

async fn cookie(mut request: Request, next: Next) -> Response {
    let existing = request
        .headers()
        .get(header::COOKIE)
        .and_then(|header| header.to_str().ok())
        .and_then(|value| {
            value
                .split(';')
                .find_map(|part| part.trim().strip_prefix("connect_demo_user="))
                .and_then(|value| Uuid::parse_str(value).ok())
        });
    let id = existing.unwrap_or_else(Uuid::new_v4);
    request.extensions_mut().insert(DemoUser(id.to_string()));
    let mut response = next.run(request).await;
    if existing.is_none()
        && let Ok(value) = HeaderValue::from_str(&format!(
            "connect_demo_user={id}; Path=/demo; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax"
        ))
    {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn health() -> &'static str {
    "ok"
}

async fn catalog(State(state): State<AppState>, Extension(user): Extension<DemoUser>) -> Response {
    let (apps, connections) =
        match tokio::try_join!(state.client.catalog(), state.client.connections(&user.0)) {
            Ok(value) => value,
            Err(error) => return error_page(error),
        };
    let connected: HashSet<&str> = connections
        .iter()
        .filter(|connection| matches!(connection.status, ConnectionStatus::Active))
        .map(|connection| connection.app_id.as_str())
        .collect();
    let mut content =
        String::from("<p>Connect an app, then try its MCP tools.</p><div class=\"grid\">");
    for app in apps {
        let id = path_id(&app.id);
        content.push_str("<section class=\"card\">");
        if app.icon_url.is_some() {
            content.push_str(&format!("<img alt=\"\" src=\"/demo/icons/{id}\">"));
        }
        content.push_str(&format!(
            "<h2>{}</h2><p>{}</p><span class=\"badge\">{}</span><div class=\"actions\">",
            escape(&app.name),
            escape(&app.description),
            if app.access.iter().any(|access| access == "api") {
                "MCP + API"
            } else {
                "MCP"
            }
        ));
        if let Some(oauth_client) = app.oauth_client {
            content.push_str(match oauth_client {
                OAuthClient::ManagedOauthApp => "<span class=\"badge\">Managed OAuth app</span>",
                OAuthClient::Dcr => "<span class=\"badge\">DCR</span>",
            });
        }
        if connected.contains(app.id.as_str()) {
            content.push_str(&format!("<strong>Connected</strong><form method=\"post\" action=\"/demo/disconnect/{id}\"><button>Disconnect</button></form><form class=\"ajax\" method=\"post\" action=\"/demo/apps/{id}/tools\"><button>Try it</button></form><small>Disconnect removes this demo connection without revoking vendor access.</small>"));
        } else {
            content.push_str(&format!("<form method=\"post\" action=\"/demo/connect/{id}\"><button>Connect</button></form>"));
        }
        content.push_str("</div></section>");
    }
    content.push_str("</div><div id=\"workspace\" aria-live=\"polite\"></div>");
    page("Catalog", &content).into_response()
}

#[derive(Default, Deserialize)]
struct DashboardQuery {
    app_id: Option<String>,
    status: Option<String>,
    cursor: Option<String>,
}

fn dashboard_url(query: &DashboardQuery, cursor: Option<&str>) -> String {
    let mut pairs = url::form_urlencoded::Serializer::new(String::new());
    let mut has_query = false;
    if let Some(app_id) = &query.app_id {
        pairs.append_pair("app_id", app_id);
        has_query = true;
    }
    if let Some(status) = &query.status {
        pairs.append_pair("status", status);
        has_query = true;
    }
    if let Some(cursor) = cursor {
        pairs.append_pair("cursor", cursor);
        has_query = true;
    }
    let encoded = pairs.finish();
    if has_query {
        format!("/demo/dashboard?{encoded}")
    } else {
        "/demo/dashboard".to_owned()
    }
}

#[tracing::instrument(name = "demo.dashboard", skip_all, fields(count, outcome))]
async fn dashboard(
    State(state): State<AppState>,
    Extension(user): Extension<DemoUser>,
    Query(query): Query<DashboardQuery>,
) -> Response {
    let status = match query.status.as_deref() {
        None | Some("") => None,
        Some("active") => Some(ConnectionStatus::Active),
        Some("needs_reauth") => Some(ConnectionStatus::NeedsReauth),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                page("Dashboard", "<p class=\"error\">Invalid status filter.</p>"),
            )
                .into_response();
        }
    };
    let (apps, summary, users) = match tokio::try_join!(
        state.client.catalog(),
        state.client.connections_summary(),
        state.client.list_users(UsersQuery {
            limit: Some(500),
            cursor: query.cursor.clone(),
            app_id: query.app_id.clone().filter(|value| !value.is_empty()),
            status,
        })
    ) {
        Ok(value) => value,
        Err(error) => {
            Span::current().record("outcome", "error");
            return error_page(error);
        }
    };
    Span::current().record("count", users.items.len());
    Span::current().record("outcome", "ok");
    let mut content = format!(
        "<h2>Dashboard</h2><div class=\"tiles\"><section class=\"card\"><strong>{}</strong><span>Users</span></section><section class=\"card\"><strong>{}</strong><span>Connections</span></section><section class=\"card\"><strong>{}</strong><span>Needs re-auth</span></section></div>",
        summary.users, summary.connections, summary.needs_reauth
    );
    content.push_str("<h2>Apps</h2><table><thead><tr><th>App</th><th>Active</th><th>Needs re-auth</th></tr></thead><tbody>");
    for app in &apps {
        let counts = summary.apps.iter().find(|counts| counts.app_id == app.id);
        let active = counts.map_or(0, |counts| counts.active);
        let needs_reauth = counts.map_or(0, |counts| counts.needs_reauth);
        let icon = if app.icon_url.is_some() {
            format!(
                "<img class=\"app-icon\" alt=\"\" src=\"/demo/icons/{}\">",
                path_id(&app.id)
            )
        } else {
            String::new()
        };
        content.push_str(&format!("<tr><td data-label=\"App\">{icon}{}</td><td data-label=\"Active\">{active}</td><td data-label=\"Needs re-auth\">{needs_reauth}</td></tr>", escape(&app.name)));
    }
    content.push_str("</tbody></table><h2>Users</h2><form method=\"get\" action=\"/demo/dashboard\" class=\"filters\"><label>App<select name=\"app_id\"><option value=\"\">All apps</option>");
    for app in &apps {
        content.push_str(&format!(
            "<option value=\"{}\"{}>{}</option>",
            escape(&app.id),
            if query.app_id.as_deref() == Some(&app.id) {
                " selected"
            } else {
                ""
            },
            escape(&app.name)
        ));
    }
    content.push_str("</select></label><label>Status<select name=\"status\"><option value=\"\">All statuses</option>");
    for (value, label) in [("active", "Active"), ("needs_reauth", "Needs re-auth")] {
        content.push_str(&format!(
            "<option value=\"{value}\"{}>{label}</option>",
            if query.status.as_deref() == Some(value) {
                " selected"
            } else {
                ""
            }
        ));
    }
    content.push_str("</select></label><button>Filter</button></form>");
    if users.items.is_empty() {
        content.push_str("<p>No connected users match these filters.</p>");
    } else {
        content.push_str("<table><thead><tr><th>User</th><th>Apps</th><th>First connected</th><th>Next token expiry</th></tr></thead><tbody>");
        let now = chrono::Utc::now();
        for listed_user in &users.items {
            let id = &listed_user.external_user_id;
            let connections = &listed_user.connections;
            let short: String = id.chars().take(12).collect();
            let marker = if id == &user.0 {
                " <span class=\"badge\">you</span>"
            } else {
                ""
            };
            let expiry = connections
                .iter()
                .filter_map(|connection| connection.access_token_expires_at)
                .filter(|expiry| *expiry > now)
                .min();
            let badges = connections
                .iter()
                .map(|connection| {
                    format!(
                        "<span class=\"status-badge\">{}: {}</span>",
                        escape(
                            apps.iter()
                                .find(|app| app.id == connection.app_id)
                                .map_or(connection.app_id.as_str(), |app| app.name.as_str())
                        ),
                        match connection.status {
                            ConnectionStatus::Active => "active",
                            ConnectionStatus::NeedsReauth => "needs re-auth",
                        }
                    )
                })
                .collect::<Vec<_>>()
                .join(" ");
            content.push_str(&format!("<tr><td data-label=\"User\"><span title=\"{}\">{}</span>{marker}</td><td data-label=\"Apps\">{badges}</td><td data-label=\"First connected\">{}</td><td data-label=\"Next token expiry\">{}</td></tr>", escape(id), escape(&short), listed_user.first_connected_at.format("%Y-%m-%d"), expiry.map_or_else(|| "—".to_owned(), |time| time.format("%Y-%m-%d %H:%M UTC").to_string())));
        }
        content.push_str("</tbody></table>");
    }
    if let Some(cursor) = users.next_cursor.as_deref() {
        content.push_str(&format!(
            "<p><a href=\"{}\">More users</a></p>",
            escape(&dashboard_url(&query, Some(cursor)))
        ));
    }
    page("Dashboard", &content).into_response()
}

async fn icon(State(state): State<AppState>, Path(app_id): Path<String>) -> Response {
    match state.client.catalog_icon(&app_id).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/svg+xml"),
                (header::CACHE_CONTROL, "public, max-age=3600"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn connect(
    State(state): State<AppState>,
    Extension(user): Extension<DemoUser>,
    Path(app_id): Path<String>,
) -> Response {
    let mut redirect_url = state.public_url.clone();
    redirect_url.set_path("/demo/connected");
    redirect_url.query_pairs_mut().append_pair("app", &app_id);
    match state
        .client
        .create_connect_session(&user.0, &app_id, redirect_url.as_str())
        .await
    {
        Ok(session) => (
            StatusCode::SEE_OTHER,
            [(header::LOCATION, session.connect_url)],
        )
            .into_response(),
        Err(error) => error_page(error),
    }
}

#[derive(Default, Deserialize)]
struct ConnectedQuery {
    app: Option<String>,
    app_id: Option<String>,
    status: Option<String>,
    reason: Option<String>,
}

async fn connected(Query(query): Query<ConnectedQuery>) -> Html<String> {
    let app = query
        .app_id
        .or(query.app)
        .unwrap_or_else(|| "app".to_owned());
    let content = if query.status.as_deref() == Some("error") {
        format!(
            "<p class=\"error\">Could not connect {}: {}</p>",
            escape(&app),
            escape(query.reason.as_deref().unwrap_or("unknown error"))
        )
    } else if query.status.as_deref() == Some("connected") {
        format!("<p>Connected {}.</p>", escape(&app))
    } else {
        "<p>Connection result is unavailable.</p>".to_owned()
    };
    page(
        "Connection result",
        &format!("{content}<a href=\"/demo\">Back to catalog</a>"),
    )
}

async fn disconnect(
    State(state): State<AppState>,
    Extension(user): Extension<DemoUser>,
    Path(app_id): Path<String>,
) -> Response {
    match state.client.delete_connection(&user.0, &app_id).await {
        Ok(_) => Redirect::to("/demo").into_response(),
        Err(error) => error_page(error),
    }
}

#[tracing::instrument(name = "demo.mcp_list_tools", skip_all, fields(app_id = %app_id, outcome))]
async fn tools(
    State(state): State<AppState>,
    Extension(user): Extension<DemoUser>,
    Path(app_id): Path<String>,
) -> Response {
    let result = mcp::list_tools(&state.client, &state.http, &user.0, &app_id).await;
    Span::current().record("outcome", if result.is_ok() { "ok" } else { "error" });
    match result {
        Ok(value) => {
            let id = path_id(&app_id);
            let mut content = format!("<p>Tools for {}.</p>", escape(&app_id));
            if let Some(list) = value.get("tools").and_then(Value::as_array) {
                for tool in list {
                    let name = tool.get("name").and_then(Value::as_str).unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }
                    let schema = serde_json::to_string_pretty(
                        tool.get("inputSchema").unwrap_or(&Value::Null),
                    )
                    .unwrap_or_else(|_| "null".to_owned());
                    content.push_str(&format!("<section class=\"panel\"><h2>{}</h2><p>{}</p><details><summary>Input schema</summary><pre>{}</pre></details><form class=\"ajax\" method=\"post\" action=\"/demo/apps/{id}/call\"><input type=\"hidden\" name=\"name\" value=\"{}\"><label>JSON arguments<textarea name=\"arguments\">{{}}</textarea></label><button>Run tool</button></form></section>", escape(name), escape(tool.get("description").and_then(Value::as_str).unwrap_or("")), escape(&schema), escape(name)));
                }
            }
            content.push_str("<a href=\"/demo\">Back to catalog</a>");
            Html(content).into_response()
        }
        Err(error) => error_fragment(error),
    }
}

#[derive(Deserialize)]
struct CallForm {
    name: String,
    arguments: String,
}

#[tracing::instrument(name = "demo.mcp_call_tool", skip_all, fields(app_id = %app_id, outcome))]
async fn call(
    State(state): State<AppState>,
    Extension(user): Extension<DemoUser>,
    Path(app_id): Path<String>,
    Form(form): Form<CallForm>,
) -> Response {
    let arguments: Value = match serde_json::from_str(&form.arguments) {
        Ok(value @ Value::Object(_)) => value,
        _ => {
            Span::current().record("outcome", "invalid_arguments");
            return (
                StatusCode::BAD_REQUEST,
                Html("<p class=\"error\">Arguments must be a JSON object.</p>".to_owned()),
            )
                .into_response();
        }
    };
    let result = mcp::call_tool(
        &state.client,
        &state.http,
        &user.0,
        &app_id,
        &form.name,
        arguments,
    )
    .await;
    Span::current().record("outcome", if result.is_ok() { "ok" } else { "error" });
    match result {
        Ok(value) => {
            let text = serde_json::to_string_pretty(&expand_text_json(value))
                .unwrap_or_else(|_| "null".to_owned());
            let id = path_id(&app_id);
            Html(format!("<section class=\"panel\"><h2>{}</h2><pre>{}</pre><form class=\"ajax\" method=\"post\" action=\"/demo/apps/{id}/tools\"><button>Back to tools</button></form></section>", escape(&form.name), escape(&text))).into_response()
        }
        Err(error) => error_fragment(error),
    }
}

/// Parses JSON carried in MCP text content so results read as nested JSON.
fn expand_text_json(mut value: Value) -> Value {
    if let Some(content) = value.get_mut("content").and_then(Value::as_array_mut) {
        for item in content {
            let parsed = item
                .get("text")
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .filter(|parsed| parsed.is_object() || parsed.is_array());
            if let Some(parsed) = parsed {
                item["text"] = parsed;
            }
        }
    }
    value
}

fn router(state: AppState) -> Router {
    let browser = Router::new()
        .route("/demo", get(catalog))
        .route("/demo/dashboard", get(dashboard))
        .route("/demo/icons/{app_id}", get(icon))
        .route("/demo/connect/{app_id}", post(connect))
        .route("/demo/connected", get(connected))
        .route("/demo/disconnect/{app_id}", post(disconnect))
        .route("/demo/apps/{app_id}/tools", post(tools))
        .route("/demo/apps/{app_id}/call", post(call))
        .layer(middleware::from_fn(cookie));
    Router::new()
        .route("/demo/health", get(health))
        .merge(browser)
        .with_state(state)
        .layer(http_trace_layer())
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let source = ConfigLoader::load(&[
        "CONNECT_BASE_URL",
        "CONNECT_DEMO_CUSTOMER_KEY",
        "CONNECT_DEMO_PUBLIC_URL",
        "PORT",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_SERVICE_NAME",
        "RUST_LOG",
    ])?;
    let base_url: String = source.required("CONNECT_BASE_URL")?;
    let customer_key: String = source.required("CONNECT_DEMO_CUSTOMER_KEY")?;
    let public_url_text: String = source.required("CONNECT_DEMO_PUBLIC_URL")?;
    let public_url = Url::parse(&public_url_text)?;
    if !matches!(public_url.scheme(), "http" | "https")
        || public_url.path() != "/demo"
        || public_url.query().is_some()
        || public_url.fragment().is_some()
        || !public_url.username().is_empty()
        || public_url.password().is_some()
    {
        return Err(rootcause::Report::new(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "CONNECT_DEMO_PUBLIC_URL must be an HTTP(S) URL ending in /demo",
        ))
        .into_dynamic());
    }
    let port: u16 = source.with_default("PORT", 3000)?;
    let telemetry = Telemetry::init("connect_demo", &source)?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let state = AppState {
        client: Arc::new(ConnectClient::new(&base_url, customer_key)?),
        http,
        public_url,
    };
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    telemetry.shutdown()?;
    Ok(())
}
