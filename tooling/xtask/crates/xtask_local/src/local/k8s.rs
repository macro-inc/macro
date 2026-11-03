//! Full Macro environments on Kubernetes: `cargo x env up|down|list`.
//!
//! An environment is one namespace running the whole local stack (infra,
//! services, workers, proxy, static frontend), on either cluster target:
//!
//! - `kind`: a local cluster on this machine (`<name>.localhost`),
//! - `eks`: the shared environments cluster (`infra/stacks/environments-cluster`),
//!   reachable at `https://<name>.<domain>` for demos.
//!
//! Both targets install the same chart (`infra/k8s/macro-env`) with the same
//! rendered values. Those values come from the same inputs `run_local` uses,
//! the inventory, the generated env, Caddyfile, and FusionAuth kickstart,
//! translated from `docker compose config` by [`render`], so local, kind, and
//! EKS run one definition.
//!
//! `up` is idempotent create-or-update: images are tagged by content, so an
//! unchanged service keeps its pod, and provisioning (migrations, LocalStack,
//! Kafka topics, OpenSearch indices) is re-run safely.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use anyhow::{Context, Result, bail, ensure};
use clap::{Args, Subcommand, ValueEnum};
use serde_json::{Value, json};

use super::build::{BinariesDir, RUNTIME_IMAGE_TAG};
use super::cli::{BuildArgs, EnvArgs, RunArgs, TracesBackend};
use super::instance::{Instance, Port};
use super::local_env::Tunnels;
use super::stage::Stage;
use super::{Mode, db, frontend, gen_compose, kafka, localstack, opensearch, proxy, repo_root};

pub mod cluster;
pub mod render;

#[cfg(test)]
mod test;

use cluster::ClusterTarget;

/// The Helm chart every environment installs.
const CHART_DIR: &str = "infra/k8s/macro-env";

/// Namespace prefix and label that mark a namespace as a Macro environment.
const NAMESPACE_PREFIX: &str = "macro-";
const ENV_LABEL: &str = "macro.com/environment";

/// The Secret holding the shared env (`values.envSecret`).
const ENV_SECRET: &str = "macro-env";

/// The TLS Secret for the ingress on targets that terminate TLS in-cluster.
const TLS_SECRET: &str = "macro-env-tls";

/// How long `helm --wait` gives a phase. FusionAuth's first kickstart and a
/// cold image pull on a fresh node dominate.
const HELM_TIMEOUT: &str = "20m";

#[derive(Subcommand)]
pub enum EnvCmd {
    /// Create or update an environment.
    Up(UpArgs),
    /// Delete an environment and all of its data.
    Down(TargetArgs),
    /// List environments on a cluster target.
    List(ListArgs),
}

#[derive(Args, Clone)]
pub struct TargetArgs {
    /// Environment name: a DNS label, at most 30 characters.
    pub name: String,
    #[command(flatten)]
    pub cluster: ClusterArgs,
}

#[derive(Args, Clone)]
pub struct ListArgs {
    #[command(flatten)]
    pub cluster: ClusterArgs,
}

#[derive(Args, Clone)]
pub struct ClusterArgs {
    /// Which cluster runs the environment.
    #[arg(long, value_enum, default_value_t = TargetKind::Kind)]
    pub target: TargetKind,
    /// EKS: the environments cluster name.
    #[arg(long, default_value = cluster::EKS_CLUSTER)]
    pub eks_cluster: String,
    /// EKS: the wildcard domain environments are served under.
    #[arg(long, default_value = cluster::EKS_DOMAIN)]
    pub eks_domain: String,
    /// kind: the host port the cluster ingress listens on.
    #[arg(long, default_value_t = cluster::KIND_HTTPS_PORT)]
    pub kind_https_port: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum TargetKind {
    Kind,
    Eks,
}

#[derive(Args, Clone)]
pub struct UpArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    #[command(flatten)]
    pub env: EnvArgs,
    /// Skip building; reuse whatever is in the target dir.
    #[arg(long)]
    pub no_build: bool,
    /// Use this dir as the binaries source instead of building.
    #[arg(long)]
    pub binaries_dir: Option<PathBuf>,
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
}

