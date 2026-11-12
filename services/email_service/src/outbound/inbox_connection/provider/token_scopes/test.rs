use super::*;
use axum::{Form, Json, Router, routing::post};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

const ACCESS_TOKEN: &str = "emulator-access-token";
const SCOPES: &str =
    "openid https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar";
/// Set only on the child process the override test starts.
const PROBE_TOKEN_VAR: &str = "TOKEN_SCOPES_PROBE_ACCESS_TOKEN";
const SCOPES_LINE: &str = "token scopes: ";

/// The scope discovery `/email/init` runs, with the token-info URL resolved
/// from this process's environment as startup resolves it. It does nothing
/// unless `override_sends_scope_discovery_to_a_local_server` started it.
#[tokio::test]
async fn token_scopes_probe_process() {
    let Some(access_token) = std::env::var_os(PROBE_TOKEN_VAR) else {
        return;
    };
    let token_info_url = GoogleOauthTokenInfoUrl::new().unwrap();
    let scopes = fetch_token_scopes(&token_info_url, access_token.to_str().unwrap())
        .await
        .unwrap();
    println!("{SCOPES_LINE}{}", scopes.join(" "));
}

#[tokio::test]
async fn override_sends_scope_discovery_to_a_local_server() {
    let received: Arc<Mutex<Vec<HashMap<String, String>>>> = Arc::default();
    let app = Router::new().route(
        "/oauth2/v3/tokeninfo",
        post({
            let received = received.clone();
            move |Form(form): Form<HashMap<String, String>>| async move {
                received.lock().unwrap().push(form);
                Json(serde_json::json!({ "scope": SCOPES }))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let token_info_url = format!(
        "http://{}/oauth2/v3/tokeninfo",
        listener.local_addr().unwrap()
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await });

    // A separate process, so the override is a real environment variable
    // without changing this test process's environment.
    let probe = format!(
        "{}::token_scopes_probe_process",
        module_path!()
            .strip_prefix(concat!(env!("CARGO_CRATE_NAME"), "::"))
            .unwrap()
    );
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", probe.as_str(), "--nocapture"])
            .env_clear()
            // Keep only the dynamic loader's search paths; the parent's
            // configuration, credentials and proxies stay out.
            .envs(
                [
                    "LD_LIBRARY_PATH",
                    "NIX_LD",
                    "NIX_LD_LIBRARY_PATH",
                    "DYLD_LIBRARY_PATH",
                    "DYLD_FALLBACK_LIBRARY_PATH",
                ]
                .into_iter()
                .filter_map(|key| std::env::var_os(key).map(|value| (key, value))),
            )
            .env(
                GoogleOauthTokenInfoUrl::OVERRIDE_ENV_VAR_NAME,
                token_info_url,
            )
            .env(PROBE_TOKEN_VAR, ACCESS_TOKEN)
            .output()
            .unwrap()
    })
    .await
    .unwrap();
    server.abort();

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let scopes = stdout
        .lines()
        .find_map(|line| line.strip_prefix(SCOPES_LINE))
        .unwrap_or_else(|| panic!("the probe test did not run:\n{stdout}"));
    assert_eq!(scopes, SCOPES);
    assert_eq!(
        *received.lock().unwrap(),
        [HashMap::from([(
            "access_token".to_owned(),
            ACCESS_TOKEN.to_owned()
        )])]
    );
}
