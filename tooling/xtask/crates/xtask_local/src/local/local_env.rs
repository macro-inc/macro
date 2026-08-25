//! The typed, code-owned local-stack environment — the replacement for the
//! checked-in `infra/local/defaults.env`.
//!
//! Every value here is deterministic and local-only — docker-network hostnames,
//! LocalStack dummy creds, fixed queue/bucket names, the fixed FusionAuth
//! kickstart identity, and per-instance internal secrets. Anything that needs a
//! *real* secret or a real integration (Gmail, Stripe, …) comes from Doppler or
//! `--env-file`; [`BootStubEnv`] only supplies placeholder fallbacks so a
//! `--no-doppler` stack's config loaders don't crash at startup.
//!
//! [`LocalEnv::for_instance`] builds the struct. Two boundaries flatten it to
//! env maps: [`LocalEnv::to_env`] (authoritative, layered above Doppler) and
//! [`LocalEnv::boot_stub_env`] (fallback, layered below Doppler). Grouping makes
//! additions land in a named, testable place instead of a free-form dotenv file
//! that quietly rots.

use std::collections::BTreeMap;

use super::instance::{Instance, Port};
use super::{Mode, identity, resources};

/// The full local environment for one instance.
pub struct LocalEnv {
    environment: &'static str,
    project_name: String,
    /// Where the browser-facing app lives: the proxy (static bundle at
    /// `/app`) or the bun dev server. `default_redirect_url()` in
    /// authentication_service sends post-login browsers to
    /// `http://localhost:{FRONTEND_PORT}`, so this must track the serving
    /// mode or every OAuth signup dead-ends on an unused port.
    frontend_port: u16,
    infra: InfraEnv,
    storage: StorageEnv,
    queues: QueueEnv,
    mail: MailEnv,
    agent_harness: AgentHarnessEnv,
    service_auth: ServiceAuthEnv,
    fusionauth: FusionAuthEnv,
    boot_stubs: BootStubEnv,
}

impl LocalEnv {
    /// Build the local env for `instance` in `Local` mode (dev sources its env
    /// from Doppler, not here).
    pub fn for_instance(mode: Mode, instance: &Instance, static_frontend: bool) -> Self {
        let name = instance.name();
        LocalEnv {
            // Both local flavors run against local infra (`local` env defaults).
            environment: mode.environment_var(),
            project_name: instance.project_name().to_string(),
            frontend_port: if static_frontend {
                instance.port(Port::Proxy)
            } else {
                instance.port(Port::Frontend)
            },
            infra: InfraEnv::local(),
            storage: StorageEnv::local(),
            queues: QueueEnv::local(),
            mail: MailEnv::local(),
            agent_harness: AgentHarnessEnv::local(instance.project_name()),
            service_auth: ServiceAuthEnv::for_instance(name),
            fusionauth: FusionAuthEnv::for_instance(instance),
            boot_stubs: BootStubEnv,
        }
    }

    /// Flatten to the env map services receive. The single struct→env boundary.
    pub fn to_env(&self) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        env.insert("ENVIRONMENT".into(), self.environment.into());
        env.insert("COMPOSE_PROJECT_NAME".into(), self.project_name.clone());
        env.insert("PORT".into(), "8080".into());
        env.insert("FRONTEND_PORT".into(), self.frontend_port.to_string());
        // Calendar ingestion/sync ships dark (both flags default off in
        // deployed envs); local stacks keep it on for development.
        env.insert("CALENDAR_SYNC_ENABLED".into(), "true".into());
        env.insert("CALENDAR_SCOPE_ENABLED".into(), "true".into());
        // Calendar search ships dark too: off in deployed envs until each has
        // its calendar index created and backfilled.
        env.insert("CALENDAR_SEARCH_ENABLED".into(), "true".into());
        self.infra.write(&mut env);
        self.storage.write(&mut env);
        self.queues.write(&mut env);
        self.mail.write(&mut env);
        self.agent_harness.write(&mut env);
        self.service_auth.write(&mut env);
        self.fusionauth.write(&mut env);
        env
    }

    /// The boot-stub fallback layer (see [`BootStubEnv`]), kept separate from
    /// [`Self::to_env`] on purpose: the resolver layers these BELOW Doppler so
    /// real integration values win over the stubs, while `to_env`'s local
    /// plumbing is layered ABOVE Doppler and wins.
    pub fn boot_stub_env(&self) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        self.boot_stubs.write(&mut env);
        env
    }
}

