//! Render the resolved local compose project into `infra/k8s/macro-env` values.
//!
//! The input is `docker compose config --format json` for the same files and
//! generated env `run_local` uses, so a cluster environment runs exactly the
//! containers, commands, environment, and health checks of the local stack.
//! Only what has no Kubernetes equivalent is translated:
//!
//! - compose service names become DNS-1035 names (`_` → `-`); network aliases
//!   become extra Services,
//! - named volumes become PVCs; small bind-mounted files and directories become
//!   ConfigMaps; large bind mounts (the frontend bundle, source trees) are baked
//!   into images by the caller ([`large_bind_mounts`]),
//! - the shared env file becomes one Secret loaded with `envFrom`; each
//!   workload keeps only the values that differ from it.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use serde_json::Value;

#[cfg(test)]
mod test;

/// Compose services that exist only to bridge into the host and have no
/// meaning inside a cluster.
const HOST_ONLY_SERVICES: &[&str] = &["sdk-webhook-relay"];

/// Bind mounts that have no cluster equivalent. The binaries directory is
/// baked into the services image instead; sandboxes need a cluster provider
/// (Daytona), not the host Docker socket.
const DROPPED_MOUNT_TARGETS: &[&str] = &["/app/out", "/nix/store", "/var/run/docker.sock"];

/// Workloads started in the infra phase, before migrations and provisioning.
const INFRA_SERVICES: &[&str] = &[
    "postgres",
    "redis",
    "kafka",
    "search",
    "localstack",
    "db",
    "fusionauth",
    "mailpit",
];

/// Ports a container listens on that compose never declares, because nothing
/// publishes them: compose reaches every port on the network, a Service only
/// the ones it lists.
const UNDECLARED_PORTS: &[(&str, &[u16])] = &[
    ("db", &[5432]),
    // The in-network broker listener and the KRaft controller.
    ("kafka", &[29092, 29093]),
    ("agent-harness-service", &[8080, 8102, 8111, 2222]),
    ("whatsapp-session-service", &[8080]),
    ("search-processing-service", &[8080]),
    ("websocket-service", &[6969]),
];

/// The port the Kubernetes proxy listens on (see `proxy::Flavor::Kubernetes`).
pub const PROXY_PORT: u16 = 8080;

/// A bind mount or file larger than this is baked into an image rather than
/// shipped as a ConfigMap (whose hard limit is 1 MiB).
const CONFIG_MAP_BUDGET: u64 = 512 * 1024;

/// One rendered workload (see `infra/k8s/macro-env/values.yaml`).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workload {
    pub name: String,
    pub infra: bool,
    pub image: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub command: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    pub shared_env: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<u16>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<Probe>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub volumes: Vec<Volume>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<FileMount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub termination_grace_period_seconds: Option<u64>,
    pub resources: Resources,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub exec: Vec<String>,
    pub period_seconds: u64,
    pub timeout_seconds: u64,
    pub failure_threshold: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub name: String,
    pub mount_path: String,
    pub size: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileMount {
    pub config_map: String,
    pub mount_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Resources {
    pub requests: ResourceRequests,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ResourceRequests {
    pub cpu: &'static str,
    pub memory: &'static str,
}

/// The rendered chart input: workloads plus the ConfigMaps they mount.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub workloads: Vec<Workload>,
    pub config_maps: BTreeMap<String, BTreeMap<String, String>>,
}

/// A bind mount too large for a ConfigMap, which the caller bakes into the
/// service's image (`COPY <source> <target>`).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct BakedMount {
    pub service: String,
    pub source: PathBuf,
    pub target: String,
}

/// What the renderer needs beyond the compose project itself.
pub struct Inputs<'a> {
    /// The shared env file every `x-common-env` service loads.
    pub shared_env: &'a BTreeMap<String, String>,
    /// Compose service name → image reference, for every service whose image
    /// the caller built (compose `build:`, the services bundle, baked mounts).
    /// Other services keep their compose `image:`.
    pub images: &'a BTreeMap<String, String>,
    /// Substring rewrites applied to every env value (browser-facing local
    /// origins → the environment's public origin).
    pub rewrites: &'a [(String, String)],
}

/// The DNS-1035 name for a compose service or alias.
pub fn dns_name(compose_name: &str) -> String {
    compose_name.replace('_', "-").to_ascii_lowercase()
}

/// The compose services that become workloads, in project order.
pub fn services(compose: &Value) -> Result<Vec<(&str, &Value)>> {
    let services = compose
        .get("services")
        .and_then(Value::as_object)
        .context("compose config has no services")?;
    Ok(services
        .iter()
        .filter(|(name, _)| !HOST_ONLY_SERVICES.contains(&name.as_str()))
        .map(|(name, svc)| (name.as_str(), svc))
        .collect())
}

/// Bind mounts that must be baked into images (see [`BakedMount`]).
pub fn large_bind_mounts(compose: &Value) -> Result<Vec<BakedMount>> {
    let mut out = Vec::new();
    for (name, svc) in services(compose)? {
        for mount in bind_mounts(svc) {
            if !fits_config_map(&mount.source)? {
                out.push(BakedMount {
                    service: name.to_owned(),
                    source: mount.source,
                    target: mount.target,
                });
            }
        }
    }
    Ok(out)
}

