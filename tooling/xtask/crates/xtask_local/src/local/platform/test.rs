use std::collections::BTreeMap;

use serde_json::json;

use super::*;

#[test]
fn instance_names_are_dns_labels() {
    for ok in ["demo", "pr-1234", "a"] {
        assert!(InstanceName::parse(ok).is_ok(), "{ok}");
    }
    for bad in ["", "Demo", "-x", "x-", "a_b", &"x".repeat(31)] {
        assert!(InstanceName::parse(bad).is_err(), "{bad}");
    }
    let n = InstanceName::parse("demo").unwrap();
    assert_eq!(n.namespace(), "macro-demo");
    assert_eq!(n.origin(), "https://demo.localhost:9443");
}

#[test]
fn the_checked_in_caddyfile_is_current() {
    let on_disk = std::fs::read_to_string(repo_root().join(CADDYFILE)).unwrap();
    assert_eq!(on_disk, caddyfile(), "run `cargo x platform caddyfile`");
}

#[test]
fn the_edge_serves_the_bundle_from_its_store_path() {
    let c = caddyfile();
    assert!(c.contains("root * {$MACRO_FRONTEND}"));
    assert!(c.contains(":8080 {"));
    assert!(
        !c.contains("agent_harness_service"),
        "upstreams use Service names"
    );
}

#[test]
fn rust_workloads_use_service_names() {
    let w = rust_workloads();
    assert_eq!(w["authentication-service"], "authentication_service");
    assert_eq!(w["email-pubsub-workers"], "pubsub_workers");
    assert!(!w.contains_key("slack_import_worker"));
}

#[test]
fn origin_rewrites_cover_auth_and_proxy() {
    let instance = InstanceName::parse("demo")
        .unwrap()
        .local_instance()
        .unwrap();
    let r = origin_rewrites(&instance, "https://demo.localhost:9443").unwrap();
    let auth = format!(
        "http://localhost:{}/oauth/redirect",
        instance.port(Port::Auth)
    );
    assert_eq!(
        rewrite(&auth, &r),
        "https://demo.localhost:9443/auth/oauth/redirect"
    );
    assert!(r.windows(2).all(|w| w[0].0.len() >= w[1].0.len()));
}

