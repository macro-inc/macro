//! Run opt-in checks against a live Connect API.

#[cfg(test)]
mod test;

use std::{collections::BTreeSet, process::ExitCode, time::Duration};

use clap::Parser;
use connect_client::{
    ConnectClient,
    wire::{ConnectSessionRequest, ErrorResponse, McpErrorResponse},
};
use connect_registry::{ClientRegistration, Status, all_apps};
use reqwest::{Client, StatusCode, header};
use rmcp::transport::auth::AuthorizationManager;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    base_url: Url,
    #[arg(long)]
    public_url: Option<Url>,
    #[arg(long)]
    customer_key: String,
    #[arg(long)]
    redirect_origin: Url,
    #[arg(long)]
    follow_vendor: bool,
    #[arg(long)]
    acceptance: bool,
    #[arg(long, requires = "acceptance")]
    dcr_only: bool,
}

type Check = Result<(), String>;

fn record(failures: &mut usize, name: &str, result: Check) {
    match result {
        Ok(()) => println!("PASS {name}: ok"),
        Err(reason) => {
            println!("FAIL {name}: {reason}");
            *failures += 1;
        }
    }
}

fn route(base: &Url, path: &str) -> Url {
    base.join(path).expect("fixed route is a valid URL")
}

fn query_value<'a>(url: &'a Url, name: &str) -> Option<std::borrow::Cow<'a, str>> {
    url.query_pairs()
        .find_map(|(key, value)| (key == name).then_some(value))
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();
    let customer_key = Zeroizing::new(args.customer_key);
    let base = args.base_url;
    let public_url = args.public_url.unwrap_or_else(|| base.clone());
    let redirect_origin = args.redirect_origin;
    if !matches!(base.scheme(), "http" | "https")
        || base.path() != "/"
        || base.query().is_some()
        || base.fragment().is_some()
        || !matches!(public_url.scheme(), "http" | "https")
        || public_url.path() != "/"
        || public_url.query().is_some()
        || public_url.fragment().is_some()
        || !matches!(redirect_origin.scheme(), "http" | "https")
        || redirect_origin.path() != "/"
        || redirect_origin.query().is_some()
        || redirect_origin.fragment().is_some()
    {
        eprintln!("base URL, public URL, and redirect origin must be HTTP(S) origins");
        return ExitCode::FAILURE;
    }
    if args.follow_vendor && !args.acceptance && base.scheme() != "https" {
        eprintln!("--follow-vendor requires a public HTTPS base URL");
        return ExitCode::FAILURE;
    }
    let http = match Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(http) => http,
        Err(error) => {
            eprintln!("HTTP client setup failed: {error}");
            return ExitCode::FAILURE;
        }
    };
    let client = match ConnectClient::new(base.as_str(), customer_key.as_str()) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("Connect client setup failed: {error}");
            return ExitCode::FAILURE;
        }
    };
    let user_id = Uuid::now_v7().to_string();
    let redirect_url = route(&redirect_origin, "connect-integration/callback").to_string();
    let mut failures = 0;

    record(
        &mut failures,
        "health",
        async {
            let response = http
                .get(route(&base, "health"))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            (response.status() == StatusCode::OK)
                .then_some(())
                .ok_or_else(|| format!("expected 200, got {}", response.status()))
        }
        .await,
    );

    let apps = match all_apps() {
        Ok(apps) => apps,
        Err(error) => {
            record(&mut failures, "catalog", Err(error.to_string()));
            return ExitCode::FAILURE;
        }
    };
    let live: Vec<_> = apps
        .iter()
        .filter(|app| app.status == Status::Live)
        .collect();
    if args.acceptance {
        let selected: Vec<_> = live
            .iter()
            .copied()
            .filter(|app| !args.dcr_only || app.client_registration == ClientRegistration::Dcr)
            .collect();
        return run_acceptance(
            &client,
            &http,
            &base,
            &public_url,
            &user_id,
            &redirect_url,
            &selected,
        )
        .await;
    }
    record(
        &mut failures,
        "catalog",
        async {
            let entries = client.catalog().await.map_err(|e| e.to_string())?;
            let expected: BTreeSet<_> = live.iter().map(|app| app.id.as_str()).collect();
            let actual: BTreeSet<_> = entries.iter().map(|entry| entry.id.as_str()).collect();
            if actual != expected || entries.len() != expected.len() {
                return Err(format!(
                    "live app IDs differ: expected {expected:?}, got {actual:?}"
                ));
            }
            for entry in entries {
                if let Some(icon_url) = entry.icon_url {
                    let url = base
                        .join(&icon_url)
                        .map_err(|e| format!("{} icon URL: {e}", entry.id))?;
                    let response = http.get(url).send().await.map_err(|e| e.to_string())?;
                    if response.status() != StatusCode::OK
                        || !response
                            .headers()
                            .get(header::CONTENT_TYPE)
                            .is_some_and(|value| {
                                value
                                    .to_str()
                                    .is_ok_and(|value| value.starts_with("image/svg+xml"))
                            })
                    {
                        return Err(format!(
                            "{} icon is not served as SVG: {}",
                            entry.id,
                            response.status()
                        ));
                    }
                    let body = response.text().await.map_err(|e| e.to_string())?;
                    if !body.contains("<svg") {
                        return Err(format!("{} icon response has no SVG element", entry.id));
                    }
                }
            }
            Ok(())
        }
        .await,
    );

    record(
        &mut failures,
        "auth",
        async {
            let path = format!("v1/users/{user_id}/connections");
            for authorization in [None, Some("Bearer ck_invalid")] {
                let mut request = http.get(route(&base, &path));
                if let Some(value) = authorization {
                    request = request.header(header::AUTHORIZATION, value);
                }
                let response = request.send().await.map_err(|e| e.to_string())?;
                if response.status() != StatusCode::UNAUTHORIZED {
                    return Err(format!(
                        "missing or wrong key got {} instead of 401",
                        response.status()
                    ));
                }
            }
            Ok(())
        }
        .await,
    );

    record(
        &mut failures,
        "connections_empty",
        async {
            let connections = client
                .connections(&user_id)
                .await
                .map_err(|e| e.to_string())?;
            if !connections.is_empty() {
                return Err(format!("fresh user has {} connections", connections.len()));
            }
            match client.delete_connection(&user_id, "missing-app").await {
                Err(connect_client::Error::NotConnected) => Ok(()),
                Ok(_) => {
                    Err("deleting missing connection succeeded; expected 404 not_found".into())
                }
                Err(error) => Err(format!("deleting missing connection: {error}")),
            }
        }
        .await,
    );

    record(
        &mut failures,
        "connections_listing",
        async {
            let _summary = client
                .connections_summary()
                .await
                .map_err(|e| e.to_string())?;
            let all = client
                .all_connections(connect_client::wire::ConnectionsQuery {
                    limit: Some(500),
                    cursor: None,
                    app_id: None,
                    status: None,
                })
                .await
                .map_err(|e| e.to_string())?;
            if all.iter().any(|item| item.external_user_id == user_id) {
                return Err("fresh user appeared in customer connections".into());
            }
            let first = client
                .list_connections(connect_client::wire::ConnectionsQuery {
                    limit: Some(1),
                    cursor: None,
                    app_id: None,
                    status: None,
                })
                .await
                .map_err(|e| e.to_string())?;
            let filtered = client
                .list_connections(connect_client::wire::ConnectionsQuery {
                    limit: Some(1),
                    cursor: first.next_cursor,
                    app_id: Some("notion".into()),
                    status: Some(connect_client::wire::ConnectionStatus::Active),
                })
                .await
                .map_err(|e| e.to_string())?;
            if filtered
                .items
                .iter()
                .any(|item| item.external_user_id == user_id)
            {
                return Err("fresh user appeared in filtered connections".into());
            }
            let all_users = client
                .all_users(connect_client::wire::UsersQuery {
                    limit: Some(500),
                    cursor: None,
                    app_id: None,
                    status: None,
                })
                .await
                .map_err(|e| e.to_string())?;
            if all_users
                .iter()
                .any(|item| item.external_user_id == user_id)
            {
                return Err("fresh user appeared in customer users".into());
            }
            let first_users = client
                .list_users(connect_client::wire::UsersQuery {
                    limit: Some(1),
                    cursor: None,
                    app_id: None,
                    status: None,
                })
                .await
                .map_err(|e| e.to_string())?;
            let filtered_users = client
                .list_users(connect_client::wire::UsersQuery {
                    limit: Some(1),
                    cursor: first_users.next_cursor,
                    app_id: Some("notion".into()),
                    status: Some(connect_client::wire::ConnectionStatus::Active),
                })
                .await
                .map_err(|e| e.to_string())?;
            if filtered_users
                .items
                .iter()
                .any(|item| item.external_user_id == user_id)
            {
                return Err("fresh user appeared in filtered users".into());
            }
            Ok(())
        }
        .await,
    );

    record(
        &mut failures,
        "client_metadata",
        async {
            let response = http
                .get(route(&base, "v1/oauth/client-metadata.json"))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if response.status() != StatusCode::OK {
                return Err(format!("expected 200, got {}", response.status()));
            }
            let metadata: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            let client_id = route(&base, "v1/oauth/client-metadata.json").to_string();
            let callback = route(&base, "v1/oauth/callback").to_string();
            if metadata["client_id"] != client_id
                || metadata["redirect_uris"] != serde_json::json!([callback])
            {
                return Err("client_id or redirect_uris do not use base URL".into());
            }
            if metadata["response_types"] != serde_json::json!(["code"])
                || metadata["token_endpoint_auth_method"] != "none"
            {
                return Err("OAuth client metadata is incomplete".into());
            }
            Ok(())
        }
        .await,
    );

    record(
        &mut failures,
        "session_rules",
        async {
            for (app_id, redirect_url, status, code) in [
                (
                    live.first().ok_or("registry has no live apps")?.id.as_str(),
                    "https://outside.example/callback",
                    StatusCode::BAD_REQUEST,
                    "redirect_origin_not_allowed",
                ),
                (
                    "unknown-app",
                    redirect_url.as_str(),
                    StatusCode::BAD_REQUEST,
                    "app_not_live",
                ),
            ] {
                let response = http
                    .post(route(&base, "v1/connect-sessions"))
                    .bearer_auth(customer_key.as_str())
                    .json(&ConnectSessionRequest {
                        external_user_id: user_id.clone(),
                        app_id: app_id.to_owned(),
                        redirect_url: redirect_url.to_owned(),
                    })
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let actual_status = response.status();
                let body: ErrorResponse = response.json().await.map_err(|e| e.to_string())?;
                if actual_status != status || body.error != code {
                    return Err(format!(
                        "{app_id}: expected {status} {code}, got {actual_status} {}",
                        body.error
                    ));
                }
            }
            Ok(())
        }
        .await,
    );

    for app in live.iter().filter(|app| {
        base.scheme() == "https" || app.client_registration == ClientRegistration::Cimd
    }) {
        let name = format!("authorize_{}", app.id);
        record(
            &mut failures,
            &name,
            async {
                let session = client
                    .create_connect_session(&user_id, app.id.as_str(), &redirect_url)
                    .await
                    .map_err(|e| e.to_string())?;
                let connect_url = Url::parse(&session.connect_url).map_err(|e| e.to_string())?;
                if connect_url.origin() != base.origin()
                    || !connect_url.path().starts_with("/v1/connect/")
                {
                    return Err("connect_url does not point to this Connect host".into());
                }
                let response = http
                    .get(connect_url)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if response.status() != StatusCode::SEE_OTHER {
                    return Err(format!("expected 303, got {}", response.status()));
                }
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .ok_or("missing Location")?
                    .to_str()
                    .map_err(|e| e.to_string())?;
                let authorization = Url::parse(location).map_err(|e| e.to_string())?;
                let manager = AuthorizationManager::new(&app.mcp_url)
                    .await
                    .map_err(|e| e.to_string())?;
                let metadata = manager
                    .discover_metadata()
                    .await
                    .map_err(|e| e.to_string())?;
                let expected_endpoint =
                    Url::parse(&metadata.authorization_endpoint).map_err(|e| e.to_string())?;
                if authorization.origin() != expected_endpoint.origin()
                    || authorization.path() != expected_endpoint.path()
                {
                    return Err("redirect does not target vendor authorization endpoint".into());
                }
                let callback = route(&base, "v1/oauth/callback");
                for (key, expected) in [
                    ("response_type", "code"),
                    ("code_challenge_method", "S256"),
                    ("redirect_uri", callback.as_str()),
                ] {
                    if query_value(&authorization, key).as_deref() != Some(expected) {
                        return Err(format!("missing or incorrect {key}"));
                    }
                }
                let challenge = query_value(&authorization, "code_challenge")
                    .ok_or("missing code_challenge")?;
                if challenge.len() != 43
                    || !challenge
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                {
                    return Err("invalid PKCE S256 challenge".into());
                }
                if query_value(&authorization, "state").is_none_or(|value| value.is_empty()) {
                    return Err("missing state".into());
                }
                let client_id =
                    query_value(&authorization, "client_id").ok_or("missing client_id")?;
                match app.client_registration {
                    ClientRegistration::Cimd => {
                        if client_id != route(&base, "v1/oauth/client-metadata.json").as_str() {
                            return Err("CIMD client_id does not match Connect metadata URL".into());
                        }
                    }
                    ClientRegistration::Dcr | ClientRegistration::OwnApp => {}
                    ClientRegistration::ApiKey => {
                        return Err("API-key app has no OAuth client".into());
                    }
                }
                if args.follow_vendor {
                    let vendor_response = http
                        .get(authorization)
                        .send()
                        .await
                        .map_err(|e| e.to_string())?;
                    if !vendor_response.status().is_success()
                        && !vendor_response.status().is_redirection()
                    {
                        return Err(format!(
                            "vendor returned OAuth error status {}",
                            vendor_response.status()
                        ));
                    }
                    if let Some(location) = vendor_response.headers().get(header::LOCATION) {
                        let location = location.to_str().map_err(|e| e.to_string())?;
                        let url = vendor_response
                            .url()
                            .join(location)
                            .map_err(|e| e.to_string())?;
                        if query_value(&url, "error").is_some() {
                            return Err("vendor redirect contains OAuth error".into());
                        }
                    }
                    if query_value(vendor_response.url(), "error").is_some() {
                        return Err("vendor response contains OAuth error".into());
                    }
                }
                Ok(())
            }
            .await,
        );
    }

    record(
        &mut failures,
        "gateway_unconnected",
        async {
            let app_id = live.first().ok_or("registry has no live apps")?.id.as_str();
            let upstream = client.mcp_upstream(&user_id, app_id);
            let response = http
                .get(upstream.url.clone())
                .bearer_auth(&upstream.bearer_token)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = response.status();
            let body: McpErrorResponse = response.json().await.map_err(|e| e.to_string())?;
            if status != StatusCode::NOT_FOUND || body.error != "not_found" || body.app_id != app_id
            {
                return Err(format!(
                    "expected 404 not_found for {app_id}, got {status} {}",
                    body.error
                ));
            }
            Ok(())
        }
        .await,
    );

    if failures == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