/// Databases, search, and the LocalStack/AWS endpoint (dummy creds — no real AWS
/// locally). Hostnames are docker-network names: binaries run inside containers.
struct InfraEnv {
    database_url: String,
    redis_uri: String,
    opensearch_url: String,
    local_aws_url: String,
    kafka_brokers: String,
}

impl InfraEnv {
    fn local() -> Self {
        InfraEnv {
            database_url: "postgres://user:password@postgres:5432/macrodb".into(),
            redis_uri: "redis://redis:6379".into(),
            opensearch_url: "http://search:9200".into(),
            local_aws_url: "http://localstack:4566".into(),
            // The broker's in-network listener (see docker/docker-compose-databases.yml);
            // host processes use localhost:9092 instead.
            kafka_brokers: "kafka:29092".into(),
        }
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        env.insert("DATABASE_URL".into(), self.database_url.clone());
        env.insert("DATABASE_URL_READONLY".into(), self.database_url.clone());
        env.insert("REDIS_URI".into(), self.redis_uri.clone());
        env.insert(
            "DOCUMENT_STORAGE_SERVICE_REDIS_URI".into(),
            self.redis_uri.clone(),
        );
        env.insert("LAST_ONLINE_REDIS_URI".into(), self.redis_uri.clone());
        env.insert("OPENSEARCH_URL".into(), self.opensearch_url.clone());
        env.insert("LOCAL_AWS_URL".into(), self.local_aws_url.clone());
        env.insert("KAFKA_BROKERS".into(), self.kafka_brokers.clone());
        // In-network services resolve the gateway through the OVERRIDE_ var;
        // without it the resolver's Environment::Local default
        // (http://localhost:8082) points at the calling container itself and
        // every realtime push silently fails.
        env.insert(
            "OVERRIDE_CONNECTION_GATEWAY_URL".into(),
            "http://connection-gateway:8080".into(),
        );
        // Same trap for document storage: the Environment::Local default is
        // http://localhost:8086, the *host* port mapping, which resolves to
        // the calling container. Callers like the authentication service's
        // signup hook (starter docs) then fail with a connection error.
        // `DOCUMENT_STORAGE_SERVICE_URL` (from Doppler) only covers the older
        // call sites that read that var directly, not `macro_service_urls`.
        env.insert(
            "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL".into(),
            "http://document-storage-service:8080".into(),
        );
        // Lexical has the same host-vs-container split. The plain
        // `LEXICAL_SERVICE_URL` value does not affect `LexicalServiceUrl`,
        // which only reads the `OVERRIDE_` form.
        env.insert(
            "OVERRIDE_LEXICAL_SERVICE_URL".into(),
            "http://lexical-service:8096".into(),
        );
        // Same failure mode for the email connect flows: without these,
        // first-inbox provisioning (auth-service → `/email/init`) and Gmail
        // token fetches (email-service → `/internal/google_access_token`)
        // fail with connection errors. (Plain `EMAIL_SERVICE_URL` in Doppler
        // is ignored — macro_service_urls only honors the `OVERRIDE_` prefix.)
        env.insert(
            "OVERRIDE_EMAIL_SERVICE_URL".into(),
            "http://email-service:8080".into(),
        );
        env.insert(
            "OVERRIDE_AUTH_SERVICE_URL".into(),
            "http://authentication-service:8080".into(),
        );
        // Dummy creds: the SDK talks to LocalStack, never real AWS.
        env.insert("AWS_ACCESS_KEY_ID".into(), "test".into());
        env.insert("AWS_SECRET_ACCESS_KEY".into(), "test".into());
        env.insert("AWS_REGION".into(), "us-east-1".into());
        env.insert("AWS_DEFAULT_REGION".into(), "us-east-1".into());
    }
}

/// S3 buckets and DynamoDB tables, emitted straight from the shared
/// [`resources`] catalog so they can't drift from what LocalStack provisions.
struct StorageEnv;

impl StorageEnv {
    fn local() -> Self {
        StorageEnv
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        for bucket in resources::BUCKETS {
            env.insert(bucket.env_key.into(), bucket.name.into());
        }
        for table in resources::TABLES {
            env.insert(table.env_key.into(), table.name.into());
        }
        // search_processing_service self-creates this DynamoDB table on startup
        // in Local (BackfillJobs::ensure_table), so it is not in the provisioned
        // catalog above — it only needs the name wired here.
        env.insert(
            "BACKFILL_JOBS_TABLE".into(),
            "search-processing-backfill-jobs".into(),
        );
    }
}

