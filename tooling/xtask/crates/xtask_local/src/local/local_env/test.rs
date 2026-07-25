use super::*;
use crate::local::Mode;
use crate::local::instance::{Instance, Port};

fn local_env() -> BTreeMap<String, String> {
    let instance = Instance::derive(None, None).expect("default instance derives");
    LocalEnv::for_instance(Mode::Local, &instance).to_env()
}

/// Every key a local service relies on must be present — this is the test that
/// replaces "someone remembers to update defaults.env".
#[test]
fn emits_required_keys() {
    let env = local_env();
    for key in [
        "ENVIRONMENT",
        "PORT",
        "BASE_URL",
        "DATABASE_URL",
        "DATABASE_URL_READONLY",
        "REDIS_URI",
        "OPENSEARCH_URL",
        "LOCAL_AWS_URL",
        "AWS_ACCESS_KEY_ID",
        "STATIC_STORAGE_BUCKET",
        "CONNECTION_GATEWAY_TABLE",
        "NOTIFICATION_INGRESS_QUEUE",
        "SMTP_HOST",
        "INTERNAL_API_SECRET_KEY",
        "FUSIONAUTH_API_KEY_SECRET_KEY",
        "FUSIONAUTH_PUBLIC_URL",
        "FUSIONAUTH_OAUTH_REDIRECT_URI",
        "JWT_SECRET_KEY",
    ] {
        assert!(
            env.contains_key(key),
            "missing required local env key: {key}"
        );
    }
}

/// Local must never point at real dev/prod infrastructure: endpoints are docker
/// aliases / localhost, and creds are the LocalStack dummies. (Note `ISSUER` is
/// the local `local.macro.com` JWT issuer — a value, not an endpoint — so we
/// match the *deployed* markers specifically, not a bare `.macro.com`.)
#[test]
fn values_are_local_only() {
    for (key, value) in local_env() {
        for marker in ["amazonaws.com", "-dev.macro.com", ".workers.dev"] {
            assert!(
                !value.contains(marker),
                "{key} points at deployed infra ({marker}): {value}"
            );
        }
    }
}

#[test]
fn emits_webhook_fifo_queue_override_url() {
    let env = local_env();
    assert_eq!(
        env.get(macro_queues::WebhookEventQueue::OVERRIDE_ENV_VAR_NAME)
            .map(String::as_str),
        Some("http://localstack:4566/000000000000/webhook-event-queue.fifo")
    );
}

#[test]
fn aws_creds_are_dummy() {
    let env = local_env();
    assert_eq!(
        env.get("AWS_ACCESS_KEY_ID").map(String::as_str),
        Some("test")
    );
    assert_eq!(
        env.get("AWS_SECRET_ACCESS_KEY").map(String::as_str),
        Some("test")
    );
}

/// Per-instance internal secrets must differ between instances (deterministic
/// but instance-scoped), while the fixed FusionAuth identity stays constant.
#[test]
fn instance_secrets_are_scoped_but_identity_is_fixed() {
    let default = Instance::derive(None, None).unwrap();
    let agent_a = Instance::derive(Some("agent-a"), None).unwrap();
    let a = LocalEnv::for_instance(Mode::Local, &default).to_env();
    let b = LocalEnv::for_instance(Mode::Local, &agent_a).to_env();

    assert_ne!(
        a.get("SERVICE_INTERNAL_AUTH_KEY"),
        b.get("SERVICE_INTERNAL_AUTH_KEY"),
        "per-instance secrets should differ between instances"
    );
    assert_eq!(
        a.get("FUSIONAUTH_API_KEY_SECRET_KEY"),
        b.get("FUSIONAUTH_API_KEY_SECRET_KEY"),
        "the fixed FusionAuth identity should be constant across instances"
    );
}

#[test]
fn fusionauth_public_url_uses_the_instance_host_port() {
    let default = Instance::derive(None, None).unwrap();
    let named = Instance::derive(Some("2508"), None).unwrap();
    let default_env = LocalEnv::for_instance(Mode::Local, &default).to_env();
    let named_env = LocalEnv::for_instance(Mode::Local, &named).to_env();
    let named_public_url = format!("http://localhost:{}", named.port(Port::FusionAuth));

    assert_eq!(
        default_env.get("FUSIONAUTH_PUBLIC_URL").map(String::as_str),
        Some("http://localhost:9011")
    );
    assert_eq!(
        named_env.get("FUSIONAUTH_PUBLIC_URL").map(String::as_str),
        Some(named_public_url.as_str())
    );
}