/// Render every workload and ConfigMap.
pub fn render(compose: &Value, inputs: &Inputs<'_>) -> Result<Rendered> {
    let mut rendered = Rendered::default();
    for (name, svc) in services(compose)? {
        let workload = render_service(name, svc, inputs, &mut rendered.config_maps)?;
        rendered.workloads.push(workload);
    }
    Ok(rendered)
}

/// Apply [`Inputs::rewrites`] to one value.
pub fn rewrite(value: &str, rewrites: &[(String, String)]) -> String {
    rewrites
        .iter()
        .fold(value.to_owned(), |v, (from, to)| v.replace(from, to))
}

fn render_service(
    compose_name: &str,
    svc: &Value,
    inputs: &Inputs<'_>,
    config_maps: &mut BTreeMap<String, BTreeMap<String, String>>,
) -> Result<Workload> {
    let name = dns_name(compose_name);
    let image = match inputs.images.get(compose_name) {
        Some(image) => image.clone(),
        None => svc
            .get("image")
            .and_then(Value::as_str)
            .with_context(|| format!("compose service {compose_name} has no image"))?
            .to_owned(),
    };

    let service_env = string_map(svc.get("environment"));
    let shared_env = !inputs.shared_env.is_empty()
        && inputs
            .shared_env
            .keys()
            .all(|k| service_env.contains_key(k));
    let mut env: BTreeMap<String, String> = service_env
        .into_iter()
        .filter(|(k, v)| !shared_env || inputs.shared_env.get(k) != Some(v))
        .map(|(k, v)| {
            let v = rewrite(&v, inputs.rewrites);
            (k, v)
        })
        .collect();
    let mut ports = declared_ports(svc);
    if name == "proxy" {
        // Caddy's Kubernetes listener is fixed; the compose one is the
        // instance's host port.
        ports = vec![PROXY_PORT];
        env.insert("PROXY_PORT".into(), PROXY_PORT.to_string());
    }
    if name == "search" {
        // A pod can't raise RLIMIT_MEMLOCK, and single-node discovery skips
        // the bootstrap check that would require it.
        env.insert("bootstrap.memory_lock".into(), "false".into());
    }
    for (svc_name, extra) in UNDECLARED_PORTS {
        if *svc_name == name {
            ports.extend(extra.iter().copied());
        }
    }
    ports.sort_unstable();
    ports.dedup();

    let mut volumes = Vec::new();
    for mount in mounts(svc, "volume") {
        volumes.push(Volume {
            name: dns_name(&mount.source.display().to_string()),
            mount_path: mount.target,
            size: volume_size(&name).to_owned(),
        });
    }

    let mut files = Vec::new();
    for mount in bind_mounts(svc) {
        if !fits_config_map(&mount.source)? {
            // Baked into the image by the caller.
            continue;
        }
        let cm = format!("{name}-files-{}", files.len());
        let (data, sub_path) = config_map_data(&mount.source)?;
        config_maps.insert(cm.clone(), data);
        files.push(FileMount {
            config_map: cm,
            mount_path: mount.target,
            sub_path,
        });
    }

    let aliases: Vec<String> = svc
        .get("networks")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|nets| nets.values())
        .filter_map(|net| net.get("aliases").and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_str)
        .map(dns_name)
        .filter(|alias| *alias != name)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    Ok(Workload {
        infra: INFRA_SERVICES.contains(&name.as_str()),
        image,
        command: string_list(svc.get("entrypoint")),
        args: string_list(svc.get("command")),
        env,
        shared_env,
        ports,
        aliases,
        probe: probe(svc.get("healthcheck"))?,
        volumes,
        files,
        termination_grace_period_seconds: svc
            .get("stop_grace_period")
            .and_then(Value::as_str)
            .map(parse_duration)
            .transpose()?,
        resources: resources(&name),
        name,
    })
}

struct Mount {
    source: PathBuf,
    target: String,
}

fn mounts(svc: &Value, kind: &str) -> Vec<Mount> {
    svc.get("volumes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| m.get("type").and_then(Value::as_str) == Some(kind))
        .filter_map(|m| {
            Some(Mount {
                source: PathBuf::from(m.get("source")?.as_str()?),
                target: m.get("target")?.as_str()?.to_owned(),
            })
        })
        .filter(|m| !DROPPED_MOUNT_TARGETS.contains(&m.target.as_str()))
        .collect()
}

/// Bind mounts with content. Compose creates a missing source as an empty
/// directory, and an empty directory (a state dir the container writes into)
/// is the same as no mount in a pod, whose filesystem is writable anyway.
fn bind_mounts(svc: &Value) -> Vec<Mount> {
    mounts(svc, "bind")
        .into_iter()
        .filter(|m| {
            m.source.is_file() || std::fs::read_dir(&m.source).is_ok_and(|mut d| d.next().is_some())
        })
        .collect()
}

/// Whether a bind-mount source is small enough (and flat enough) to ship as a
/// ConfigMap.
fn fits_config_map(source: &Path) -> Result<bool> {
    let meta = std::fs::metadata(source)
        .with_context(|| format!("bind mount source {} does not exist", source.display()))?;
    if meta.is_file() {
        return Ok(meta.len() <= CONFIG_MAP_BUDGET);
    }
    let mut total = 0;
    for entry in std::fs::read_dir(source)
        .with_context(|| format!("reading bind mount source {}", source.display()))?
    {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            return Ok(false);
        }
        total += meta.len();
    }
    Ok(total <= CONFIG_MAP_BUDGET)
}