/// SQS queues, emitted from the shared [`resources`] catalog. Each queue knows
/// which env key(s) point at it and whether they want the bare name or the full
/// LocalStack URL — so adding a queue is a single catalog entry, not edits here
/// *and* in the provisioner.
struct QueueEnv;

impl QueueEnv {
    fn local() -> Self {
        QueueEnv
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        for queue in resources::QUEUES {
            for &(key, form) in queue.bindings {
                env.insert(key.into(), form.value(queue.name));
            }
        }
    }
}

/// Mail: SES sends are routed to Mailpit SMTP (see the `ses_client` transport).
struct MailEnv {
    smtp_host: &'static str,
    smtp_port: &'static str,
    sender_base_address: &'static str,
}

impl MailEnv {
    fn local() -> Self {
        MailEnv {
            smtp_host: "mailpit",
            smtp_port: "1025",
            sender_base_address: "macro.local",
        }
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        env.insert("SMTP_HOST".into(), self.smtp_host.into());
        env.insert("SMTP_PORT".into(), self.smtp_port.into());
        env.insert(
            "SENDER_BASE_ADDRESS".into(),
            self.sender_base_address.into(),
        );
    }
}

/// The agent harness: which bot it answers for, and where its sandboxes come
/// from.
///
/// Local stacks run sandboxes on the developer's own Docker daemon, so no
/// Daytona account is involved. `DAYTONA_API_KEY` is seeded empty so Doppler
/// cannot bill Daytona, while still leaving the key in the map for
/// `DAYTONA_API_KEY=... DEV_DANGEROUS_LOCAL_CONTAINERS=false just run_local`.
/// `GITHUB_TOKEN` is left to Doppler / process env so a local sandbox can
/// still clone.
///
/// Two managed bots: `@coder` (`HARNESS_BOT_ID`) gets a sandbox from the
/// local Docker provider, and `@macro` (`INMEM_BOT_ID`) runs in-process on
/// the in-memory ACP runtime.
struct AgentHarnessEnv {
    bot_id: &'static str,
    snapshot: &'static str,
    /// Image the local provider runs. `run_local` / `stack up` `docker build`
    /// `crates/agent_harness/container` to this tag (BuildKit cache is the
    /// freshness check).
    image: &'static str,
    /// Network sandboxes join, so this service can dial their sidecars.
    network: String,
}

impl AgentHarnessEnv {
    fn local(project_name: &str) -> Self {
        AgentHarnessEnv {
            // bot_id::MACRO_CODER_BOT_ID, seeded by the bots_has_agent migration.
            bot_id: "00000000-0000-0000-0000-00000000a9e7",
            snapshot: "macro-agent-harness",
            image: super::sandbox_image::DEFAULT_LOCAL_TAG,
            // Compose names a network `<project>_<network>`.
            network: format!("{project_name}_services"),
        }
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        env.insert("HARNESS_BOT_ID".into(), self.bot_id.into());
        // bot_id::MACRO_AI_BOT_ID: @macro's sessions run on the in-process
        // ACP runtime, while @coder's get sandboxes from the local provider.
        env.insert(
            "INMEM_BOT_ID".into(),
            "00000000-0000-0000-0000-00000000a1a1".into(),
        );
        env.insert("DAYTONA_SNAPSHOT".into(), self.snapshot.into());
        env.insert("DAYTONA_API_KEY".into(), String::new());
        env.insert("DEV_DANGEROUS_LOCAL_CONTAINERS".into(), "true".into());
        env.insert("LOCAL_CONTAINER_IMAGE".into(), self.image.into());
        env.insert("LOCAL_CONTAINER_NETWORK".into(), self.network.clone());
    }
}

/// Internal service-to-service auth secrets. Deterministic per instance so every
/// container (services, sync, lexical) agrees. `INTERNAL_API_SECRET_KEY` is the
/// literal `"local"` to match the FusionAuth webhook's `x-internal-auth-key`.
struct ServiceAuthEnv {
    dss_auth: String,
    doc_perm_jwt: String,
    internal_call: String,
    url_signing: String,
}

