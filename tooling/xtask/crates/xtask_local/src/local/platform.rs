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
    Mode, env_layer, frontend, fusionauth, gen_compose, inventory, kafka, kickstart, localstack,
    repo_root,
};

#[cfg(test)]
mod test;

/// kubeconfig k3s writes on the host (see the big-pickle k3s module).
const KUBECONFIG: &str = "/etc/rancher/k3s/k3s.yaml";
/// Host port the cluster ingress listens on (loopback only).
const INGRESS_PORT: u16 = 9443;
/// The edge config generated from the service inventory, checked in.
pub const CADDYFILE: &str = "infra/platform/generated/Caddyfile";
/// RustFS's webhook target for doc-storage uploads (the `s3-events` bridge,
/// see infra/platform/components.nix).
const UPLOAD_NOTIFICATION_TARGET: &str = "arn:rustfs:sqs:us-east-1:finalizer:webhook";
/// The binary the provisioning Jobs run (this one).
const PROVISIONER_BIN: &str = "xtask_local";
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
    /// Seed an instance and run the local E2E suites against it.
    E2e(E2eArgs),
    /// Inside a cluster Job: provision the instance this pod belongs to.
    #[command(subcommand)]
    Job(JobCmd),
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

#[derive(Subcommand, Clone, Copy)]
pub enum JobCmd {
    /// Migrations, topics, AWS resources, search indices, worker bundles.
    Provision,
    /// D1 migrations, which run inside the celld fleets once their nodes are up.
    FleetMigrate,
}

