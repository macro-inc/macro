use super::*;
use crate::local::Mode;
use crate::local::instance::{Instance, Port};

/// The merged env a `--no-doppler` stack sees: boot stubs below, the
/// authoritative local env on top (mirrors `env_layer::resolve`).
fn local_env() -> BTreeMap<String, String> {
    let instance = Instance::derive(None, None).expect("default instance derives");
    let local = LocalEnv::for_instance(Mode::Local, &instance, true, None);
    let mut env = local.boot_stub_env();
    env.extend(local.to_env());
    env
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
        "MCP_PUBLIC_URL",
        "JWT_SECRET_KEY",
        // Boot-blocking stubs — service config loaders require these even in a
        // no-doppler stack (see `BootStubEnv`).
        "REDIS_HOST",
        "MACRO_DB_URL",
        "INTERNAL_API_KEY",
        "AUTHENTICATION_SERVICE_SECRET_KEY",
        "OPENSEARCH_USERNAME",
        "OPENSEARCH_PASSWORD",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET_KEY",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "GITHUB_IDP_ID",
        "STRIPE_SECRET_KEY",
        "STRIPE_PRICE_ID",
        "STRIPE_WEBHOOK_SECRET_KEY",
        "MACRO_API_TOKEN_ISSUER",
        "MACRO_API_TOKEN_PUBLIC_KEY",
        "MACRO_API_TOKEN_PRIVATE_SECRET_KEY",
        "MACRO_API_TOKEN_EXPIRY_SECONDS",
        "GMAIL_GCP_QUEUE",
        "APOLLO_API_KEY",
        "EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL",
        "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY",
        "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID",
        "APPLE_BUNDLE_ID",
        "SNS_APNS_PLATFORM_ARN",
        "SNS_FCM_PLATFORM_ARN",
        "MCP_CREDENTIALS_KEY_SECRET_NAME",
        "ANTHROPIC_API_KEY",
        "SLACK_MCP_CLIENT_ID",
        "SLACK_MCP_CLIENT_SECRET",
        "GITHUB_SYNC_APP_URL",
        "GITHUB_SYNC_APP_CLIENT_ID",
        "GITHUB_SYNC_APP_CLIENT_SECRET",
        "GITHUB_INSTALLATION_STATE_SECRET",
        "GITHUB_WEBHOOK_SECRET_KEY",
        "GITHUB_SYNC_APP_PEM_SECRET_KEY",
        "LIVEKIT_SERVER_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "OPENAI_API_KEY",
        "COHERE_API_KEY",
        "CAL_WEBHOOK_SECRET_KEY",
        "CAL_EVENT_TYPE_CONTENT_NAMES_KEY",
        "META_PIXEL_ID",
        "META_ACCESS_TOKEN",
        "DEV_DANGEROUS_LOCAL_CONTAINERS",
        "LOCAL_CONTAINER_IMAGE",
        "LOCAL_CONTAINER_NETWORK",
        "DAYTONA_API_KEY",
        "HARNESS_BOT_ID",
    ] {
        assert!(
            env.contains_key(key),
            "missing required local env key: {key}"
        );
    }
}

/// Boot stubs are a fallback layer BELOW Doppler; `to_env` is authoritative
/// ABOVE Doppler. A key present in both would make its precedence ambiguous —
/// whichever map wrote last would silently win.
#[test]
fn boot_stubs_do_not_overlap_authoritative_env() {
    let instance = Instance::derive(None, None).expect("default instance derives");
    let local = LocalEnv::for_instance(Mode::Local, &instance, true, None);
    let authoritative = local.to_env();
    for key in local.boot_stub_env().keys() {
        assert!(
            !authoritative.contains_key(key),
            "{key} is in both boot_stub_env and to_env"
        );
    }
}

/// The boot stubs must be local-only values: the same in-network endpoints the
/// rest of the env uses, dummy creds, and never a real secret or deployed URL.
#[test]
fn boot_stubs_are_local_only() {
    let env = local_env();
    assert_eq!(
        env.get("REDIS_HOST").map(String::as_str),
        Some("redis://redis:6379")
    );
    assert_eq!(
        env.get("MACRO_DB_URL").map(String::as_str),
        Some("postgres://user:password@postgres:5432/macrodb")
    );
    // INTERNAL_API_KEY must agree with the internal-auth key other services
    // validate against, or every internal call 401s.
    assert_eq!(
        env.get("INTERNAL_API_KEY"),
        env.get("INTERNAL_API_SECRET_KEY"),
        "INTERNAL_API_KEY must match INTERNAL_API_SECRET_KEY"
    );
    assert_eq!(
        env.get("AUTHENTICATION_SERVICE_SECRET_KEY"),
        env.get("INTERNAL_API_SECRET_KEY"),
        "AUTHENTICATION_SERVICE_SECRET_KEY must match INTERNAL_API_SECRET_KEY"
    );
    assert_eq!(
        env.get("OPENSEARCH_USERNAME").map(String::as_str),
        Some("macrouser")
    );
}

