//! Macro instances on the local k3s cluster: `cargo x platform up|dev|down`.
//!
//! The cluster and everything it runs is declared in Nix (`infra/platform`,
//! see docs/design/kubernetes-platform.md). This module is the operator's
//! loop around it: it supplies what must not live in the Nix store (the
//! resolved environment and FusionAuth kickstart, as Secrets), builds the
//! host-side artifacts the fast loop feeds Nix (Cargo binaries, the frontend
//! bundle), asks Nix for the instance's manifests, and applies them.
//!
//! Images are store paths (`nix:0/nix/store/...`), resolved by the node's nix
//! snapshotter from this machine's own store, so nothing is pushed: changing a
//! service is a Cargo build, one Nix build, and one Deployment rollout.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use anyhow::{Context, Result, bail, ensure};
use clap::{Args, Subcommand};
use serde_json::{Value, json};

use super::cli::EnvArgs;
use super::instance::{Instance, Port};
use super::local_env::Tunnels;
use super::proxy::{self, Flavor};
use super::stage::Stage;
use super::{
    Mode, db, env_layer, frontend, fusionauth, gen_compose, inventory, kafka, kickstart,
    localstack, opensearch, repo_root, tls,
};

#[cfg(test)]
mod test;

/// kubeconfig k3s writes on the host (see the big-pickle k3s module).
const KUBECONFIG: &str = "/etc/rancher/k3s/k3s.yaml";
/// Host port the cluster ingress listens on (loopback only).
const INGRESS_PORT: u16 = 9443;
/// The edge config generated from the service inventory, checked in.
pub const CADDYFILE: &str = "infra/platform/generated/Caddyfile";
/// Features the platform builds of Rust services enable (same as `run_local`).
const AUTH_FEATURES: &str =
    "authentication_service/return_passwordless_code,authentication_service/no_rate_limit";

#[derive(Subcommand)]
pub enum PlatformCmd {
    /// Create or update an instance.
    Up(UpArgs),
    /// Rebuild one or more services and roll only their pods.
    Dev(DevArgs),
    /// Delete an instance and all of its data.
    Down(NameArg),
    /// Regenerate the checked-in edge Caddyfile from the service inventory.
    Caddyfile,
}

#[derive(Args, Clone)]
pub struct NameArg {
    /// Instance name: a DNS label, at most 30 characters.
    #[arg(default_value = "demo")]
    pub name: String,
}

#[derive(Args, Clone)]
pub struct UpArgs {
    #[command(flatten)]
    pub name: NameArg,
    #[command(flatten)]
    pub env: EnvArgs,
    /// Reuse the binaries and frontend bundle from the last build.
    #[arg(long)]
    pub no_build: bool,
    /// Stream subprocess output and show per-step timings.
    #[arg(long, short)]
    pub verbose: bool,
}

#[derive(Args, Clone)]
pub struct DevArgs {
    /// Workloads to rebuild (e.g. `email-service`).
    #[arg(required = true)]
    pub workloads: Vec<String>,
    #[arg(long, default_value = "demo")]
    pub instance: String,
    #[arg(long, short)]
    pub verbose: bool,
}

pub fn run(cmd: PlatformCmd) -> Result<()> {
    match cmd {
        PlatformCmd::Up(args) => up(&args),
        PlatformCmd::Dev(args) => dev(&args),
        PlatformCmd::Down(args) => down(&args),
        PlatformCmd::Caddyfile => {
            let path = repo_root().join(CADDYFILE);
            std::fs::write(&path, caddyfile())?;
            println!("{}", path.display());
            Ok(())
        }
    }
}

/// The edge Caddyfile: the local stack's routes, Kubernetes listener.
pub fn caddyfile() -> String {
    proxy::caddyfile_for(Mode::Local, true, Flavor::Kubernetes)
}

/// A validated instance name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstanceName(String);