/// Dispatch an `env` subcommand.
pub fn run(cmd: EnvCmd) -> Result<()> {
    match cmd {
        EnvCmd::Up(args) => up(&args),
        EnvCmd::Down(args) => down(&args),
        EnvCmd::List(args) => list(&args),
    }
}

/// A validated environment name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvName(String);

impl EnvName {
    pub fn parse(raw: &str) -> Result<Self> {
        let ok = !raw.is_empty()
            && raw.len() <= 30
            && raw
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !raw.starts_with('-')
            && !raw.ends_with('-');
        ensure!(
            ok,
            "environment name '{raw}' must be a DNS label: lowercase [a-z0-9-], at most 30 \
             characters, not starting or ending with '-'"
        );
        Ok(EnvName(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn namespace(&self) -> String {
        format!("{NAMESPACE_PREFIX}{}", self.0)
    }

    /// The compose instance the environment's inputs are generated under. Its
    /// own artifact dir and port window keep it apart from `run_local` stacks.
    pub fn instance(&self) -> Result<Instance> {
        Instance::derive(Some(&format!("env-{}", self.0)), None)
    }
}

fn up(args: &UpArgs) -> Result<()> {
    let stage = Stage::from_env_cli(args.verbose);
    let name = EnvName::parse(&args.target.name)?;
    let target = ClusterTarget::from_args(&args.target.cluster)?;
    let instance = name.instance()?;
    let host = target.host(&name);
    let origin = target.origin(&name);
    stage.section(&format!(
        "macro environment {} on {} — {origin}",
        name.as_str(),
        target.label()
    ));

    // The same preparation as `stack up`: resolved env, binaries, the
    // generated compose override, Caddyfile, and FusionAuth kickstart.
    let run_args = RunArgs {
        env: args.env.clone(),
        build: BuildArgs {
            no_build: args.no_build,
            build_aux_services: false,
            binaries_dir: args.binaries_dir.clone(),
        },
        verbose: args.verbose,
        traces: TracesBackend::Off,
        ..Default::default()
    };
    let (env, arch) = super::prepare(
        &stage,
        Mode::Local,
        &instance,
        &run_args,
        true,
        false,
        false,
        Tunnels::default(),
    )?;
    let binaries = match &args.binaries_dir {
        Some(dir) => BinariesDir::classify(dir)?,
        None => BinariesDir::TargetDir(super::workspace_root().join(arch.debug_dir())),
    };
    ensure!(
        !matches!(binaries, BinariesDir::NixStore(_)),
        "cluster environments bake binaries into an image; pass a cargo target dir, not a Nix \
         store path"
    );
    {
        let google = super::kickstart::GoogleIdp::from_env(&env.merged);
        let github = super::kickstart::GithubIdp::from_env(&env.merged);
        super::fusionauth::write_kickstart_for_origins(
            &instance,
            std::slice::from_ref(&origin),
            google.as_ref(),
            github.as_ref(),
        )?;
    }
    std::fs::write(
        gen_compose::caddyfile_path(&instance),
        proxy::caddyfile_for(Mode::Local, true, proxy::Flavor::Kubernetes),
    )
    .context("writing the Kubernetes Caddyfile")?;
    frontend::build_static(&stage, &instance, Mode::Local)?;

    let compose = compose_config(&instance, &env.generated_path)?;
    let rewrites = origin_rewrites(&instance, &origin)?;
    let shared_env: BTreeMap<String, String> = env
        .merged
        .iter()
        .map(|(k, v)| (k.clone(), render::rewrite(v, &rewrites)))
        .collect();

    let namespace = name.namespace();
    let dir = instance.ensure_artifact_dir()?.join("k8s");
    std::fs::create_dir_all(&dir)?;
    target.ensure_ready(&stage)?;
    let images = cluster::build_images(&stage, &target, &compose, &binaries, &dir)?;
    let rendered = render::render(
        &compose,
        &render::Inputs {
            shared_env: &env.merged,
            images: &images,
            rewrites: &rewrites,
        },
    )?;

    target.apply(
        &stage,
        &namespace_manifest(&name),
        &dir.join("namespace.json"),
    )?;
    let secret = env_secret(&namespace, &shared_env);
    target.apply(&stage, &secret, &dir.join("env-secret.json"))?;
    let tls_secret = match target.tls_secret(&instance)? {
        Some(tls) => {
            target.apply(
                &stage,
                &tls.manifest(&namespace),
                &dir.join("tls-secret.json"),
            )?;
            TLS_SECRET
        }
        None => "",
    };

    let values = json!({
        "host": host,
        "ingress": target.ingress_values(tls_secret),
        "envSecret": ENV_SECRET,
        "envDigest": digest(&secret.to_string()),
        "storageClass": target.storage_class(),
        "configMaps": rendered.config_maps,
        "workloads": rendered.workloads,
    });
    let values_path = dir.join("values.json");
    std::fs::write(&values_path, serde_json::to_string_pretty(&values)?)?;

    // A new environment starts its infra alone first, so services never boot
    // against an unmigrated database. An existing one keeps serving while it
    // is re-provisioned (migrations first, then the new services roll).
    if !target.release_exists(&name) {
        target.helm_install(&stage, &name, &values_path, true)?;
    }
    provision(&stage, &target, &name, &instance, &env.merged)?;
    target.helm_install(&stage, &name, &values_path, false)?;

    stage.section(&format!("environment {} is up", name.as_str()));
    stage.note(&format!("app:      {origin}/app/"));
    stage.note(&format!("mailpit:  {origin}/mailpit/ (login codes)"));
    stage.note(&format!(
        "kubectl:  kubectl --context {} -n {namespace} get pods",
        target.context()
    ));
    if let Some(note) = target.trust_note() {
        stage.note(&note);
    }
    Ok(())
}

fn down(args: &TargetArgs) -> Result<()> {
    let stage = Stage::from_env_cli(false);
    let name = EnvName::parse(&args.name)?;
    let target = ClusterTarget::from_args(&args.cluster)?;
    target.ensure_context(&stage)?;
    let namespace = name.namespace();
    let mut uninstall = target.helm();
    uninstall.args([
        "uninstall",
        name.as_str(),
        "-n",
        &namespace,
        "--ignore-not-found",
        "--wait",
    ]);
    stage.run(&format!("Uninstalling {}", name.as_str()), &mut uninstall)?;
    let mut delete = target.kubectl();
    delete.args([
        "delete",
        "namespace",
        &namespace,
        "--ignore-not-found",
        "--wait",
    ]);
    stage.run(
        &format!("Deleting namespace {namespace} (and its volumes)"),
        &mut delete,
    )
}

fn list(args: &ListArgs) -> Result<()> {
    let stage = Stage::from_env_cli(false);
    let target = ClusterTarget::from_args(&args.cluster)?;
    target.ensure_context(&stage)?;
    let out = target
        .kubectl()
        .args(["get", "namespaces", "-l", ENV_LABEL, "-o", "json"])
        .output()
        .context("running kubectl get namespaces")?;
    ensure!(
        out.status.success(),
        "kubectl get namespaces failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let parsed: Value = serde_json::from_slice(&out.stdout)?;
    for ns in parsed["items"].as_array().into_iter().flatten() {
        if let Some(env) = ns["metadata"]["labels"][ENV_LABEL].as_str() {
            let name = EnvName::parse(env)?;
            println!("{env}\t{}", target.origin(&name));
        }
    }
    Ok(())
}

/// The fully resolved compose project, as JSON.
fn compose_config(instance: &Instance, generated_env: &Path) -> Result<Value> {
    let files = gen_compose::compose_files(instance);
    let mut cmd = gen_compose::docker_compose(instance, &files, generated_env);
    cmd.args(["config", "--format", "json"]);
    let out = cmd.output().context("running docker compose config")?;
    ensure!(
        out.status.success(),
        "docker compose config failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).context("parsing docker compose config")
}

/// Browser-facing local origins in the generated env, mapped to the
/// environment's public origin. Order matters: longer, more specific origins
/// first, so a prefix of one is never rewritten inside another.
fn origin_rewrites(instance: &Instance, origin: &str) -> Result<Vec<(String, String)>> {
    let mut rewrites = vec![
        (frontend::https_origin(instance)?, origin.to_owned()),
        (proxy::url(instance), origin.to_owned()),
        (
            format!("http://localhost:{}", instance.port(Port::Auth)),
            format!("{origin}/auth"),
        ),
        (
            format!("http://localhost:{}", instance.port(Port::Frontend)),
            origin.to_owned(),
        ),
    ];
    rewrites.sort_by_key(|(from, _)| std::cmp::Reverse(from.len()));
    Ok(rewrites)
}

fn namespace_manifest(name: &EnvName) -> Value {
    json!({
        "apiVersion": "v1",
        "kind": "Namespace",
        "metadata": {
            "name": name.namespace(),
            "labels": { ENV_LABEL: name.as_str() },
        },
    })
}

fn env_secret(namespace: &str, env: &BTreeMap<String, String>) -> Value {
    json!({
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": { "name": ENV_SECRET, "namespace": namespace },
        "type": "Opaque",
        "stringData": env,
    })
}

/// A short stable digest, used to roll pods when the env Secret changes.
fn digest(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(input.as_bytes());
    hash.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Port-forward the infra Services to the instance's host ports and run the
/// same provisioning steps `run_local` runs against its containers.
fn provision(
    stage: &Stage,
    target: &ClusterTarget,
    name: &EnvName,
    instance: &Instance,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    let forwards = [
        ("postgres", Port::Postgres, 5432),
        ("localstack", Port::LocalStack, 4566),
        ("kafka", Port::Kafka, 9092),
        ("fusionauth", Port::FusionAuth, 9011),
        ("search", Port::OpenSearch, 9200),
    ];
    let mut children = PortForwards::default();
    for (svc, port, remote) in forwards {
        children.0.push(target.port_forward(
            &name.namespace(),
            svc,
            instance.port(port),
            remote,
        )?);
    }
    for (_, port, _) in forwards {
        wait_port(instance.port(port))?;
    }
    stage.run_step("Provisioning LocalStack", || {
        localstack::provision(instance)
    })?;
    db::migrate(stage, instance)?;
    stage.run_step("Creating Kafka topics", || kafka::provision(instance))?;
    super::fusionauth::wait_ready(stage, instance)?;
    opensearch::provision_indices(stage, instance, env)?;
    Ok(())
}

/// Child `kubectl port-forward` processes, killed on drop.
#[derive(Default)]
struct PortForwards(Vec<Child>);

impl Drop for PortForwards {
    fn drop(&mut self) {
        for child in &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn wait_port(port: u16) -> Result<()> {
    for _ in 0..120 {
        if super::summary::port_open(port) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    bail!("port-forward to localhost:{port} did not open")
}

/// The image the Rust services run: the runtime image plus every binary a
/// compose service runs from `/app/out`, stripped of debug info.
pub(super) fn services_image_context(
    compose: &Value,
    binaries: &BinariesDir,
    dir: &Path,
) -> Result<PathBuf> {
    let ctx = dir.join("services-image");
    if ctx.exists() {
        std::fs::remove_dir_all(&ctx)?;
    }
    std::fs::create_dir_all(ctx.join("out"))?;
    for bin in runtime_binaries(compose)? {
        let src = binaries.host_dir().join(&bin);
        ensure!(src.is_file(), "missing binary {}", src.display());
        let dest = ctx.join("out").join(&bin);
        let status = Command::new("objcopy")
            .args(["--strip-debug"])
            .arg(&src)
            .arg(&dest)
            .stdout(Stdio::null())
            .status()
            .context("running objcopy (run inside nix develop)")?;
        ensure!(
            status.success(),
            "objcopy --strip-debug {} failed",
            src.display()
        );
    }
    std::fs::write(
        ctx.join("Dockerfile"),
        format!("FROM {RUNTIME_IMAGE_TAG}\nCOPY out/ /app/out/\n"),
    )?;
    Ok(ctx)
}

/// Binaries the compose services run from the runtime image (`/app/out/<bin>`).
pub fn runtime_binaries(compose: &Value) -> Result<Vec<String>> {
    let mut bins: Vec<String> = render::services(compose)?
        .into_iter()
        .filter(|(_, svc)| svc.get("image").and_then(Value::as_str) == Some(RUNTIME_IMAGE_TAG))
        .filter_map(|(_, svc)| svc.get("command")?.as_array()?.first()?.as_str())
        .filter_map(|cmd| cmd.strip_prefix("/app/out/"))
        .map(str::to_owned)
        .collect();
    bins.sort();
    bins.dedup();
    Ok(bins)
}

/// The chart directory, for `helm upgrade --install`.
pub(super) fn chart_dir() -> PathBuf {
    repo_root().join(CHART_DIR)
}