#[derive(Args, Clone)]
pub struct E2eArgs {
    #[command(flatten)]
    pub name: NameArg,
    #[arg(long, value_enum, default_value_t = E2eSuite::All)]
    pub suite: E2eSuite,
    /// Passed to the test runner.
    #[arg(last = true)]
    pub test_args: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum E2eSuite {
    Rust,
    Web,
    All,
}

pub fn run(cmd: PlatformCmd) -> Result<()> {
    match cmd {
        PlatformCmd::E2e(args) => e2e(&args),
        PlatformCmd::Job(JobCmd::Provision) => job_provision(),
        PlatformCmd::Job(JobCmd::FleetMigrate) => job_fleet_migrate(),
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
    /// Node service bundles: workload -> store path.
    #[serde(default)]
    node: BTreeMap<String, String>,
    env_revision: String,
    /// The instance's AWS-API key (generated once; every backend verifies it).
    #[serde(default)]
    aws_key: Option<(String, String)>,
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

/// Lambda handlers the instance runs behind lambda-runner: workload -> bin
/// (`lambdaHandlers` in infra/platform/components.nix).
const LAMBDA_HANDLERS: &[(&str, &str)] = &[
    ("deleted-item-poller", "deleted_item_poller"),
    ("user-link-cleanup", "user_link_cleanup_handler"),
    ("email-refresh", "email_refresh_handler"),
    ("email-scheduled", "email_scheduled_handler"),
    ("notification-retention", "notification_retention_handler"),
    (
        "organization-retention-trigger",
        "organization_retention_trigger",
    ),
    ("organization-retention", "organization_retention_handler"),
    ("email-sfs-delete", "email_sfs_delete_handler"),
    ("delete-chat", "delete_chat_handler"),
    ("document-text-extractor", "document_text_extractor"),
    ("upload-extractor", "upload_extractor_lambda_handler"),
];

/// The cargo bin each Rust workload runs (the inventory, k8s names, and the
/// Lambda handlers).
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
        .chain(LAMBDA_HANDLERS.iter().map(|(w, b)| ((*w).to_owned(), *b)))
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
    // TLS clients reject `*.localhost` (a wildcard directly under a one-label
    // TLD), and the shared ingress chooses certificates by SNI, so each
    // instance's certificate names only its own host.
    let certs = issue_host_certificate(&instance, &name.host())?;

    let mut state = read_state(&instance);
    let (key_id, key_secret) = match &state.aws_key {
        Some(k) => k.clone(),
        None => generate_aws_key()?,
    };
    state.aws_key = Some((key_id.clone(), key_secret.clone()));
    let aws_key = localstack::AwsKey {
        access_key_id: key_id,
        secret_access_key: key_secret,
    };
    let mut shared_env = queue_urls(shared_env);
    shared_env.insert(
        macro_queues::LOCAL_QUEUE_BASE_URL_ENV_VAR.into(),
        super::resources::queue_url("")
            .trim_end_matches('/')
            .to_owned(),
    );
    shared_env.insert("AWS_ACCESS_KEY_ID".into(), aws_key.access_key_id.clone());
    shared_env.insert(
        "AWS_SECRET_ACCESS_KEY".into(),
        aws_key.secret_access_key.clone(),
    );
    if !args.no_build || state.binaries.is_empty() {
        let bins: Vec<&str> = rust_workloads()
            .into_values()
            .chain([PROVISIONER_BIN])
            .collect();
        cargo_build(&stage, &bins)?;
        frontend::build_static(&stage, &instance, Mode::Local)?;
        state.binaries = wrap_binaries(&stage, &bins)?;
        state.frontend = Some(store_dir(
            &stage,
            "macro-frontend",
            &frontend::static_dir(&instance),
        )?);
        state.node = build_node_services(&stage, &instance)?;
        state.node.extend(build_worker_bundles(&stage, &instance)?);
        state.node.insert(
            "opensearch-helpers".to_owned(),
            build_opensearch_helpers(&stage)?,
        );
    }
    env_layer::write_dotenv(&env_file(&instance), &shared_env)?;
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
                        std::fs::read_to_string(certs.join("server.pem"))?,
                    ),
                    (
                        "tls.key".to_owned(),
                        std::fs::read_to_string(certs.join("server-key.pem"))?,
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
    wait_job(&stage, &namespace, "provision")?;
    let all = items(&manifests);
    apply_items(&stage, "services", &all)?;
    prune(&stage, &name, &all)?;
    wait_job(&stage, &namespace, "fleet-migrate")?;
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

/// Where `up` leaves the instance's resolved env for host-side tooling.
fn env_file(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("platform.generated.env")
}

fn e2e(args: &E2eArgs) -> Result<()> {
    let name = InstanceName::parse(&args.name.name)?;
    let instance = name.local_instance()?;
    let generated_env = env_file(&instance);
    ensure!(
        generated_env.is_file(),
        "instance {} has no recorded env; run `just platform up {}` first",
        name.as_str(),
        name.as_str()
    );
    let mut forwards = PortForwards::default();
    for (svc, port, remote) in [
        ("postgres", Port::Postgres, 5432),
        ("aws-gateway", Port::LocalStack, 4566),
        ("fusionauth", Port::FusionAuth, 9011),
    ] {
        forwards.open(&name, svc, instance.port(port), remote)?;
        wait_port(instance.port(port))?;
    }
    let endpoints = super::e2e::Endpoints {
        proxy_url: name.origin(),
        frontend_url: frontend::url(&instance),
        postgres_url: format!(
            "postgres://user:password@localhost:{}/macrodb",
            instance.port(Port::Postgres)
        ),
        fusionauth_url: format!("http://localhost:{}", instance.port(Port::FusionAuth)),
        localstack_url: format!("http://localhost:{}", instance.port(Port::LocalStack)),
        connection_gateway_ws_url: format!(
            "wss://{}:{INGRESS_PORT}/connection-gateway",
            name.host()
        ),
        generated_env,
    };
    super::e2e::run_seed(&endpoints)?;
    let mut test_env = endpoints.test_env();
    test_env.insert(
        "NODE_EXTRA_CA_CERTS".into(),
        repo_root()
            .join("infra/local/certs/ca.pem")
            .display()
            .to_string(),
    );
    test_env.insert(
        "SSL_CERT_FILE".into(),
        repo_root()
            .join("infra/local/certs/ca.pem")
            .display()
            .to_string(),
    );
    if matches!(args.suite, E2eSuite::Rust | E2eSuite::All) {
        super::e2e::run_rust(&test_env, &args.test_args)?;
    }
    if matches!(args.suite, E2eSuite::Web | E2eSuite::All) {
        super::e2e::run_web(&test_env, false, &args.test_args)?;
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

/// A leaf for `host`, signed by the development CA (`infra/local/certs`).
fn issue_host_certificate(instance: &Instance, host: &str) -> Result<PathBuf> {
    let dir = instance.ensure_artifact_dir()?.join("ingress-certs");
    let out = Command::new("bash")
        .arg(repo_root().join("infra/local/certs/issue-host.sh"))
        .arg(&dir)
        .arg(host)
        .arg("exact")
        .output()
        .context("issuing the instance certificate")?;
    ensure!(
        out.status.success(),
        "issuing the instance certificate: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(dir)
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
        cmd.args([
            "--features",
            &format!("{AUTH_FEATURES},xtask_local/local-stack"),
        ]);
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

/// Build the Node services the way their compose Dockerfiles do, and add each
/// result to the store: lexical as one bundle beside its native-module
/// dependency, websocket as its own installed package.
fn build_node_services(stage: &Stage, instance: &Instance) -> Result<BTreeMap<String, String>> {
    let root = repo_root();
    let out = instance.ensure_artifact_dir()?.join("lexical-service");
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    std::fs::create_dir_all(out.join("node_modules"))?;
    let mut bundle = Command::new("bun");
    bundle
        .current_dir(root.join("services/lexical-service"))
        .args([
            "build",
            "src/server.ts",
            "--target=bun",
            "--external",
            "loro-crdt",
            "--outfile",
        ])
        .arg(out.join("server.bundle.js"));
    stage.run("Bundling lexical-service", &mut bundle)?;
    let mut copy = Command::new("cp");
    copy.arg("-rL")
        .arg(root.join("node_modules/loro-crdt"))
        .arg(out.join("node_modules/"));
    stage.run("Staging loro-crdt", &mut copy)?;

    let websocket = root.join("services/websocket-service");
    let mut install = Command::new("bun");
    install
        .current_dir(&websocket)
        .args(["install", "--frozen-lockfile"]);
    stage.run("Installing websocket-service", &mut install)?;

    Ok(BTreeMap::from([
        (
            "lexical".to_owned(),
            store_dir(stage, "lexical-service", &out)?,
        ),
        (
            "websocket".to_owned(),
            store_dir(stage, "websocket-service", &websocket)?,
        ),
    ]))
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
    let node = state
        .node
        .iter()
        .map(|(n, path)| format!("\"{n}\" = builtins.storePath \"{path}\";"))
        .collect::<Vec<_>>()
        .join(" ");
    let kafka_port = name.local_instance()?.port(Port::Kafka);
    let expr = format!(
        "let i = p.instance {{ name = \"{}\"; host = \"{}\"; envRevision = \"{}\"; \
         kafkaHostPort = {kafka_port}; \
         binaries = {{ {binaries} }}; node = {{ {node} }}; \
         frontend = builtins.storePath \"{frontend}\"; }}; \
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
    "jobs.batch",
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

/// Wait for this revision's provisioning Job to finish.
fn wait_job(stage: &Stage, namespace: &str, job: &str) -> Result<()> {
    let mut cmd = kubectl();
    cmd.args([
        "-n",
        namespace,
        "wait",
        "job",
        "-l",
        &format!("macro.com/job={job}"),
        "--for=condition=Complete",
        "--timeout=20m",
    ]);
    let result = stage.run(&format!("Waiting for the {job} job"), &mut cmd);
    if result.is_err() {
        let _ = kubectl()
            .args([
                "-n",
                namespace,
                "logs",
                "-l",
                &format!("macro.com/job={job}"),
                "--tail=20",
            ])
            .status();
    }
    result
}

/// Wait for each Deployment's rollout. `wait --for=condition=Available` is not
/// enough: during a rolling update the old pods keep a Deployment available.
fn wait_ready(stage: &Stage, namespace: &str, tier: Option<&str>) -> Result<()> {
    let mut list = kubectl();
    list.args(["-n", namespace, "get", "deployments", "-o", "name"]);
    if let Some(t) = tier {
        list.args(["-l", &format!("macro.com/tier={t}")]);
    }
    let out = list.output().context("listing deployments")?;
    ensure!(out.status.success(), "kubectl get deployments failed");
    let label = match tier {
        Some(t) => format!("Waiting for {t} workloads"),
        None => "Waiting for every workload".to_owned(),
    };
    let names = String::from_utf8(out.stdout)?;
    let result = stage.run_step(&label, || {
        for deployment in names.lines() {
            let status = kubectl()
                .args([
                    "-n",
                    namespace,
                    "rollout",
                    "status",
                    deployment,
                    "--timeout=20m",
                ])
                .stdout(Stdio::null())
                .status()
                .context("running kubectl rollout status")?;
            ensure!(status.success(), "{deployment} did not roll out");
        }
        Ok(())
    });
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

/// Buckets the sync worker's R2 binding uses.
const SYNC_R2_BUCKET: &str = "document-snapshot-bucket-dev";

/// One Workers app on its own celld fleet (`celldFleet` in components.nix).
struct Fleet {
    workload: &'static str,
    bucket: &'static str,
    /// D1 database to migrate once a node runs.
    d1: Option<&'static str>,
    extra_buckets: &'static [&'static str],
}

/// The instance's fleets. Bundles come from `build_worker_bundles`.
const FLEETS: &[Fleet] = &[
    Fleet {
        workload: "sync-service",
        bucket: "cells-sync",
        d1: Some("user-peer-mapping"),
        extra_buckets: &[SYNC_R2_BUCKET],
    },
    Fleet {
        workload: "analytics-proxy",
        bucket: "cells-analytics",
        d1: None,
        extra_buckets: &[],
    },
    Fleet {
        workload: "ai-editing-worker",
        bucket: "cells-ai-editing",
        d1: Some("ai-editing-traces"),
        extra_buckets: &[],
    },
];

const NODE_BUILTINS: &[&str] = &[
    "assert",
    "async_hooks",
    "buffer",
    "crypto",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "os",
    "path",
    "process",
    "stream",
    "string_decoder",
    "tty",
    "url",
    "util",
    "zlib",
];

/// Build each Workers bundle on the host and add it to the store, without its
/// `wrangler.jsonc`: that holds the instance's keys, so the Job writes it.
fn build_worker_bundles(stage: &Stage, instance: &Instance) -> Result<BTreeMap<String, String>> {
    let root = repo_root();
    let base = instance.ensure_artifact_dir()?;
    let recreate = |name: &str| -> Result<PathBuf> {
        let dir = base.join(name);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    };
    let copy = |label: &str, source: &Path, dir: &Path| -> Result<()> {
        let mut cp = Command::new("cp");
        cp.arg("-rL").arg(source).arg(dir);
        stage.run(label, &mut cp)
    };

    let sync = root.join("services/sync-service");
    ensure!(
        sync.join("build/worker/shim.mjs").is_file(),
        "sync-service has no workers-rs build: run `worker-build --profile \
         sync-service-release` in services/sync-service"
    );
    let sync_dir = recreate("sync-service")?;
    copy("Staging sync-service build", &sync.join("build"), &sync_dir)?;
    copy(
        "Staging sync-service database",
        &sync.join("database"),
        &sync_dir,
    )?;

    let analytics = root.join("services/analytics-proxy");
    let mut install = Command::new("bun");
    install
        .current_dir(&analytics)
        .args(["install", "--frozen-lockfile"]);
    stage.run("Installing analytics-proxy", &mut install)?;
    let analytics_dir = recreate("analytics-proxy")?;
    copy(
        "Staging analytics-proxy source",
        &analytics.join("src"),
        &analytics_dir,
    )?;
    copy(
        "Staging analytics-proxy modules",
        &analytics.join("node_modules"),
        &analytics_dir,
    )?;

    // Its `alias` config is Wrangler-only, so this bundles it with the same
    // aliases and rules and hands celld the result.
    let ai = root.join("services/ai-editing-worker");
    let mut sandbox = Command::new("bun");
    sandbox
        .current_dir(&ai)
        .args(["scripts/generate-sandbox.ts"]);
    stage.run("Generating the ai-editing sandbox", &mut sandbox)?;
    let ai_dir = recreate("ai-editing-worker")?;
    let esbuild = nix_build(
        stage,
        "Building esbuild",
        "(import f.inputs.nixpkgs { system = \"x86_64-linux\"; }).esbuild",
    )?
    .into_iter()
    .next()
    .context("nix build printed no path")?;
    let mut bundle = Command::new(format!("{esbuild}/bin/esbuild"));
    bundle
        .current_dir(&ai)
        .args([
            "src/index.ts",
            "--bundle",
            "--format=esm",
            "--platform=browser",
            "--conditions=workerd,worker,browser",
            "--main-fields=module,main",
            "--alias:loro-crdt=loro-crdt/bundler",
            "--alias:@observability/logger=./src/logger-shim.ts",
            "--alias:@macro-inc/lexical-core=../../packages/lexical-core",
            // Wrangler reads wasm past a package's `exports` map; this is the
            // exported name for the same file.
            "--alias:@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm=@jitl/quickjs-wasmfile-release-sync/wasm",
            "--loader:.md=text",
            "--loader:.wasm=copy",
            "--external:node:*",
            "--external:cloudflare:*",
        ])
        // `nodejs_compat`: bare Node built-ins resolve to their node: modules.
        .args(NODE_BUILTINS.iter().map(|m| format!("--alias:{m}=node:{m}")))
        .arg(format!(
            "--outfile={}",
            ai_dir.join("dist/worker.mjs").display()
        ));
    stage.run("Bundling ai-editing-worker", &mut bundle)?;
    copy(
        "Staging ai-editing migrations",
        &ai.join("migrations"),
        &ai_dir,
    )?;

    Ok(BTreeMap::from([
        (
            "sync-bundle".to_owned(),
            store_dir(stage, "sync-bundle", &sync_dir)?,
        ),
        (
            "analytics-bundle".to_owned(),
            store_dir(stage, "analytics-bundle", &analytics_dir)?,
        ),
        (
            "ai-editing-bundle".to_owned(),
            store_dir(stage, "ai-editing-bundle", &ai_dir)?,
        ),
    ]))
}

/// The OpenSearch index script with its dependencies, for the Job.
fn build_opensearch_helpers(stage: &Stage) -> Result<String> {
    let helpers = repo_root().join("infra/stacks/opensearch/helpers");
    let mut install = Command::new("bun");
    install.current_dir(&helpers).arg("install");
    stage.run("Installing OpenSearch helper deps", &mut install)?;
    store_dir(stage, "opensearch-helpers", &helpers)
}

/// The analytics proxy's config: `wrangler.jsonc`'s local env, minus the keys
/// celld rejects. Rate limits move to the ingress.
pub fn analytics_wrangler_config() -> Value {
    json!({
        "name": "analytics-proxy",
        "main": "src/index.ts",
        "compatibility_date": "2025-07-22",
        "vars": {
            "POSTHOG_HOST": "https://us.i.posthog.com",
            "OTLP_TRACES_INTAKE_URL": "http://otel-collector:4318",
            "OTLP_LOGS_INTAKE_URL": "http://otel-collector:4318",
        },
    })
}

/// The AI editing worker's config: `wrangler.toml`'s local env, with the
/// instance's Chromium in place of the Browser Rendering binding.
pub fn ai_editing_wrangler_config(openai: &str, anthropic: &str, cerebras: &str) -> Value {
    json!({
        "name": "ai-editing-worker",
        "main": "dist/worker.mjs",
        "no_bundle": true,
        "compatibility_date": "2025-07-22",
        "compatibility_flags": ["nodejs_compat", "enable_request_signal"],
        "d1_databases": [{
            "binding": "TRACES_DB",
            "database_name": "ai-editing-traces",
            "database_id": "16d34e99-3bc6-44e4-a287-1ea65183bd28",
            "migrations_dir": "./migrations/",
        }],
        "vars": {
            "CANVAS_RENDER_URL": "http://edge:8080/app/canvas-render.html",
            "CANVAS_BROWSER_URL": "http://headless-chrome:9222",
            "ENVIRONMENT": "local",
            "SYNC_WS_BASE": "ws://sync-service:8787",
            "DSS_BASE": "http://document-storage-service:8080",
            "SEARCH_SERVICE_BASE": "http://search-processing-service:8080",
            "CONTACTS_SERVICE_BASE": "http://contacts-service:8080",
            "AUTH_SERVICE_BASE": "http://connection-gateway:8080",
            "OPENAI_API_KEY": openai,
            "ANTHROPIC_API_KEY": anthropic,
            "CEREBRAS_API_KEY": cerebras,
        },
    })
}

/// In-cluster endpoints, by Service name (see components.nix).
const CLUSTER_AWS_URL: &str = "http://aws-gateway:4566/";
const CLUSTER_S3_URL: &str = "http://aws-gateway:4566";
const CLUSTER_KAFKA: &str = "kafka:29092";
const CLUSTER_OPENSEARCH_URL: &str = "http://search:9200";

fn job_env(name: &'static str) -> Result<String> {
    macro_env_var::maybe_read_env(name).with_context(|| format!("{name} is not set"))
}

fn job_aws_key() -> Result<localstack::AwsKey> {
    Ok(localstack::AwsKey {
        access_key_id: job_env("AWS_ACCESS_KEY_ID")?,
        secret_access_key: job_env("AWS_SECRET_ACCESS_KEY")?,
    })
}

async fn job_s3(key: &localstack::AwsKey) -> aws_sdk_s3::Client {
    let cfg = macro_aws_config::local_aws_config_with_credentials(
        CLUSTER_S3_URL,
        &key.access_key_id,
        &key.secret_access_key,
    )
    .await;
    aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&cfg)
            .force_path_style(true)
            .build(),
    )
}

/// Retry `step` while the instance's data plane comes up; the Job starts
/// alongside it on a fresh install.
fn retrying(label: &str, mut step: impl FnMut() -> Result<()>) -> Result<()> {
    let mut last = None;
    for _ in 0..120 {
        match step() {
            Ok(()) => {
                println!("{label}: done");
                return Ok(());
            }
            Err(e) => {
                println!("{label}: retrying: {e:#}");
                last = Some(e);
                std::thread::sleep(std::time::Duration::from_secs(5));
            }
        }
    }
    Err(last
        .context("retries exhausted without an attempt")?
        .context(label.to_owned()))
}

fn run_checked(cmd: &mut Command) -> Result<()> {
    let out = cmd.output().with_context(|| format!("running {cmd:?}"))?;
    ensure!(
        out.status.success(),
        "{cmd:?} failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// Everything an instance needs before its services start. Each step is
/// idempotent, so re-running on an upgrade is safe.
fn job_provision() -> Result<()> {
    let key = job_aws_key()?;
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    retrying("buckets, queues, tables, keys", || {
        localstack::provision_at(
            CLUSTER_AWS_URL,
            &localstack::UploadNotificationTarget::Target(UPLOAD_NOTIFICATION_TARGET.into()),
            &key,
        )
    })?;
    // The edge serves `/static-file/*` straight from this bucket, as CloudFront
    // does in deployed environments. LocalStack skips the check; RustFS needs
    // the policy.
    retrying("static file read policy", || {
        rt.block_on(async {
            let policy = json!({
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": { "AWS": ["*"] },
                    "Action": ["s3:GetObject"],
                    "Resource": [format!("arn:aws:s3:::{}/*", super::resources::STATIC_FILE_BUCKET)],
                }],
            })
            .to_string();
            job_s3(&key)
                .await
                .put_bucket_policy()
                .bucket(super::resources::STATIC_FILE_BUCKET)
                .policy(policy)
                .send()
                .await
                .context("setting the static file bucket policy")?;
            Ok(())
        })
    })?;
    let database_url = job_env("DATABASE_URL")?;
    let migrations = job_env("PLATFORM_MIGRATIONS_DIR")?;
    retrying("database migrations", || {
        run_checked(
            Command::new("sqlx")
                .args(["database", "create"])
                .env("DATABASE_URL", &database_url),
        )?;
        run_checked(
            Command::new("sqlx")
                .args(["migrate", "run", "--source", &migrations])
                .env("DATABASE_URL", &database_url),
        )
    })?;
    retrying("kafka topics", || kafka::provision_at(CLUSTER_KAFKA))?;
    let helpers = job_env("PLATFORM_OPENSEARCH_HELPERS")?;
    retrying("search indices", || {
        run_checked(
            Command::new("bun")
                .current_dir(&helpers)
                .args(["run", "scripts/create_indices.ts"])
                .env("ENVIRONMENT", "local")
                .env("DRY_RUN", "false")
                .env("OPENSEARCH_URL", CLUSTER_OPENSEARCH_URL)
                .env(
                    "OPENSEARCH_USERNAME",
                    macro_env_var::maybe_read_env("OPENSEARCH_USERNAME")
                        .unwrap_or_else(|| "macrouser".to_owned()),
                )
                .env(
                    "OPENSEARCH_PASSWORD",
                    macro_env_var::maybe_read_env("OPENSEARCH_PASSWORD")
                        .unwrap_or_else(|| "local".to_owned()),
                ),
        )
    })?;
    for fleet in FLEETS {
        retrying(&format!("{} buckets", fleet.workload), || {
            rt.block_on(async {
                let s3 = job_s3(&key).await;
                for bucket in std::iter::once(&fleet.bucket).chain(fleet.extra_buckets) {
                    if let Err(e) = s3.create_bucket().bucket(*bucket).send().await {
                        let text = format!("{e:?}");
                        ensure!(
                            text.contains("BucketAlready"),
                            "creating bucket {bucket}: {text}"
                        );
                    }
                }
                Ok(())
            })
        })?;
        let dir = stage_fleet_bundle(fleet)?;
        retrying(&format!("{} deploy", fleet.workload), || {
            run_checked(
                celld_command(&key)
                    .current_dir(&dir)
                    .args(["deploy", "."])
                    .args(fleet_store_args(fleet)),
            )
        })?;
    }
    Ok(())
}

/// D1 runs inside the fleets, so this waits for their nodes.
fn job_fleet_migrate() -> Result<()> {
    let key = job_aws_key()?;
    for fleet in FLEETS {
        let Some(database) = fleet.d1 else { continue };
        let dir = stage_fleet_bundle(fleet)?;
        retrying(&format!("{} D1 migrations", fleet.workload), || {
            run_checked(
                celld_command(&key)
                    .current_dir(&dir)
                    .args(["d1", "migrations", "apply", database])
                    .args(fleet_store_args(fleet)),
            )
        })?;
    }
    Ok(())
}

fn celld_command(key: &localstack::AwsKey) -> Command {
    let mut cmd = Command::new("celld");
    cmd.env("AWS_ACCESS_KEY_ID", &key.access_key_id)
        .env("AWS_SECRET_ACCESS_KEY", &key.secret_access_key)
        .env("AWS_REGION", "us-east-1");
    cmd
}

fn fleet_store_args(fleet: &Fleet) -> Vec<String> {
    vec![
        "--bucket".into(),
        format!("s3://{}", fleet.bucket),
        "--endpoint".into(),
        CLUSTER_S3_URL.into(),
        "--region".into(),
        "us-east-1".into(),
    ]
}

/// A writable copy of the fleet's bundle with its `wrangler.jsonc`, which
/// carries this instance's keys and so never enters the store.
fn stage_fleet_bundle(fleet: &Fleet) -> Result<PathBuf> {
    let var = match fleet.workload {
        "sync-service" => "PLATFORM_BUNDLE_SYNC",
        "analytics-proxy" => "PLATFORM_BUNDLE_ANALYTICS",
        "ai-editing-worker" => "PLATFORM_BUNDLE_AI_EDITING",
        other => bail!("no bundle known for {other}"),
    };
    let dir = std::env::temp_dir().join(fleet.workload);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    run_checked(Command::new("cp").arg("-rL").arg(job_env(var)?).arg(&dir))?;
    run_checked(Command::new("chmod").args(["-R", "u+w"]).arg(&dir))?;
    let get = |k: &'static str| macro_env_var::maybe_read_env(k).unwrap_or_default();
    let config = match fleet.workload {
        "sync-service" => sync_wrangler_config(
            &get("INTERNAL_API_SECRET_KEY"),
            &get("DOCUMENT_PERMISSION_JWT"),
            &get("DOCUMENT_STORAGE_SERVICE_AUTH_KEY"),
        ),
        "analytics-proxy" => analytics_wrangler_config(),
        _ => ai_editing_wrangler_config(
            &get("OPENAI_API_KEY"),
            &get("ANTHROPIC_API_KEY"),
            &get("CEREBRAS_API_KEY"),
        ),
    };
    std::fs::write(
        dir.join("wrangler.jsonc"),
        serde_json::to_string_pretty(&config)?,
    )?;
    Ok(dir)
}

/// The sync worker's Wrangler config for celld: compose's
/// `wrangler.docker.toml` bindings, with the keys its Dockerfile writes to
/// `.dev.vars` as vars (celld has no separate secrets; the config lives only
/// in this instance's fleet bucket).
pub fn sync_wrangler_config(internal_key: &str, permissions_jwt: &str, dss_key: &str) -> Value {
    json!({
        "name": "sync-service",
        // celld bundles the workers-rs shim with esbuild: the shim imports
        // `../index.js`, which an unbundled deploy cannot resolve.
        "main": "build/worker/shim.mjs",
        "compatibility_date": "2025-03-05",
        "durable_objects": {
            "bindings": [{ "name": "DOCUMENT_SYNC_SESSION", "class_name": "DocumentSyncSession" }],
        },
        "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DocumentSyncSession"] }],
        "d1_databases": [{
            "binding": "USER_PEER_MAPPING",
            "database_name": "user-peer-mapping",
            "database_id": "85b0ffef-e625-4b67-8b3b-77f33fd38fd3",
            "migrations_dir": "./database/user-peer-mapping/migrations/",
        }],
        "r2_buckets": [{ "binding": "DOCUMENT_SNAPSHOT_BUCKET", "bucket_name": SYNC_R2_BUCKET }],
        "kv_namespaces": [
            { "binding": "DOCUMENT_VERSIONING_KV", "id": "3548ca6265c745e38cd504194aa6e887" },
            { "binding": "SNAPSHOT_STORE_KV", "id": "9beead2b7891492f82153d2354e64e92" },
        ],
        "vars": {
            // The worker reads the secret's binding name from this var.
            "INTERNAL_API_SECRET_KEY": "LOCAL_API_KEY",
            "LOCAL_API_KEY": internal_key,
            "DOCUMENT_PERMISSIONS_SECRET": permissions_jwt,
            "SPS_API_SECRET_KEY": internal_key,
            "DSS_INTERNAL_AUTH_KEY": dss_key,
            "LEXICAL_SERVICE_AUTH_KEY": internal_key,
            "SPS_URL": "http://search-processing-service:8080",
            "DSS_URL": "http://document-storage-service:8080",
            "LEXICAL_SERVICE_URL": "http://lexical-service:8096",
            "ENVIRONMENT": "local",
        },
    })
}

#[derive(Default)]
struct PortForwards(Vec<Child>);

impl PortForwards {
    fn open(&mut self, name: &InstanceName, svc: &str, local: u16, remote: u16) -> Result<()> {
        self.0.push(
            kubectl()
                .args([
                    "-n",
                    &name.namespace(),
                    "port-forward",
                    &format!("svc/{svc}"),
                    &format!("{local}:{remote}"),
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .with_context(|| format!("port-forwarding {svc}"))?,
        );
        Ok(())
    }
}

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

/// Queue variables the code-defined env sets to bare names (LocalStack
/// accepts a name as a QueueUrl; SQS and ElasticMQ need the URL, which is
/// what deployed environments set).
pub fn queue_urls(env: BTreeMap<String, String>) -> BTreeMap<String, String> {
    env.into_iter()
        .map(|(k, v)| {
            let bare = !v.is_empty()
                && v.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
            // `ENABLE_*_QUEUE` are feature switches, not queues.
            let names_queue =
                (k.ends_with("_QUEUE") || k.ends_with("_QUEUE_URL")) && !k.starts_with("ENABLE_");
            if names_queue && bare {
                let url = super::resources::queue_url(&v);
                (k, url)
            } else {
                (k, v)
            }
        })
        .collect()
}

/// An instance AWS-API key: ExtendDB accepts only AWS-shaped keys (`AKIA` +
/// 16 characters, and a 40-character secret). Generated, never committed.
fn generate_aws_key() -> Result<(String, String)> {
    use std::io::Read;
    const ID_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const SECRET_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut bytes = [0u8; 56];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let id: String = bytes[..16]
        .iter()
        .map(|b| char::from(ID_CHARS[usize::from(*b) % ID_CHARS.len()]))
        .collect();
    let secret: String = bytes[16..]
        .iter()
        .map(|b| char::from(SECRET_CHARS[usize::from(*b) % SECRET_CHARS.len()]))
        .collect();
    Ok((format!("AKIA{id}"), secret))
}

fn digest(input: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(input.as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}