impl InstanceName {
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
            "instance name '{raw}' must be a DNS label: lowercase [a-z0-9-], at most 30 \
             characters, not starting or ending with '-'"
        );
        Ok(Self(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn namespace(&self) -> String {
        format!("macro-{}", self.0)
    }

    pub fn host(&self) -> String {
        format!("{}.localhost", self.0)
    }

    pub fn origin(&self) -> String {
        format!("https://{}:{INGRESS_PORT}", self.host())
    }

    /// The compose-style instance whose artifact dir and port window hold this
    /// instance's generated inputs and provisioning port-forwards.
    pub fn local_instance(&self) -> Result<Instance> {
        Instance::derive(Some(&format!("platform-{}", self.0)), None)
    }
}

/// Recorded between runs so `dev` can rebuild one service and reuse the rest.
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct State {
    /// cargo bin -> wrapped store path.
    binaries: BTreeMap<String, String>,
    /// The frontend bundle's store path.
    frontend: Option<String>,
    env_revision: String,
}

fn state_path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("platform-state.json")
}

fn read_state(instance: &Instance) -> State {
    std::fs::read_to_string(state_path(instance))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_state(instance: &Instance, state: &State) -> Result<()> {
    instance.ensure_artifact_dir()?;
    std::fs::write(state_path(instance), serde_json::to_string_pretty(state)?)?;
    Ok(())
}

/// The cargo bin each Rust workload runs (the inventory, k8s names).
pub fn rust_workloads() -> BTreeMap<String, &'static str> {
    inventory::RUST_SERVICES
        .iter()
        .filter(|s| s.in_mode(Mode::Local))
        .map(|s| {
            (
                proxy::Flavor::Kubernetes.upstream(s.compose_name),
                s.cargo_bin,
            )
        })
        .collect()
}

fn up(args: &UpArgs) -> Result<()> {
    let stage = Stage::from_env_cli(args.verbose);
    let name = InstanceName::parse(&args.name.name)?;
    let instance = name.local_instance()?;
    stage.section(&format!(
        "macro instance {} — {}/app/",
        name.as_str(),
        name.origin()
    ));

    // The environment and identity, exactly as `run_local` resolves them, with
    // the browser-facing origin swapped for the instance's.
    let env = env_layer::resolve(
        Mode::Local,
        &instance,
        args.env.no_doppler,
        args.env.env_file.as_deref(),
        true,
        Tunnels::default(),
        false,
    )?;
    let rewrites = origin_rewrites(&instance, &name.origin())?;
    let shared_env: BTreeMap<String, String> = env
        .merged
        .iter()
        .map(|(k, v)| (k.clone(), rewrite(v, &rewrites)))
        .collect();
    let google = kickstart::GoogleIdp::from_env(&env.merged);
    let github = kickstart::GithubIdp::from_env(&env.merged);
    fusionauth::write_kickstart_for_origins(
        &instance,
        &[name.origin()],
        google.as_ref(),
        github.as_ref(),
    )?;
    let kickstart_json =
        std::fs::read_to_string(gen_compose::kickstart_dir(&instance).join("kickstart.json"))?;
    tls::issue(&instance)?;

    let mut state = read_state(&instance);
    if !args.no_build || state.binaries.is_empty() {
        let bins: Vec<&str> = rust_workloads().into_values().collect();
        cargo_build(&stage, &bins)?;
        frontend::build_static(&stage, &instance, Mode::Local)?;
        state.binaries = wrap_binaries(&stage, &bins)?;
        state.frontend = Some(store_dir(
            &stage,
            "macro-frontend",
            &frontend::static_dir(&instance),
        )?);
    }
    state.env_revision = digest(&serde_json::to_string(&shared_env)?);
    write_state(&instance, &state)?;

    let manifests = build_manifests(&stage, &name, &state)?;
    let cluster = build_cluster_manifests(&stage)?;
    apply_list(&stage, "cluster ingress", &cluster)?;

    let namespace = name.namespace();
    apply_items(&stage, "namespace", &[namespace_of(&manifests)?])?;
    apply_items(
        &stage,
        "secrets",
        &[
            secret(&namespace, "macro-env", "Opaque", &shared_env),
            secret(
                &namespace,
                "fusionauth-kickstart",
                "Opaque",
                &BTreeMap::from([("kickstart.json".to_owned(), kickstart_json)]),
            ),
            secret(
                &namespace,
                "macro-tls",
                "kubernetes.io/tls",
                &BTreeMap::from([
                    (
                        "tls.crt".to_owned(),
                        std::fs::read_to_string(tls::certs_dir(&instance).join("server.pem"))?,
                    ),
                    (
                        "tls.key".to_owned(),
                        std::fs::read_to_string(tls::certs_dir(&instance).join("server-key.pem"))?,
                    ),
                ]),
            ),
        ],
    )?;

    // Infra first, so services never boot against an unmigrated database;
    // then the same provisioning `run_local` runs; then everything.
    let infra = items_with_tier(&manifests, "infra");
    apply_items(&stage, "infra", &infra)?;
    wait_ready(&stage, &namespace, Some("infra"))?;
    provision(&stage, &name, &instance, &env.merged)?;
    let all = items(&manifests);
    apply_items(&stage, "services", &all)?;
    prune(&stage, &name, &all)?;
    wait_ready(&stage, &namespace, None)?;

    stage.section(&format!("instance {} is up", name.as_str()));
    stage.note(&format!("app:      {}/app/", name.origin()));
    stage.note(&format!(
        "mailpit:  {}/mailpit/ (login codes)",
        name.origin()
    ));
    stage.note(&format!("kubectl:  kubectl -n {namespace} get pods"));
    stage.note(&format!(
        "tls:      trust {} once",
        repo_root().join("infra/local/certs/ca.pem").display()
    ));
    Ok(())
}

