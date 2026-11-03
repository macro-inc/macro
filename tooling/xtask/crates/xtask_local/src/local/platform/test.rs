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
fn infra_tier_selects_infra_and_its_storage() {
    let list = json!({ "items": [
        { "kind": "Deployment", "metadata": { "name": "postgres", "labels": { "macro.com/tier": "infra" } } },
        { "kind": "Deployment", "metadata": { "name": "email-service", "labels": { "macro.com/tier": "app" } } },
        { "kind": "PersistentVolumeClaim", "metadata": { "name": "postgres-data" } },
    ]});
    let names: Vec<_> = items_with_tier(&list, "infra")
        .into_iter()
        .map(|i| i["metadata"]["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["postgres", "postgres-data"]);
}
