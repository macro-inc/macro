//! Generates the per-instance docker-compose override.
//!
//! The override is built as a typed [`docker_compose_types::Compose`] model
//! (not hand-written YAML): each Rust service is converted to the prebuilt
//! runtime image with the host binary dir bind-mounted at `/app/out`, the
//! companion infra services (LocalStack, Mailpit, reverse proxy) are added, and
//! FusionAuth is repointed at the generated kickstart.
//!
//! The only thing the typed model can't express is Compose's `!reset` /
//! `!override` merge tags (needed to drop the inherited `build:` and to replace
//! inherited `ports:`/`volumes:` rather than append). Those are emitted via
//! `serde_yaml`'s native tagged-value support — still structured data, no string
//! munging.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result};
use docker_compose_types as dct;
use indexmap::IndexMap;
use serde_yaml::Value;
use serde_yaml::value::{Tag, TaggedValue};

use super::build::{BinariesDir, RUNTIME_IMAGE_TAG};
use super::instance::{Instance, Port};
use super::inventory::services_for_mode;
use super::{Mode, repo_root};

/// The one Rust service with a second listener: the agent egress proxy inside
/// `agent_harness_service`, on the container port `EGRESS_PORT` defaults to.
const EGRESS_SERVICE: &str = "agent_harness_service";
const EGRESS_CONTAINER_PORT: u16 = 8102;

pub const LOCALSTACK_IMAGE: &str = "localstack/localstack:4";
pub const MAILPIT_IMAGE: &str = "axllent/mailpit:v1.20";
pub const CADDY_IMAGE: &str = "caddy:2-alpine";
pub const SDK_WEBHOOK_RELAY_IMAGE: &str = "macro-sdk-webhook-relay:dev";

/// Base-compose services that bind fixed host ports but aren't in our inventory
/// (reached via the proxy / container network, not the host). For named
/// instances we drop their host-port bindings so concurrent stacks don't collide
/// on 8787/6969/8096/8100/8933.
const AUX_HOST_PORT_SERVICES: &[&str] = &[
    "sync_service",
    "websocket_service",
    "lexical_service",
    "static_file_cdn",
    "ai_editing_worker",
    "analytics_proxy",
];

/// The host directory bind-mounted into FusionAuth at
/// `/usr/local/fusionauth/kickstart`. The kickstart writer fills it.
pub fn kickstart_dir(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("kickstart")
}

/// The generated Caddyfile path for this instance's reverse proxy.
pub fn caddyfile_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("proxy/Caddyfile")
}