fn dev(args: &DevArgs) -> Result<()> {
    let stage = Stage::from_env_cli(args.verbose);
    let name = InstanceName::parse(&args.instance)?;
    let instance = name.local_instance()?;
    let mut state = read_state(&instance);
    ensure!(
        !state.binaries.is_empty(),
        "instance {} has no recorded build; run `just platform up {}` first",
        name.as_str(),
        name.as_str()
    );
    let workloads = rust_workloads();
    let mut bins = Vec::new();
    for w in &args.workloads {
        match workloads.get(w) {
            Some(bin) => bins.push(*bin),
            None => bail!(
                "{w} is not a Rust workload; known: {}",
                workloads.keys().cloned().collect::<Vec<_>>().join(", ")
            ),
        }
    }
    cargo_build(&stage, &bins)?;
    state.binaries.extend(wrap_binaries(&stage, &bins)?);
    write_state(&instance, &state)?;
    let manifests = build_manifests(&stage, &name, &state)?;
    let changed: Vec<Value> = items(&manifests)
        .into_iter()
        .filter(|item| {
            item["kind"] == "Deployment"
                && item["metadata"]["name"]
                    .as_str()
                    .is_some_and(|n| args.workloads.iter().any(|w| w == n))
        })
        .collect();
    apply_items(&stage, "changed deployments", &changed)?;
    for w in &args.workloads {
        let mut cmd = kubectl();
        cmd.args([
            "-n",
            &name.namespace(),
            "rollout",
            "status",
            &format!("deploy/{w}"),
            "--timeout=5m",
        ]);
        stage.run(&format!("Rolling {w}"), &mut cmd)?;
    }
    Ok(())
}

fn down(args: &NameArg) -> Result<()> {
    let stage = Stage::from_env_cli(false);
    let name = InstanceName::parse(&args.name)?;
    let mut cmd = kubectl();
    cmd.args([
        "delete",
        "namespace",
        &name.namespace(),
        "--ignore-not-found",
        "--wait",
    ]);
    stage.run(
        &format!("Deleting {} and its volumes", name.namespace()),
        &mut cmd,
    )
}

fn kubectl() -> Command {
    let mut cmd = Command::new("kubectl");
    cmd.env("KUBECONFIG", KUBECONFIG);
    cmd
}