async fn run_acceptance(
    client: &ConnectClient,
    http: &Client,
    base: &Url,
    public_url: &Url,
    user_id: &str,
    redirect_url: &str,
    apps: &[&connect_registry::App],
) -> ExitCode {
    let mut failures = 0;
    let mut rows = Vec::with_capacity(apps.len());
    for app in apps {
        let result = async {
            let session = client
                .create_connect_session(user_id, app.id.as_str(), redirect_url)
                .await
                .map_err(|error| format!("connect session: {error}"))?;
            let connect_url =
                Url::parse(&session.connect_url).map_err(|error| error.to_string())?;
            if connect_url.origin() != public_url.origin()
                || !connect_url.path().starts_with("/v1/connect/")
            {
                return Err("connect session returned an unexpected URL".to_owned());
            }
            let local_connect_url = base
                .join(connect_url.path())
                .map_err(|error| error.to_string())?;
            let connect_response = http
                .get(local_connect_url)
                .send()
                .await
                .map_err(|error| error.to_string())?;
            if connect_response.status() != StatusCode::SEE_OTHER {
                let status = connect_response.status();
                let body = response_body(connect_response).await?;
                return Err(format!(
                    "Connect returned {status}: {}",
                    response_excerpt(&body)
                ));
            }
            let location = connect_response
                .headers()
                .get(header::LOCATION)
                .ok_or("Connect response has no Location")?
                .to_str()
                .map_err(|error| error.to_string())?;
            let authorization = Url::parse(location).map_err(|error| error.to_string())?;
            if query_value(&authorization, "error").is_some() {
                return Err("vendor authorization URL contains OAuth error".to_owned());
            }
            let mut next = authorization;
            for _ in 0..5 {
                let vendor_response = http
                    .get(next)
                    .send()
                    .await
                    .map_err(|error| error.to_string())?;
                let status = vendor_response.status();
                if status.is_redirection() {
                    let location = vendor_response
                        .headers()
                        .get(header::LOCATION)
                        .ok_or("vendor redirect has no Location")?
                        .to_str()
                        .map_err(|error| error.to_string())?;
                    let target = vendor_response
                        .url()
                        .join(location)
                        .map_err(|error| error.to_string())?;
                    if query_value(&target, "error").is_some() {
                        return Err(format!(
                            "vendor redirected with OAuth error to {}",
                            target.path()
                        ));
                    }
                    if is_login_redirect(&target) {
                        return Ok(format!(
                            "{status} login redirect to {}",
                            target.host_str().unwrap_or_default()
                        ));
                    }
                    next = target;
                    continue;
                }
                let is_html = vendor_response
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .is_some_and(|value| {
                        value
                            .to_str()
                            .is_ok_and(|value| value.starts_with("text/html"))
                    });
                let body = response_body(vendor_response).await?;
                if !status.is_success() || oauth_error_in_body(&body) {
                    return Err(format!(
                        "vendor returned {status}: {}",
                        response_excerpt(&body)
                    ));
                }
                if !is_html {
                    return Err(format!(
                        "vendor returned {status} without an HTML sign-in page: {}",
                        response_excerpt(&body)
                    ));
                }
                return Ok(format!("{status} sign-in or consent page"));
            }
            Err("vendor redirected more than five times without a sign-in page".to_owned())
        }
        .await;
        match result {
            Ok(note) => rows.push((app.id.as_str(), "PASS", note)),
            Err(note) => {
                failures += 1;
                rows.push((app.id.as_str(), "FAIL", note));
            }
        }
    }
    println!("app | result | response");
    println!("--- | --- | ---");
    for (app, result, note) in rows {
        println!("{app} | {result} | {}", note.replace('|', "\\|"));
    }
    if failures == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn is_login_redirect(target: &Url) -> bool {
    let path = target.path().to_ascii_lowercase();
    if ["error", "invalid", "denied"]
        .iter()
        .any(|part| path.contains(part))
    {
        return false;
    }
    [
        "login",
        "signin",
        "sign-in",
        "sign_in",
        "consent",
        "chooselocation",
    ]
    .iter()
    .any(|part| path.contains(part))
}

fn oauth_error_in_body(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    lower.contains("invalid_client") || lower.contains("invalid_redirect_uri")
}

async fn response_body(response: reqwest::Response) -> Result<String, String> {
    response.text().await.map_err(|error| error.to_string())
}

fn response_excerpt(body: &str) -> String {
    body.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}