/// Build the override (typed model), apply the merge tags, and write it.
/// `static_frontend` mounts the staged app bundle into the proxy (headless
/// stacks serve the frontend from Caddy instead of a dev server).
pub fn generate(
    mode: Mode,
    instance: &Instance,
    binaries: &BinariesDir,
    static_frontend: bool,
    gmail_forwarder: bool,
) -> Result<PathBuf> {
    let mut services: IndexMap<String, Option<dct::Service>> = IndexMap::new();
    let mounts = binaries.compose_mounts();

    // 1. Rust services → runtime image + mounted binaries.
    for svc in services_for_mode(mode) {
        let mut s = dct::Service {
            image: Some(RUNTIME_IMAGE_TAG.to_string()),
            volumes: mounts.iter().cloned().map(dct::Volumes::Simple).collect(),
            environment: kv(&[("PORT", "8080")]),
            ..Default::default()
        };
        // Named instances need their own host ports (replacing the base ports —
        // emitted as `!override` in apply_tags). Only the self-contained local
        // stacks remap; dev inherits the base-compose ports.
        let mut ports = Vec::new();
        if mode.spec().runs_local_infra
            && !instance.is_default()
            && let Some(port) = svc.host_port
        {
            ports.push(format!("{}:8080", instance.port(port)));
        }
        // The agent egress proxy is the harness's second listener, and the one
        // service port a party outside the compose network has to reach: the
        // egress tunnel forwards Cursor's cloud to this host port. Published on
        // every local instance, default included - the base compose publishes
        // nothing for the harness.
        if mode.spec().runs_local_infra && svc.compose_name == EGRESS_SERVICE {
            ports.push(format!(
                "{}:{EGRESS_CONTAINER_PORT}",
                instance.port(Port::AgentHarnessEgress)
            ));
        }
        if !ports.is_empty() {
            s.ports = dct::Ports::Short(ports);
        }
        services.insert(svc.compose_name.to_string(), Some(s));
    }

    // The reverse proxy is the frontend's single origin in every mode, and
    // LocalStack runs in every mode (dev's `dev_personal` notification queue
    // lives there too).
    add_proxy_service(&mut services, instance, static_frontend);
    add_localstack_service(&mut services, instance);
    // The rest of the local infra (FusionAuth, Mailpit, per-instance Postgres/
    // Redis/OpenSearch port remaps) only for the self-contained local stacks.
    if mode.spec().runs_local_infra {
        add_local_infra(&mut services, instance, static_frontend);
        add_sdk_webhook_relay(&mut services, instance)?;
    }
    // Live Gmail sync: forward watch notifications from the instance's own
    // Pub/Sub subscription to the email service's webhook. Per-instance
    // subscriptions (created by the forwarder on startup) let concurrent
    // stacks sync independently — a subscription is a queue, not a broadcast,
    // so sharing one would make instances steal each other's notifications.
    // Gated on the SA key being present in the resolved env.
    if gmail_forwarder && mode.spec().runs_local_infra {
        services.insert(
            "gmail_forwarder".to_string(),
            Some(dct::Service {
                image: Some(RUNTIME_IMAGE_TAG.to_string()),
                volumes: mounts.iter().cloned().map(dct::Volumes::Simple).collect(),
                command: Some(dct::Command::Args(
                    [
                        "/app/out/seed_cli",
                        "gmail",
                        "forward",
                        "--target",
                        "http://email-service:8080/gmail/webhook",
                        "--subscription",
                        &format!(
                            "projects/macro-email-testing/subscriptions/gmail-local-watch-{}",
                            instance.name()
                        ),
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                )),
                env_file: Some(dct::StringOrList::Simple("${MACRO_ENV_FILE}".to_string())),
                networks: net_aliases(&[("services", &["gmail-forwarder"])]),
                ..Default::default()
            }),
        );
    }

    let compose = dct::Compose {
        services: dct::Services(services),
        ..Default::default()
    };

    // Serialize the typed model, then layer in the merge tags + (named instance)
    // external network/volume definitions, which the schema can't represent.
    let mut value = serde_yaml::to_value(&compose).context("serializing compose override")?;
    apply_tags(&mut value, mode, instance);
    if mode.spec().runs_local_infra && !instance.is_default() {
        set_external_networks_and_volumes(&mut value, instance);
    }

    let yaml = serde_yaml::to_string(&value).context("rendering override yaml")?;
    let path = instance
        .ensure_artifact_dir()?
        .join("docker-compose.override.yml");
    std::fs::write(
        &path,
        format!(
            "# GENERATED by `cargo x` (local::gen_compose) — do not edit.\nname: {}\n{yaml}",
            instance.project_name()
        ),
    )
    .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

fn add_sdk_webhook_relay(
    services: &mut IndexMap<String, Option<dct::Service>>,
    instance: &Instance,
) -> Result<()> {
    super::sdk_webhook::ensure_keys(instance)?;
    let build = dct::BuildStep::Advanced(dct::AdvancedBuildStep {
        context: repo_root()
            .join("infra/local/sdk-webhook-relay")
            .display()
            .to_string(),
        ..Default::default()
    });
    services.insert(
        "sdk-webhook-relay".to_string(),
        Some(dct::Service {
            image: Some(SDK_WEBHOOK_RELAY_IMAGE.to_string()),
            build_: Some(build),
            ports: dct::Ports::Short(vec![format!(
                "127.0.0.1:{}:22",
                super::sdk_webhook::ssh_port(instance)
            )]),
            volumes: vec![dct::Volumes::Simple(format!(
                "{}:/etc/ssh/authorized_keys/{}:ro",
                super::sdk_webhook::key_dir(instance)
                    .join("id_ed25519.pub")
                    .display(),
                "sdk-webhook"
            ))],
            networks: net_aliases(&[("services", &["sdk-webhook-relay"])]),
            ..Default::default()
        }),
    );
    Ok(())
}

/// LocalStack (S3/SQS/DynamoDB), reachable as `localstack` on both networks.
/// Used by local AND dev — dev's `dev_personal` notification queue lives here.
fn add_localstack_service(
    services: &mut IndexMap<String, Option<dct::Service>>,
    instance: &Instance,
) {
    services.insert(
        "localstack".to_string(),
        Some(dct::Service {
            image: Some(LOCALSTACK_IMAGE.to_string()),
            // `kms` for the Cursor API key CMK (see `localstack::create_kms_keys`).
            // LocalStack only starts the services named here, so an omission
            // shows up as `"kms": "disabled"` on its health endpoint rather
            // than as a connection error.
            environment: kv(&[("SERVICES", "sqs,dynamodb,s3,kms")]),
            ports: dct::Ports::Short(vec![format!("{}:4566", instance.port(Port::LocalStack))]),
            networks: net_aliases(&[
                ("databases", &["localstack"]),
                ("services", &["localstack"]),
            ]),
            ..Default::default()
        }),
    );
}

/// The single-origin reverse proxy (Caddy). Added in every mode — it's how the
/// frontend reaches the local service containers. Headless stacks also mount
/// the staged app bundle so Caddy serves the frontend itself (see
/// `proxy::FRONTEND_STATIC`).
fn add_proxy_service(
    services: &mut IndexMap<String, Option<dct::Service>>,
    instance: &Instance,
    static_frontend: bool,
) {
    let proxy_port = instance.port(Port::Proxy);
    let mut volumes = vec![dct::Volumes::Simple(format!(
        "{}:/etc/caddy/Caddyfile:ro",
        caddyfile_path(instance).display()
    ))];
    if static_frontend {
        volumes.push(dct::Volumes::Simple(format!(
            "{}:/srv/frontend:ro",
            super::frontend::static_dir(instance).display()
        )));
    }
    services.insert(
        "proxy".to_string(),
        Some(dct::Service {
            image: Some(CADDY_IMAGE.to_string()),
            environment: kv(&[("PROXY_PORT", &proxy_port.to_string())]),
            ports: dct::Ports::Short(vec![format!("{proxy_port}:{proxy_port}")]),
            volumes,
            networks: dct::Networks::Simple(vec!["services".to_string(), "databases".to_string()]),
            ..Default::default()
        }),
    );
}

/// Add the local-only companion infra services (FusionAuth override + Mailpit)
/// and, for named instances, the remapped infra ports. LocalStack is added
/// separately (it runs in every mode), so it is not included here.
fn add_local_infra(
    services: &mut IndexMap<String, Option<dct::Service>>,
    instance: &Instance,
    static_frontend: bool,
) {
    // FusionAuth: repoint at the generated kickstart (volumes replaced via tag).
    let mut fusionauth = dct::Service {
        environment: kv(&[(
            "FUSIONAUTH_APP_KICKSTART_FILE",
            "/usr/local/fusionauth/kickstart/kickstart.json",
        )]),
        volumes: vec![
            dct::Volumes::Simple("fusionauth_config:/usr/local/fusionauth/config".to_string()),
            dct::Volumes::Simple(format!(
                "{}:/usr/local/fusionauth/kickstart:ro",
                kickstart_dir(instance).display()
            )),
        ],
        ..Default::default()
    };
    if !instance.is_default() {
        fusionauth.ports =
            dct::Ports::Short(vec![format!("{}:9011", instance.port(Port::FusionAuth))]);
    }
    services.insert("fusionauth".to_string(), Some(fusionauth));

    // Mailpit is also on `auth` so FusionAuth can deliver passwordless codes.
    // Only headless mode moves its UI under the proxy-friendly /mailpit root;
    // attached run_local preserves the existing direct UI at port 8025.
    let mut mailpit_env = vec![
        ("MP_SMTP_AUTH_ACCEPT_ANY", "1"),
        ("MP_SMTP_AUTH_ALLOW_INSECURE", "1"),
    ];
    if static_frontend {
        mailpit_env.push(("MP_WEBROOT", "/mailpit"));
    }
    services.insert(
        "mailpit".to_string(),
        Some(dct::Service {
            image: Some(MAILPIT_IMAGE.to_string()),
            environment: kv(&mailpit_env),
            ports: dct::Ports::Short(vec![
                format!("{}:1025", instance.port(Port::MailpitSmtp)),
                format!("{}:8025", instance.port(Port::MailpitUi)),
            ]),
            networks: net_aliases(&[("services", &["mailpit"]), ("auth", &["mailpit"])]),
            ..Default::default()
        }),
    );

    // Named instances also remap the included infra services' host ports.
    if !instance.is_default() {
        services.insert(
            "postgres".to_string(),
            Some(ports_only(vec![format!(
                "{}:5432",
                instance.port(Port::Postgres)
            )])),
        );
        services.insert(
            "redis".to_string(),
            Some(ports_only(vec![
                format!("{}:6379", instance.port(Port::Redis)),
                format!("{}:8001", instance.port(Port::RedisUi)),
            ])),
        );
        services.insert(
            "search".to_string(),
            Some(ports_only(vec![
                format!("{}:9200", instance.port(Port::OpenSearch)),
                format!("{}:9600", instance.port(Port::OpenSearchPa)),
            ])),
        );
        // Kafka also needs its host-facing ADVERTISED listener to carry the
        // remapped port — clients redial the advertised address, not the
        // bootstrap one, so the base compose's `localhost:9092` would send a
        // named instance's clients to the default instance's broker.
        let kafka_port = instance.port(Port::Kafka);
        services.insert(
            "kafka".to_string(),
            Some(dct::Service {
                ports: dct::Ports::Short(vec![format!("{kafka_port}:9092")]),
                environment: kv(&[(
                    "KAFKA_ADVERTISED_LISTENERS",
                    &format!("PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:{kafka_port}"),
                )]),
                ..Default::default()
            }),
        );
        // The auxiliary services' host-port bindings are dropped in `apply_tags`
        // (an empty `ports:` can't be expressed in the typed model — it needs the
        // `!override []` merge tag).
    }
}

/// Emit the Compose merge tags the typed schema can't represent:
/// - every Rust service drops the inherited `build:` (`!reset null`);
/// - in dev, services also drop `depends_on` (we start only the binaries);
/// - named-instance `ports:` and FusionAuth `volumes:` replace rather than
///   append (`!override`).
fn apply_tags(value: &mut Value, mode: Mode, instance: &Instance) {
    let Some(services) = value.get_mut("services").and_then(Value::as_mapping_mut) else {
        return;
    };
    let runs_local_infra = mode.spec().runs_local_infra;
    for svc in services_for_mode(mode) {
        let Some(s) = services
            .get_mut(svc.compose_name)
            .and_then(Value::as_mapping_mut)
        else {
            continue;
        };
        s.insert("build".into(), reset_null());
        if !runs_local_infra {
            // Dev starts only the binaries — drop the base `depends_on` so it
            // doesn't pull up the deployed-equivalent infra containers.
            s.insert("depends_on".into(), reset_null());
        } else if !instance.is_default() {
            override_in_place(s, "ports");
        }
    }
    if runs_local_infra {
        if let Some(fa) = services
            .get_mut("fusionauth")
            .and_then(Value::as_mapping_mut)
        {
            override_in_place(fa, "volumes");
            if !instance.is_default() {
                override_in_place(fa, "ports");
            }
        }
        if !instance.is_default() {
            // Remapped infra ports REPLACE the inherited `ports:`.
            for infra in ["postgres", "redis", "search", "kafka"] {
                if let Some(s) = services.get_mut(infra).and_then(Value::as_mapping_mut) {
                    override_in_place(s, "ports");
                }
            }
            // Drop the aux services' fixed host ports (reached via the proxy /
            // container network) so concurrent named stacks don't collide. An
            // empty `ports:` can't be built in the typed model, so inject the
            // `!override []` directly: `{ports: !override []}` merges over the
            // base service, replacing its host-port list with nothing.
            for name in AUX_HOST_PORT_SERVICES {
                let entry = services
                    .entry(Value::from(*name))
                    .or_insert_with(|| Value::Mapping(serde_yaml::Mapping::new()));
                if let Some(m) = entry.as_mapping_mut() {
                    m.insert("ports".into(), override_tag(Value::Sequence(vec![])));
                }
            }
        }
    }
}

/// Define the per-instance external networks and volumes (named-instance only).
fn set_external_networks_and_volumes(value: &mut Value, instance: &Instance) {
    let ext = |name: String| {
        let mut m = serde_yaml::Mapping::new();
        m.insert("external".into(), true.into());
        m.insert("name".into(), name.into());
        Value::Mapping(m)
    };
    let map = value.as_mapping_mut().expect("compose root is a mapping");
    map.insert(
        "networks".into(),
        Value::Mapping(
            [
                ("databases", instance.network_databases()),
                ("auth", instance.network_auth()),
            ]
            .into_iter()
            .map(|(k, n)| (Value::from(k), ext(n)))
            .collect(),
        ),
    );
    map.insert(
        "volumes".into(),
        Value::Mapping(
            [
                ("db", instance.volume_postgres()),
                ("cache", instance.volume_redis()),
                ("opensearch_data", instance.volume_opensearch()),
                ("kafka_data", instance.volume_kafka()),
                ("db_data", instance.volume_fusionauth_db()),
                ("fusionauth_config", instance.volume_fusionauth_config()),
            ]
            .into_iter()
            .map(|(k, n)| (Value::from(k), ext(n)))
            .collect(),
        ),
    );
}

/// `!reset null`.
fn reset_null() -> Value {
    Value::Tagged(Box::new(TaggedValue {
        tag: Tag::new("!reset"),
        value: Value::Null,
    }))
}

/// Wrap a value in the `!override` merge tag (replace-not-merge).
fn override_tag(value: Value) -> Value {
    Value::Tagged(Box::new(TaggedValue {
        tag: Tag::new("!override"),
        value,
    }))
}

/// Wrap an existing field value in the `!override` tag (replace-not-merge).
fn override_in_place(service: &mut serde_yaml::Mapping, field: &str) {
    if let Some(existing) = service.remove(field) {
        service.insert(field.into(), override_tag(existing));
    }
}

fn kv(pairs: &[(&str, &str)]) -> dct::Environment {
    dct::Environment::KvPair(
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), Some(dct::SingleValue::String(v.to_string()))))
            .collect(),
    )
}