fn cargo_build(stage: &Stage, bins: &[&str]) -> Result<()> {
    let (isolated, unified): (Vec<&str>, Vec<&str>) = bins.iter().partition(|b| {
        inventory::RUST_SERVICES
            .iter()
            .any(|s| s.cargo_bin == **b && s.no_default_features)
    });
    if !unified.is_empty() {
        let mut cmd = Command::new("cargo");
        cmd.current_dir(repo_root())
            .env("SQLX_OFFLINE", "true")
            .arg("build");
        for b in &unified {
            cmd.args(["--bin", b]);
        }
        cmd.args(["--features", AUTH_FEATURES]);
        stage.run("Building service binaries (cargo)", &mut cmd)?;
    }
    for bin in isolated {
        let svc = inventory::RUST_SERVICES
            .iter()
            .find(|s| s.cargo_bin == bin)
            .context("unknown isolated binary")?;
        let mut cmd = Command::new("cargo");
        cmd.current_dir(repo_root())
            .env("SQLX_OFFLINE", "true")
            .args([
                "build",
                "-p",
                svc.package,
                "--no-default-features",
                "--bin",
                bin,
            ])
            .args(["--features", &svc.local_features().join(",")])
            .args(["--target-dir", "target/no-default"]);
        stage.run(&format!("Building {bin} (no default features)"), &mut cmd)?;
    }
    Ok(())
}

/// Where Cargo left `bin` (see [`cargo_build`]).
fn binary_path(bin: &str) -> PathBuf {
    let isolated = inventory::RUST_SERVICES
        .iter()
        .any(|s| s.cargo_bin == bin && s.no_default_features);
    let dir = if isolated {
        "target/no-default/debug"
    } else {
        "target/debug"
    };
    repo_root().join(dir).join(bin)
}

fn flake_ref() -> String {
    format!("git+file://{}", repo_root().display())
}

/// `nix build --impure --expr` with the repository flake bound to `f`.
fn nix_build(stage: &Stage, label: &str, expr: &str) -> Result<Vec<String>> {
    let full = format!(
        "let f = builtins.getFlake \"{}\"; p = f.platform; in {expr}",
        flake_ref()
    );
    let mut cmd = Command::new("nix");
    cmd.args([
        "build",
        "--impure",
        "--no-link",
        "--print-out-paths",
        "--expr",
        &full,
    ]);
    let mut out = None;
    stage.run_step(label, || {
        let o = cmd.output().context("running nix build")?;
        ensure!(
            o.status.success(),
            "nix build failed:\n{}",
            String::from_utf8_lossy(&o.stderr)
        );
        out = Some(String::from_utf8(o.stdout)?);
        Ok(())
    })?;
    Ok(out.unwrap_or_default().lines().map(str::to_owned).collect())
}

fn wrap_binaries(stage: &Stage, bins: &[&str]) -> Result<BTreeMap<String, String>> {
    let mut out = BTreeMap::new();
    for bin in bins {
        let path = binary_path(bin);
        ensure!(path.is_file(), "missing {}", path.display());
        let dir = path.parent().context("binary has no parent")?;
        let expr = format!("(p.wrapBinaries \"{}\" [ \"{bin}\" ]).{bin}", dir.display());
        let paths = nix_build(stage, &format!("Wrapping {bin} as a store path"), &expr)?;
        out.insert(
            (*bin).to_owned(),
            paths
                .into_iter()
                .next()
                .context("nix build printed no path")?,
        );
    }
    Ok(out)
}