impl ServiceAuthEnv {
    fn for_instance(name: &str) -> Self {
        ServiceAuthEnv {
            dss_auth: identity::instance_secret("dss-auth", name),
            // Must match sync-service's local DOCUMENT_PERMISSIONS_SECRET
            // ("local") so locally-minted tokens verify. This is ONLY for local
            // dev use obv
            doc_perm_jwt: "local".to_string(),
            internal_call: identity::instance_secret("internal-call", name),
            url_signing: identity::instance_secret("url-signing", name),
        }
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        // The shared internal auth key — must match the kickstart webhook header.
        env.insert(
            "INTERNAL_API_SECRET_KEY".into(),
            identity::INTERNAL_AUTH_KEY.into(),
        );
        env.insert(
            "INTERNAL_AUTH_KEY".into(),
            identity::INTERNAL_AUTH_KEY.into(),
        );
        env.insert(
            "SYNC_SERVICE_AUTH_KEY".into(),
            identity::INTERNAL_AUTH_KEY.into(),
        );
        // The key the authentication service presents to document storage on
        // internal calls (e.g. seeding starter docs at signup). In dev/prod
        // Doppler points it at the *same* secret as DSS's own auth key
        // (document-storage-service-auth-key-*), so locally the two must be
        // one value or DSS 401s every auth-service internal call.
        env.insert("SERVICE_INTERNAL_AUTH_KEY".into(), self.dss_auth.clone());
        env.insert(
            "DOCUMENT_STORAGE_SERVICE_AUTH_KEY".into(),
            self.dss_auth.clone(),
        );
        env.insert("DOCUMENT_PERMISSION_JWT".into(), self.doc_perm_jwt.clone());
        env.insert("INTERNAL_CALL_SECRET".into(), self.internal_call.clone());
        env.insert("URL_SIGNING_HMAC".into(), self.url_signing.clone());
    }
}

/// FusionAuth identity — all fixed UUIDs/secrets shared with the deterministic
/// kickstart (see [`identity`]). Browser-facing URLs are instance-specific.
struct FusionAuthEnv {
    oauth_redirect_uri: String,
    public_url: String,
    /// The auth service's own public origin (`BASE_URL`): OAuth callbacks and
    /// email verification links are built on it. Same host-port convention as
    /// [`identity::oauth_redirect_uri`]. Doppler supplies it for dev; the
    /// code-owned env must too, or a `--no-doppler` stack's auth service dies
    /// at startup on the missing required value.
    base_url: String,
}

impl FusionAuthEnv {
    fn for_instance(instance: &Instance) -> Self {
        FusionAuthEnv {
            oauth_redirect_uri: identity::oauth_redirect_uri(instance.port(Port::Auth)),
            public_url: format!("http://localhost:{}", instance.port(Port::FusionAuth)),
            base_url: format!("http://localhost:{}", instance.port(Port::Auth)),
        }
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        env.insert("BASE_URL".into(), self.base_url.clone());
        env.insert(
            "FUSIONAUTH_BASE_URL".into(),
            "http://fusionauth:9011".into(),
        );
        env.insert("FUSIONAUTH_PUBLIC_URL".into(), self.public_url.clone());
        env.insert(
            "FUSIONAUTH_API_KEY".into(),
            identity::FUSIONAUTH_API_KEY.into(),
        );
        // Canonical name read by auth_service (MacroConfig serde field) + seed_cli.
        env.insert(
            "FUSIONAUTH_API_KEY_SECRET_KEY".into(),
            identity::FUSIONAUTH_API_KEY.into(),
        );
        env.insert(
            "FUSIONAUTH_CLIENT_ID".into(),
            identity::APPLICATION_ID.into(),
        );
        env.insert(
            "FUSIONAUTH_CLIENT_SECRET_KEY".into(),
            identity::CLIENT_SECRET.into(),
        );
        env.insert(
            "FUSIONAUTH_OAUTH_REDIRECT_URI".into(),
            self.oauth_redirect_uri.clone(),
        );
        // macro_auth JWT claim validation.
        env.insert("AUDIENCE".into(), identity::APPLICATION_ID.into());
        env.insert("ISSUER".into(), identity::ISSUER.into());
        env.insert("JWT_SECRET_KEY".into(), identity::JWT_SECRET.into());
    }
}