#[test]
fn internal_auth_values_are_authoritative_local_env() {
    let env = LocalEnv::for_instance(
        Mode::Local,
        &Instance::derive(None, None).unwrap(),
        true,
        None,
    )
    .to_env();
    let expected = env.get("INTERNAL_API_SECRET_KEY");

    assert_eq!(env.get("INTERNAL_API_KEY"), expected);
    assert_eq!(env.get("INTERNAL_AUTH_KEY"), expected);
    assert_eq!(env.get("AUTHENTICATION_SERVICE_SECRET_KEY"), expected);
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

/// In-network callers must resolve these through the docker alias. The
/// `Environment::Local` defaults are host port mappings, which inside a
/// container point back at the caller itself.
#[test]
fn emits_in_network_service_url_overrides() {
    let env = local_env();
    for (key, expected) in [
        (
            "OVERRIDE_CONNECTION_GATEWAY_URL",
            "http://connection-gateway:8080",
        ),
        (
            "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
            "http://document-storage-service:8080",
        ),
        (
            "OVERRIDE_LEXICAL_SERVICE_URL",
            "http://lexical-service:8096",
        ),
    ] {
        assert_eq!(env.get(key).map(String::as_str), Some(expected));
    }
}

/// The auth service presents `SERVICE_INTERNAL_AUTH_KEY` to document storage,
/// which validates against `DOCUMENT_STORAGE_SERVICE_AUTH_KEY`. Dev/prod point
/// both at one secret; locally they must match too or every auth-service
/// internal call (starter docs seeding at signup) is a 401.
#[test]
fn auth_service_internal_key_matches_dss_auth_key() {
    let env = local_env();
    assert_eq!(
        env.get("SERVICE_INTERNAL_AUTH_KEY"),
        env.get("DOCUMENT_STORAGE_SERVICE_AUTH_KEY"),
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
    let a = LocalEnv::for_instance(Mode::Local, &default, true, None).to_env();
    let b = LocalEnv::for_instance(Mode::Local, &agent_a, true, None).to_env();

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
    let default_env = LocalEnv::for_instance(Mode::Local, &default, true, None).to_env();
    let named_env = LocalEnv::for_instance(Mode::Local, &named, true, None).to_env();
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

/// A local stack runs sandboxes on the developer's own daemon, so it needs no
/// Daytona account to exercise the sandbox path.
#[test]
fn the_agent_harness_uses_local_containers_and_wipes_daytona() {
    let env = local_env();

    assert_eq!(
        env.get("DEV_DANGEROUS_LOCAL_CONTAINERS")
            .map(String::as_str),
        Some("true")
    );
    assert_eq!(env.get("DAYTONA_API_KEY").map(String::as_str), Some(""));
    // No `GITHUB_TOKEN`: the sandbox clones through the egress proxy, which
    // holds the credential on its behalf.
    assert!(!env.contains_key("GITHUB_TOKEN"));
    // No `CURSOR_API_KEY`: `@cursor` sessions run on the key each user
    // registers in settings, so there is no deployment-wide one to stub.
    assert!(!env.contains_key("CURSOR_API_KEY"));
}

/// Sandboxes and the harness are both containers, so they reach each other on a
/// shared Compose network and never over the host's loopback. The network name
/// has to track the instance, or a named stack's sandboxes join the wrong one.
#[test]
fn local_sandboxes_join_the_instances_compose_network() {
    let named = Instance::derive(Some("2508"), None).unwrap();
    let default_env = LocalEnv::for_instance(
        Mode::Local,
        &Instance::derive(None, None).unwrap(),
        true,
        None,
    )
    .to_env();
    let named_env = LocalEnv::for_instance(Mode::Local, &named, true, None).to_env();

    assert_eq!(
        default_env
            .get("LOCAL_CONTAINER_NETWORK")
            .map(String::as_str),
        Some("macro_services")
    );
    assert_eq!(
        named_env.get("LOCAL_CONTAINER_NETWORK").map(String::as_str),
        Some(format!("{}_services", named.project_name()).as_str())
    );
    assert_eq!(
        default_env.get("LOCAL_CONTAINER_IMAGE").map(String::as_str),
        Some("macro-agent-harness:latest")
    );
}

#[test]
fn mcp_public_url_uses_the_proxy_cognition_route() {
    let default = Instance::derive(None, None).unwrap();
    let named = Instance::derive(Some("2508"), None).unwrap();
    let default_env = LocalEnv::for_instance(Mode::Local, &default, true, None).to_env();
    let named_env = LocalEnv::for_instance(Mode::Local, &named, true, None).to_env();
    let named_public_url = format!("http://localhost:{}/cognition", named.port(Port::Proxy));

    assert_eq!(
        default_env.get("MCP_PUBLIC_URL").map(String::as_str),
        Some("http://localhost:8090/cognition")
    );
    assert_eq!(
        named_env.get("MCP_PUBLIC_URL").map(String::as_str),
        Some(named_public_url.as_str())
    );
}

/// In-network address, not localhost: a sandbox's localhost is its own. The
/// host is hyphenated because a sandbox's git percent-encodes `_` before
/// matching `credential.<url>.helper`, so the compose service name would leave
/// the scoped helper silently unfired.
#[test]
fn the_egress_base_url_is_the_hyphenated_in_network_alias() {
    let named = Instance::derive(Some("2508"), None).unwrap();
    let named_env = LocalEnv::for_instance(Mode::Local, &named, true, None).to_env();

    assert_eq!(
        named_env.get("EGRESS_BASE_URL").map(String::as_str),
        Some("http://agent-harness-service:8102")
    );
}