#[test]
fn generated_credentials_replace_every_development_value() {
    let credentials = Credentials::generate().unwrap();
    assert_ne!(credentials, Credentials::generate().unwrap());
    let mut env = BTreeMap::from([
        (
            "DATABASE_URL".to_owned(),
            "postgres://user:password@postgres:5432/macrodb".to_owned(),
        ),
        ("INTERNAL_API_SECRET_KEY".to_owned(), "local".to_owned()),
        ("FUSIONAUTH_API_KEY".to_owned(), "fixed".to_owned()),
        ("APOLLO_API_KEY".to_owned(), "local".to_owned()),
        ("SOME_URL".to_owned(), "http://a:password@b".to_owned()),
    ]);
    credentials.apply_to_env(&mut env);
    assert_eq!(
        env["DATABASE_URL"],
        format!(
            "postgres://user:{}@postgres:5432/macrodb",
            credentials.postgres
        )
    );
    assert_eq!(env["INTERNAL_API_SECRET_KEY"], credentials.internal);
    assert_eq!(env["FUSIONAUTH_API_KEY"], credentials.fusionauth_api_key);
    assert_eq!(env["PLATFORM_POSTGRES_PASSWORD"], credentials.postgres);
    // Not ours to change: a third party's value, and a URL that is not a database's.
    assert_eq!(env["APOLLO_API_KEY"], "local");
    assert_eq!(env["SOME_URL"], "http://a:password@b");

    let kickstart: serde_json::Value = serde_json::from_str(
        &credentials
            .apply_to_kickstart(
                &json!({
                    "apiKey": identity::FUSIONAUTH_API_KEY,
                    "clientSecret": identity::CLIENT_SECRET,
                    "jwt": identity::JWT_SECRET,
                    "admin": DEVELOPMENT_FUSIONAUTH_ADMIN,
                    "requests": [{ "headers": { "x-internal-auth-key": "local" } }],
                    "unrelated": "local",
                })
                .to_string(),
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(kickstart["apiKey"], credentials.fusionauth_api_key.as_str());
    assert_eq!(
        kickstart["clientSecret"],
        credentials.fusionauth_client_secret.as_str()
    );
    assert_eq!(kickstart["jwt"], credentials.jwt.as_str());
    assert_eq!(kickstart["admin"], credentials.fusionauth_admin.as_str());
    assert_eq!(
        kickstart["requests"][0]["headers"]["x-internal-auth-key"],
        credentials.internal.as_str()
    );
    assert_eq!(kickstart["unrelated"], "local");
}

#[test]
fn an_existing_instance_keeps_its_development_credentials() {
    let credentials = Credentials::development();
    let mut env = BTreeMap::from([(
        "DATABASE_URL".to_owned(),
        "postgres://user:password@postgres:5432/macrodb".to_owned(),
    )]);
    credentials.apply_to_env(&mut env);
    assert_eq!(
        env["DATABASE_URL"],
        "postgres://user:password@postgres:5432/macrodb"
    );
    assert_eq!(env["PLATFORM_POSTGRES_PASSWORD"], "password");
    assert_eq!(env["PLATFORM_FUSIONAUTH_DB_ROOT_PASSWORD"], "postgres");
}

#[test]
fn an_application_converges_only_on_the_published_revision_when_healthy() {
    let app = |revision: &str, sync: &str, health: &str| {
        json!({ "status": {
            "sync": { "revision": revision, "status": sync },
            "health": { "status": health },
        }})
    };
    assert!(gitops::is_converged(
        &app("abc", "Synced", "Healthy"),
        "abc"
    ));
    assert!(!gitops::is_converged(
        &app("old", "Synced", "Healthy"),
        "abc"
    ));
    assert!(!gitops::is_converged(
        &app("abc", "OutOfSync", "Healthy"),
        "abc"
    ));
    assert!(!gitops::is_converged(
        &app("abc", "Synced", "Progressing"),
        "abc"
    ));
}

#[test]
fn unhealthy_resources_names_what_an_application_waits_on() {
    let app = json!({ "status": { "resources": [
        { "kind": "Deployment", "name": "postgres", "status": "Synced", "health": { "status": "Healthy" } },
        { "kind": "Deployment", "name": "email-service", "status": "Synced", "health": { "status": "Progressing" } },
        { "kind": "Service", "name": "edge", "status": "OutOfSync" },
    ]}});
    assert_eq!(
        gitops::unhealthy_resources(&app),
        [
            "Deployment/email-service: Synced Progressing",
            "Service/edge: OutOfSync -",
        ]
    );
}

#[test]
fn sync_config_carries_the_compose_bindings_and_keys() {
    let c = sync_wrangler_config("internal", "jwt", "dss");
    assert_eq!(c["main"], "build/worker/shim.mjs");
    assert!(c.get("no_bundle").is_none(), "celld must bundle the shim");
    assert_eq!(c["vars"]["INTERNAL_API_SECRET_KEY"], "LOCAL_API_KEY");
    assert_eq!(c["vars"]["LOCAL_API_KEY"], "internal");
    assert_eq!(c["vars"]["DOCUMENT_PERMISSIONS_SECRET"], "jwt");
    assert_eq!(c["vars"]["DSS_INTERNAL_AUTH_KEY"], "dss");
    // Service names, not compose names, resolve in the cluster.
    assert_eq!(c["vars"]["DSS_URL"], "http://document-storage-service:8080");
    let kv: Vec<_> = c["kv_namespaces"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k["binding"].clone())
        .collect();
    assert_eq!(kv, ["DOCUMENT_VERSIONING_KV", "SNAPSHOT_STORE_KV"]);
}

#[test]
fn generated_aws_keys_have_the_shape_extenddb_requires() {
    let (id, secret) = generate_aws_key().unwrap();
    assert_eq!(id.len(), 20);
    assert!(id.starts_with("AKIA"));
    assert_eq!(secret.len(), 40);
    assert_ne!(generate_aws_key().unwrap().0, id);
}

#[test]
fn bare_queue_names_become_queue_urls() {
    let env = BTreeMap::from([
        (
            "DOCUMENT_DELETE_QUEUE".to_owned(),
            "delete-document-handler-queue".to_owned(),
        ),
        (
            "NOTIFICATION_QUEUE".to_owned(),
            "http://localstack:4566/000000000000/n".to_owned(),
        ),
        (
            "GMAIL_GCP_QUEUE".to_owned(),
            "projects/p/topics/t".to_owned(),
        ),
        ("ENABLE_GMAIL_OPS_QUEUE".to_owned(), "true".to_owned()),
    ]);
    let out = queue_urls(env);
    assert_eq!(
        out["DOCUMENT_DELETE_QUEUE"],
        "http://localstack:4566/000000000000/delete-document-handler-queue"
    );
    assert_eq!(
        out["NOTIFICATION_QUEUE"],
        "http://localstack:4566/000000000000/n"
    );
    assert_eq!(out["GMAIL_GCP_QUEUE"], "projects/p/topics/t");
    assert_eq!(out["ENABLE_GMAIL_OPS_QUEUE"], "true");
}