fn store_dir(stage: &Stage, name: &str, dir: &Path) -> Result<String> {
    let o = Command::new("nix")
        .args(["store", "add", "--name", name])
        .arg(dir)
        .output()
        .context("running nix store add")?;
    ensure!(
        o.status.success(),
        "nix store add failed: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    let path = String::from_utf8(o.stdout)?.trim().to_owned();
    stage.note(&format!("{name}: {path}"));
    Ok(path)
}

/// Build the instance's images and manifests (one derivation) and read them.
fn build_manifests(stage: &Stage, name: &InstanceName, state: &State) -> Result<Value> {
    let binaries = state
        .binaries
        .iter()
        .map(|(bin, path)| format!("\"{bin}\" = builtins.storePath \"{path}\";"))
        .collect::<Vec<_>>()
        .join(" ");
    let frontend = state
        .frontend
        .as_deref()
        .context("no frontend bundle recorded")?;
    let kafka_port = name.local_instance()?.port(Port::Kafka);
    let expr = format!(
        "let i = p.instance {{ name = \"{}\"; host = \"{}\"; envRevision = \"{}\"; \
         kafkaHostPort = {kafka_port}; \
         binaries = {{ {binaries} }}; frontend = builtins.storePath \"{frontend}\"; }}; \
         in (import f.inputs.nixpkgs {{ system = \"x86_64-linux\"; }}).writeText \
         \"{}-manifests.json\" (builtins.toJSON i.manifests)",
        name.as_str(),
        name.host(),
        state.env_revision,
        name.namespace()
    );
    let paths = nix_build(stage, "Building images and manifests (nix)", &expr)?;
    let path = paths.first().context("nix build printed no path")?;
    serde_json::from_str(&std::fs::read_to_string(path)?).context("parsing manifests")
}

fn build_cluster_manifests(stage: &Stage) -> Result<Value> {
    let expr = "(import f.inputs.nixpkgs { system = \"x86_64-linux\"; }).writeText \
                \"cluster-manifests.json\" (builtins.toJSON p.cluster)";
    let paths = nix_build(stage, "Building cluster manifests (nix)", expr)?;
    let path = paths.first().context("nix build printed no path")?;
    serde_json::from_str(&std::fs::read_to_string(path)?).context("parsing manifests")
}

pub fn items(list: &Value) -> Vec<Value> {
    list["items"].as_array().cloned().unwrap_or_default()
}

pub fn items_with_tier(list: &Value, tier: &str) -> Vec<Value> {
    items(list)
        .into_iter()
        .filter(|i| {
            let kind = i["kind"].as_str().unwrap_or("");
            // Namespace-level policy and storage come with the infra.
            matches!(kind, "NetworkPolicy" | "PersistentVolumeClaim")
                || i["metadata"]["labels"]["macro.com/tier"] == tier
        })
        .collect()
}

fn namespace_of(list: &Value) -> Result<Value> {
    items(list)
        .into_iter()
        .find(|i| i["kind"] == "Namespace")
        .context("instance manifests have no Namespace")
}

fn apply_list(stage: &Stage, label: &str, list: &Value) -> Result<()> {
    apply_items(stage, label, &items(list))
}

fn apply_items(stage: &Stage, label: &str, items: &[Value]) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    let list = json!({ "apiVersion": "v1", "kind": "List", "items": items });
    let mut cmd = kubectl();
    cmd.args([
        "apply",
        "--server-side",
        "--force-conflicts",
        "--field-manager=macro-platform",
        "-f",
        "-",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::null());
    stage.run_step(&format!("Applying {label}"), || {
        let mut child = cmd.spawn().context("running kubectl apply")?;
        {
            use std::io::Write;
            let stdin = child.stdin.as_mut().context("kubectl stdin")?;
            stdin.write_all(serde_json::to_string(&list)?.as_bytes())?;
        }
        let out = child.wait_with_output()?;
        ensure!(
            out.status.success(),
            "kubectl apply failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(())
    })
}

/// Kinds an instance owns, for pruning what its manifests no longer list.
const PRUNABLE: &[&str] = &[
    "deployments.apps",
    "services",
    "configmaps",
    "ingresses.networking.k8s.io",
    "networkpolicies.networking.k8s.io",
];

fn prune(stage: &Stage, name: &InstanceName, desired: &[Value]) -> Result<()> {
    let keep: BTreeSet<(String, String)> = desired
        .iter()
        .filter_map(|i| {
            Some((
                i["kind"].as_str()?.to_owned(),
                i["metadata"]["name"].as_str()?.to_owned(),
            ))
        })
        .collect();
    let out = kubectl()
        .args([
            "-n",
            &name.namespace(),
            "get",
            &PRUNABLE.join(","),
            "-l",
            &format!("macro.com/instance={}", name.as_str()),
            "-o",
            "json",
        ])
        .output()?;
    ensure!(out.status.success(), "kubectl get failed");
    let current: Value = serde_json::from_slice(&out.stdout)?;
    for item in items(&current) {
        let kind = item["kind"].as_str().unwrap_or_default().to_owned();
        let n = item["metadata"]["name"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        if !keep.contains(&(kind.clone(), n.clone())) {
            let mut cmd = kubectl();
            cmd.args(["-n", &name.namespace(), "delete", &kind.to_lowercase(), &n]);
            stage.run(&format!("Pruning {kind} {n}"), &mut cmd)?;
        }
    }
    Ok(())
}

fn wait_ready(stage: &Stage, namespace: &str, tier: Option<&str>) -> Result<()> {
    let mut cmd = kubectl();
    cmd.args([
        "-n",
        namespace,
        "wait",
        "deployment",
        "--for=condition=Available",
        "--timeout=20m",
    ]);
    match tier {
        Some(t) => cmd.args(["-l", &format!("macro.com/tier={t}")]),
        None => cmd.arg("--all"),
    };
    let label = match tier {
        Some(t) => format!("Waiting for {t} workloads"),
        None => "Waiting for every workload".to_owned(),
    };
    let result = stage.run(&label, &mut cmd);
    if result.is_err() {
        let _ = kubectl().args(["-n", namespace, "get", "pods"]).status();
    }
    result
}

fn secret(namespace: &str, name: &str, kind: &str, data: &BTreeMap<String, String>) -> Value {
    json!({
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": name,
            "namespace": namespace,
            "labels": { "app.kubernetes.io/part-of": "macro" },
        },
        "type": kind,
        "stringData": data,
    })
}

/// Port-forward the infra Services to the local instance's host ports and run
/// the provisioning `run_local` runs against its containers.
fn provision(
    stage: &Stage,
    name: &InstanceName,
    instance: &Instance,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    let forwards = [
        ("postgres", Port::Postgres, 5432),
        ("aws-gateway", Port::LocalStack, 4566),
        ("kafka", Port::Kafka, 9092),
        ("fusionauth", Port::FusionAuth, 9011),
        ("search", Port::OpenSearch, 9200),
    ];
    let mut children = PortForwards::default();
    for (svc, port, remote) in forwards {
        children.0.push(
            kubectl()
                .args([
                    "-n",
                    &name.namespace(),
                    "port-forward",
                    &format!("svc/{svc}"),
                    &format!("{}:{remote}", instance.port(port)),
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .with_context(|| format!("port-forwarding {svc}"))?,
        );
    }
    for (_, port, _) in forwards {
        wait_port(instance.port(port))?;
    }
    stage.run_step("Provisioning buckets, queues, tables, keys", || {
        localstack::provision(instance)
    })?;
    db::migrate(stage, instance)?;
    stage.run_step("Creating Kafka topics", || kafka::provision(instance))?;
    fusionauth::wait_ready(stage, instance)?;
    opensearch::provision_indices(stage, instance, env)?;
    Ok(())
}

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

/// Browser-facing local origins in the resolved env, mapped to the instance's
/// public origin; longest first so no rewrite applies inside another's output.
pub fn origin_rewrites(instance: &Instance, origin: &str) -> Result<Vec<(String, String)>> {
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

pub fn rewrite(value: &str, rewrites: &[(String, String)]) -> String {
    rewrites
        .iter()
        .fold(value.to_owned(), |v, (from, to)| v.replace(from, to))
}

fn digest(input: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(input.as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}
