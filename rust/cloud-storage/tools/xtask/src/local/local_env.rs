//! The typed, code-owned local-stack environment — the replacement for the
//! checked-in `infra/local/defaults.env`.
//!
//! Local mode is fully code-defined: it does NOT pull Doppler. Every value here
//! is deterministic and local-only — docker-network hostnames, LocalStack dummy
//! creds, fixed queue/bucket names, the fixed FusionAuth kickstart identity, and
//! per-instance internal secrets. Anything that needs a *real* secret or a real
//! integration (Gmail, Stripe, …) is intentionally absent: that's a `run_dev`
//! concern (Doppler), not a local one.
//!
//! [`LocalEnv::for_instance`] builds the struct; [`LocalEnv::to_env`] is the one
//! boundary that flattens it to the env map. Grouping makes additions land in a
//! named, testable place instead of a free-form dotenv file that quietly rots.

use std::collections::BTreeMap;

use super::instance::{Instance, Port};
use super::{identity, resources, Mode};

/// The full local environment for one instance.
pub struct LocalEnv {
    environment: &'static str,
    project_name: String,
    infra: InfraEnv,
    storage: StorageEnv,
    queues: QueueEnv,
    mail: MailEnv,
    service_auth: ServiceAuthEnv,
    fusionauth: FusionAuthEnv,
}

impl LocalEnv {
    /// Build the local env for `instance` in `Local` mode (dev sources its env
    /// from Doppler, not here).
    pub fn for_instance(mode: Mode, instance: &Instance) -> Self {
        let name = instance.name();
        LocalEnv {
            // Both local flavors run against local infra (`local` env defaults).
            environment: mode.environment_var(),
            project_name: instance.project_name().to_string(),
            infra: InfraEnv::local(),
            storage: StorageEnv::local(),
            queues: QueueEnv::local(),
            mail: MailEnv::local(),
            service_auth: ServiceAuthEnv::for_instance(name),
            fusionauth: FusionAuthEnv::for_instance(instance),
        }
    }

    /// Flatten to the env map services receive. The single struct→env boundary.
    pub fn to_env(&self) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        env.insert("ENVIRONMENT".into(), self.environment.into());
        env.insert("COMPOSE_PROJECT_NAME".into(), self.project_name.clone());
        env.insert("PORT".into(), "8080".into());
        self.infra.write(&mut env);
        self.storage.write(&mut env);
        self.queues.write(&mut env);
        self.mail.write(&mut env);
        self.service_auth.write(&mut env);
        self.fusionauth.write(&mut env);
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
            // The broker's in-network listener (see docker-compose-databases.yml);
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

/// Internal service-to-service auth secrets. Deterministic per instance so every
/// container (services, sync, lexical) agrees. `INTERNAL_API_SECRET_KEY` is the
/// literal `"local"` to match the FusionAuth webhook's `x-internal-auth-key`.
struct ServiceAuthEnv {
    service_internal: String,
    dss_auth: String,
    doc_perm_jwt: String,
    internal_call: String,
    url_signing: String,
}

impl ServiceAuthEnv {
    fn for_instance(name: &str) -> Self {
        ServiceAuthEnv {
            service_internal: identity::instance_secret("service-internal", name),
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
        env.insert(
            "SERVICE_INTERNAL_AUTH_KEY".into(),
            self.service_internal.clone(),
        );
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
/// kickstart (see [`identity`]). The OAuth redirect is the only per-instance bit.
struct FusionAuthEnv {
    oauth_redirect_uri: String,
}

impl FusionAuthEnv {
    fn for_instance(instance: &Instance) -> Self {
        FusionAuthEnv {
            oauth_redirect_uri: identity::oauth_redirect_uri(instance.port(Port::Auth)),
        }
    }

    fn write(&self, env: &mut BTreeMap<String, String>) {
        env.insert(
            "FUSIONAUTH_BASE_URL".into(),
            "http://fusionauth:9011".into(),
        );
        env.insert(
            "FUSIONAUTH_API_KEY".into(),
            identity::FUSIONAUTH_API_KEY.into(),
        );
        // Canonical name read by auth_service (MacroConfig serde field) + seed_cli.
        env.insert(
            "FUSIONAUTH_API_KEY_SECRET_KEY".into(),
            identity::FUSIONAUTH_API_KEY.into(),
        );
        env.insert("FUSIONAUTH_TENANT_ID".into(), identity::TENANT_ID.into());
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

#[cfg(test)]
mod test;