/// Values the services' `macro_config` loaders require but that only exist in
/// Doppler's `lcl_personal` config. Without these a `--no-doppler` stack's
/// containers crash at startup ("missing required value") before any of the
/// integration the value backs is ever exercised. Each entry is a deterministic
/// local stub: good enough to boot, never a real secret, and only meaningful
/// for the specific integration it names (which won't work locally anyway —
/// that's what `--env-file` / `run_dev` are for).
///
/// Unlike the rest of [`LocalEnv`], these are a FALLBACK layer: the resolver
/// applies them below Doppler (see `env_layer::resolve`), so a developer with
/// Doppler access keeps every real integration value. A key here must never
/// also appear in [`LocalEnv::to_env`] — that would make precedence ambiguous
/// (a test enforces this).
struct BootStubEnv;

impl BootStubEnv {
    fn write(&self, env: &mut BTreeMap<String, String>) {
        // connection_gateway config reads `REDIS_HOST` (a Redis URL, not a
        // hostname — see `redis::Client::open`).
        env.insert("REDIS_HOST".into(), "redis://redis:6379".into());
        // email_service / connection_gateway open their own Postgres pool.
        env.insert(
            "MACRO_DB_URL".into(),
            "postgres://user:password@postgres:5432/macrodb".into(),
        );
        // services validating the shared internal auth header.
        env.insert(
            "INTERNAL_API_KEY".into(),
            identity::INTERNAL_AUTH_KEY.into(),
        );
        // document_cognition_service's soup client (internal HMAC).
        env.insert(
            "AUTHENTICATION_SERVICE_SECRET_KEY".into(),
            identity::INTERNAL_AUTH_KEY.into(),
        );
        // search_processing_service; the local cluster has the security plugin
        // disabled so these are accepted but ignored (same as opensearch.rs).
        env.insert("OPENSEARCH_USERNAME".into(), "macrouser".into());
        env.insert("OPENSEARCH_PASSWORD".into(), "local".into());
        // document_storage_service's presigned-URL config. Locally the
        // `is_local_aws()` branch skips CloudFront signing entirely, so only a
        // well-formed base URL is needed.
        env.insert(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL".into(),
            "http://localhost:8100".into(),
        );
        env.insert(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID".into(),
            "local-cloudfront-signer".into(),
        );
        env.insert(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY".into(),
            "local".into(),
        );
        // The `ai_tools` tool-context env (document_storage_service builds one
        // at boot) reads this as a separate secret-name var.
        env.insert(
            "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME".into(),
            "local-cloudfront-signer-private-key".into(),
        );
        // authentication_service's third-party OAuth/Stripe config. The FusionAuth
        // kickstart only creates the Google/GitHub IdPs when real creds are
        // present (see kickstart.rs), so these stubs just satisfy the loader.
        env.insert("GOOGLE_CLIENT_ID".into(), "local-google-client".into());
        env.insert(
            "GOOGLE_CLIENT_SECRET_KEY".into(),
            "local-google-client-secret".into(),
        );
        env.insert("GITHUB_CLIENT_ID".into(), "local-github-client".into());
        env.insert(
            "GITHUB_CLIENT_SECRET".into(),
            "local-github-client-secret".into(),
        );
        env.insert(
            "GITHUB_IDP_ID".into(),
            "99999999-9999-4999-8999-999999999999".into(),
        );
        // Clone token for local sandboxes. Empty here so `--no-doppler` still
        // has the key for `GITHUB_TOKEN=... just run_local`; Doppler overlays
        // a real token when present. Not in `to_env`, so a local stack does
        // not wipe Doppler's value the way it wipes `DAYTONA_API_KEY`.
        env.insert("GITHUB_TOKEN".into(), String::new());
        env.insert("STRIPE_SECRET_KEY".into(), "local-stripe-secret".into());
        env.insert("STRIPE_PRICE_ID".into(), "local-stripe-price".into());
        env.insert(
            "STRIPE_WEBHOOK_SECRET_KEY".into(),
            "local-stripe-webhook-secret".into(),
        );
        // macro_auth's `JwtValidationArgs` (used by every service that mounts
        // the auth middleware) reads these at boot. The keys are only parsed
        // when a Macro API token is actually validated — normal local auth
        // uses FusionAuth JWTs — so dummies are fine.
        env.insert("MACRO_API_TOKEN_ISSUER".into(), "local".into());
        env.insert(
            "MACRO_API_TOKEN_PUBLIC_KEY".into(),
            "local-macro-api-token-public-key".into(),
        );
        env.insert(
            "MACRO_API_TOKEN_PRIVATE_SECRET_KEY".into(),
            "local-macro-api-token-private-key".into(),
        );
        env.insert("MACRO_API_TOKEN_EXPIRY_SECONDS".into(), "3600".into());
        // email_service's GCP pubsub queue (gmail watch notifications) and
        // its own CloudFront signer for attachment presigned URLs.
        env.insert("GMAIL_GCP_QUEUE".into(), "gmail-gcp-queue-local".into());
        env.insert("APOLLO_API_KEY".into(), "local".into());
        env.insert(
            "EMAIL_SERVICE_CLOUDFRONT_DISTRIBUTION_URL".into(),
            "http://localhost:8100".into(),
        );
        env.insert(
            "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY".into(),
            "local".into(),
        );
        env.insert(
            "EMAIL_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID".into(),
            "local-cloudfront-signer".into(),
        );
        // notification_service's APNS/FCM push config — push won't work
        // locally, but the loader requires the keys.
        env.insert("APPLE_BUNDLE_ID".into(), "com.macro.local".into());
        env.insert(
            "SNS_APNS_PLATFORM_ARN".into(),
            "arn:aws:sns:us-east-1:000000000000:app/APNS/macro-local".into(),
        );
        env.insert(
            "SNS_FCM_PLATFORM_ARN".into(),
            "arn:aws:sns:us-east-1:000000000000:app/GCM/macro-local".into(),
        );
        // document_cognition_service's MCP credentials encryption key — must be
        // a base64-encoded 32-byte AES key (`AesKey::try_from`).
        env.insert(
            "MCP_CREDENTIALS_KEY_SECRET_NAME".into(),
            "VrOPM+uhQKuas1vO8FpyWDc/ZRhLAXYW5lRz8s0yyA4=".into(),
        );
        // document_cognition_service reads `ANTHROPIC_API_KEY` at boot
        // (`anthropic::Config::dangrously_try_from_env`); a dummy satisfies the
        // loader, real model calls just fail.
        env.insert("ANTHROPIC_API_KEY".into(), "local-anthropic-key".into());
        // document_cognition_service's MCP provider registry requires the
        // pre-registered OAuth creds (Slack + GitHub) at boot.
        env.insert(
            "SLACK_MCP_CLIENT_ID".into(),
            "local-slack-mcp-client".into(),
        );
        env.insert(
            "SLACK_MCP_CLIENT_SECRET".into(),
            "local-slack-mcp-secret".into(),
        );
        // document_storage_service's GitHub sync + LiveKit + LLM + Cal config.
        // All boot-required; the integrations they back are inert locally.
        env.insert("GITHUB_SYNC_APP_URL".into(), "http://localhost:8080".into());
        env.insert(
            "GITHUB_SYNC_APP_CLIENT_ID".into(),
            "local-github-sync-client".into(),
        );
        env.insert(
            "GITHUB_SYNC_APP_CLIENT_SECRET".into(),
            "local-github-sync-secret".into(),
        );
        env.insert(
            "GITHUB_INSTALLATION_STATE_SECRET".into(),
            "local-github-installation-state".into(),
        );
        env.insert(
            "GITHUB_WEBHOOK_SECRET_KEY".into(),
            "local-github-webhook-secret".into(),
        );
        env.insert(
            "GITHUB_SYNC_APP_PEM_SECRET_KEY".into(),
            "local-github-sync-pem".into(),
        );
        env.insert("LIVEKIT_SERVER_URL".into(), "http://localhost:7880".into());
        env.insert("LIVEKIT_API_KEY".into(), "local-livekit-key".into());
        env.insert("LIVEKIT_API_SECRET".into(), "local-livekit-secret".into());
        env.insert("OPENAI_API_KEY".into(), "local-openai-key".into());
        env.insert("COHERE_API_KEY".into(), "local-cohere-key".into());
        env.insert(
            "CAL_WEBHOOK_SECRET_KEY".into(),
            "local-cal-webhook-secret".into(),
        );
        env.insert(
            "CAL_EVENT_TYPE_CONTENT_NAMES_KEY".into(),
            r#"{"1":{"content_name":"local","value":0}}"#.into(),
        );
        // Meta (Facebook) tracking pixel config. Required by the config loader;
        // the pixel is inert locally.
        env.insert("META_PIXEL_ID".into(), "local-meta-pixel".into());
        env.insert("META_ACCESS_TOKEN".into(), "local-meta-access-token".into());
    }
}

#[cfg(test)]
mod test;