/// ConfigMap data for a file (one key, mounted by `subPath`) or a flat
/// directory (one key per file, mounted as the directory).
fn config_map_data(source: &Path) -> Result<(BTreeMap<String, String>, Option<String>)> {
    let read =
        |p: &Path| std::fs::read_to_string(p).with_context(|| format!("reading {}", p.display()));
    if source.is_file() {
        let key = file_key(source)?;
        let data = BTreeMap::from([(key.clone(), read(source)?)]);
        return Ok((data, Some(key)));
    }
    let mut data = BTreeMap::new();
    for entry in std::fs::read_dir(source)? {
        let path = entry?.path();
        data.insert(file_key(&path)?, read(&path)?);
    }
    Ok((data, None))
}

fn file_key(path: &Path) -> Result<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(str::to_owned)
        .with_context(|| format!("{} has no file name", path.display()))
}

fn declared_ports(svc: &Value) -> Vec<u16> {
    let published = svc
        .get("ports")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| p.get("target").and_then(Value::as_u64));
    let exposed = svc
        .get("expose")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| match p {
            Value::String(s) => s.split('/').next()?.parse::<u64>().ok(),
            Value::Number(n) => n.as_u64(),
            _ => None,
        });
    published
        .chain(exposed)
        .filter_map(|p| u16::try_from(p).ok())
        .collect()
}

fn probe(healthcheck: Option<&Value>) -> Result<Option<Probe>> {
    let Some(hc) = healthcheck else {
        return Ok(None);
    };
    if hc.get("disable").and_then(Value::as_bool) == Some(true) {
        return Ok(None);
    }
    let test = string_list(hc.get("test"));
    let exec = match test.split_first() {
        Some((kind, rest)) if kind == "CMD" => rest.to_vec(),
        Some((kind, rest)) if kind == "CMD-SHELL" => {
            vec!["sh".into(), "-c".into(), rest.join(" ")]
        }
        Some((kind, _)) if kind == "NONE" => return Ok(None),
        // Compose's bare-string form runs through the shell.
        Some(_) => vec!["sh".into(), "-c".into(), test.join(" ")],
        None => return Ok(None),
    };
    let secs = |key: &str, default: u64| -> Result<u64> {
        hc.get(key)
            .and_then(Value::as_str)
            .map(parse_duration)
            .transpose()
            .map(|v| v.unwrap_or(default).max(1))
    };
    Ok(Some(Probe {
        exec,
        period_seconds: secs("interval", 10)?,
        timeout_seconds: secs("timeout", 10)?,
        failure_threshold: hc
            .get("retries")
            .and_then(Value::as_u64)
            .unwrap_or(3)
            .max(1),
    }))
}

/// Parse a compose duration (`30s`, `1m30s`, `500ms`, `2h`) into whole seconds.
pub fn parse_duration(raw: &str) -> Result<u64> {
    let mut total_ms: u64 = 0;
    let mut digits = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            digits.push(c);
            continue;
        }
        let mut unit = c.to_string();
        if c == 'm' && chars.peek() == Some(&'s') {
            unit.push('s');
            chars.next();
        }
        let n: u64 = digits
            .parse()
            .with_context(|| format!("invalid duration {raw:?}"))?;
        digits.clear();
        total_ms += n * match unit.as_str() {
            "ms" => 1,
            "s" => 1_000,
            "m" => 60_000,
            "h" => 3_600_000,
            _ => bail!("invalid duration unit in {raw:?}"),
        };
    }
    if !digits.is_empty() {
        bail!("duration {raw:?} has no unit");
    }
    Ok(total_ms / 1_000)
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|i| i.as_str().map(str::to_owned))
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn string_map(v: Option<&Value>) -> BTreeMap<String, String> {
    v.and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| {
            let v = match v {
                Value::String(s) => s.clone(),
                Value::Null => return None,
                other => other.to_string(),
            };
            Some((k.clone(), v))
        })
        .collect()
}

fn volume_size(name: &str) -> &'static str {
    match name {
        "postgres" | "search" | "kafka" => "10Gi",
        _ => "2Gi",
    }
}

/// Scheduling requests. Limits stay unset, as in compose.
fn resources(name: &str) -> Resources {
    let (cpu, memory) = match name {
        "search" => ("250m", "1Gi"),
        "fusionauth" | "kafka" => ("250m", "768Mi"),
        "postgres" | "localstack" => ("250m", "512Mi"),
        "sync-service" | "lexical-service" | "ai-editing-worker" => ("100m", "512Mi"),
        _ => ("50m", "128Mi"),
    };
    Resources {
        requests: ResourceRequests { cpu, memory },
    }
}