fn net_aliases(pairs: &[(&str, &[&str])]) -> dct::Networks {
    dct::Networks::Advanced(dct::AdvancedNetworks(
        pairs
            .iter()
            .map(|(net, aliases)| {
                (
                    net.to_string(),
                    dct::MapOrEmpty::Map(dct::AdvancedNetworkSettings {
                        aliases: aliases.iter().map(|a| a.to_string()).collect(),
                        ..Default::default()
                    }),
                )
            })
            .collect(),
    ))
}

fn ports_only(ports: Vec<String>) -> dct::Service {
    dct::Service {
        ports: dct::Ports::Short(ports),
        ..Default::default()
    }
}

/// The ordered compose file list run-local/run-dev/validate all use: the base
/// compose then the per-instance generated override.
pub fn compose_files(instance: &Instance) -> Vec<PathBuf> {
    vec![
        repo_root().join("docker/docker-compose.yml"),
        instance.artifact_dir().join("docker-compose.override.yml"),
    ]
}

/// A `docker compose` command wired for this instance.
pub fn docker_compose(
    instance: &Instance,
    files: &[PathBuf],
    generated_env: &std::path::Path,
) -> Command {
    let mut cmd = Command::new("docker");
    cmd.arg("compose")
        .arg("--project-directory")
        .arg(repo_root())
        .args(["-p", instance.project_name()]);
    for f in files {
        cmd.arg("-f").arg(f);
    }
    cmd.arg("--env-file").arg(generated_env);
    cmd.env("COMPOSE_PROJECT_NAME", instance.project_name());
    cmd.env("MACRO_ENV_FILE", generated_env);
    cmd
}
