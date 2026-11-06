//! Direct application of Nix-declared local instances. Initialization belongs
//! to the declared Jobs and init containers, never to the host controller.

mod cluster;
mod render;
mod secrets;
#[cfg(test)]
mod test;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result, ensure};
use clap::{Args, Subcommand};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const CLUSTER: &str = "macro-eks-local";
const NETWORK: &str = "macro-eks-kind";
const REGISTRY: &str = "macro-eks-registry";

/// A Kubernetes resource name, validated before any filesystem or API operation.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(transparent)]
pub struct ResourceName(String);

impl std::str::FromStr for ResourceName {
    type Err = anyhow::Error;
    fn from_str(raw: &str) -> Result<Self> {
        validate_name(raw)?;
        Ok(Self(raw.into()))
    }
}

impl std::ops::Deref for ResourceName {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ResourceName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Subcommand)]
pub enum Cmd {
    /// Create the Nix-declared local cluster and its local image registry.
    Cluster,
    /// Create runtime Secrets, apply declarations, and wait for readiness.
    Up(InstanceArgs),
    /// Stop only this namespace's workloads, retaining data.
    Stop(Name),
    /// Remove this instance's workloads, retaining persistent volumes.
    Down(Name),
    /// Show this namespace and its HTTPS link.
    Status(Name),
    /// Tail one deployment's logs.
    Logs(Service),
    /// Rebuild host binaries and restart one service, without building images.
    Roll(Roll),
    /// Build and push Nix images, optionally selecting one service.
    Images(ImageArgs),
    /// Render an instance, or check the committed reference declarations.
    Render(Render),
    /// In-cluster initialization commands.
    #[command(subcommand)]
    Init(Init),
}

#[derive(Args)]
pub struct Name {
    name: ResourceName,
}

#[derive(Args)]
pub struct Service {
    name: ResourceName,
    #[arg(long)]
    service: ResourceName,
}

#[derive(Args)]
pub struct Roll {
    #[command(flatten)]
    target: Service,
    /// Restart only, using the binary already built on the host.
    #[arg(long)]
    no_build: bool,
}

#[derive(Args)]
pub struct InstanceArgs {
    name: ResourceName,
    #[arg(long, default_value_t = 0, value_parser = clap::value_parser!(u8).range(0..=1))]
    slot: u8,
    #[arg(long)]
    no_doppler: bool,
    #[arg(long)]
    env_file: Option<PathBuf>,
    /// Disable the declared local LGTM collector and telemetry export.
    #[arg(long)]
    no_telemetry: bool,
    /// Bake service binaries into images instead of mounting the host outputs.
    #[arg(long)]
    full_images: bool,
    #[arg(long)]
    binaries_dir: Option<PathBuf>,
    /// Use ClusterIP ingress (for isolated startup measurements).
    #[arg(long)]
    headless: bool,
    /// Initialize an empty Postgres volume without the pre-migrated seed.
    #[arg(long)]
    no_seed: bool,
}

#[derive(Args)]
pub struct Render {
    #[arg(default_value = "reference")]
    name: ResourceName,
    #[arg(long)]
    check: bool,
    #[arg(long)]
    output: Option<PathBuf>,
}

#[derive(Args)]
pub struct ImageArgs {
    #[command(flatten)]
    instance: InstanceArgs,
    #[arg(long)]
    service: Option<ResourceName>,
}

#[derive(Subcommand)]
pub enum Init {
    Kafka,
}

pub fn run(cmd: Cmd) -> Result<()> {
    if matches!(cmd, Cmd::Init(Init::Kafka)) {
        return kafka();
    }
    let state = state()?;
    match cmd {
        Cmd::Cluster => cluster::ensure(&state),
        Cmd::Up(args) => up(&state, &args),
        Cmd::Images(args) => {
            let mut params = parameters(&args.instance)?;
            params["enableGmail"] = json!(true);
            cluster::ensure(&state)?;
            if let Some(service) = &args.service {
                validate_name(service)?;
            }
            let names = args.service.map(|service| vec![service.0]);
            render::push(&state, &params, names.as_deref())
        }
        Cmd::Render(args) => render::reference(&state, &args),
        Cmd::Stop(args) => {
            let namespace = owned(&state, &args.name)?;
            kube(
                &state,
                &[
                    "-n",
                    &namespace,
                    "scale",
                    "deployment",
                    "--all",
                    "--replicas=0",
                ],
                None,
            )?;
            kube(
                &state,
                &[
                    "-n",
                    &namespace,
                    "delete",
                    "job",
                    "-l",
                    "macro.local/managed=true",
                ],
                None,
            )?;
            kube(
                &state,
                &[
                    "-n",
                    &namespace,
                    "wait",
                    "--for=delete",
                    "pod",
                    "--all",
                    "--timeout=180s",
                ],
                None,
            )?;
            Ok(())
        }
        Cmd::Down(args) => {
            let namespace = owned(&state, &args.name)?;
            // Keep the namespace, Secrets, and PVCs. Destructive data removal is
            // an explicit kubectl action, outside this command's contract.
            kube(
                &state,
                &[
                    "-n",
                    &namespace,
                    "delete",
                    "deployment,job,service,configmap,role,rolebinding",
                    "-l",
                    "macro.local/managed=true",
                ],
                None,
            )?;
            kube(
                &state,
                &[
                    "-n",
                    &namespace,
                    "wait",
                    "--for=delete",
                    "pod",
                    "--all",
                    "--timeout=180s",
                ],
                None,
            )?;
            Ok(())
        }
        Cmd::Status(args) => {
            let namespace = owned(&state, &args.name)?;
            let output = kube(&state, &["-n", &namespace, "get", "pods,jobs"], None)?;
            print!("{output}");
            let params: Value =
                serde_json::from_slice(&std::fs::read(state.join(format!("{}.json", args.name)))?)?;
            link(&params)
        }
        Cmd::Logs(args) => {
            let namespace = owned(&state, &args.name)?;
            validate_name(&args.service)?;
            let status = kubectl(&state)
                .args([
                    "-n",
                    &namespace,
                    "logs",
                    "-f",
                    &format!("deployment/{}", args.service),
                    "--all-containers",
                    "--tail=100",
                ])
                .status()?;
            ensure!(status.success(), "kubectl logs failed");
            Ok(())
        }
        Cmd::Roll(args) => {
            let namespace = owned(&state, &args.target.name)?;
            validate_name(&args.target.service)?;
            let params: Value = serde_json::from_slice(&std::fs::read(
                state.join(format!("{}.json", args.target.name)),
            )?)?;
            ensure!(
                !params["devBinaries"].is_null(),
                "roll requires the dev binary overlay; use images for full images"
            );
            if !args.no_build {
                let default = std::fs::canonicalize(
                    super::repo_root().join("target/x86_64-unknown-linux-gnu/debug"),
                )?;
                ensure!(
                    params["devBinaries"].as_str() == Some(path_str(&default)?),
                    "roll builds the default zigbuild directory; use --no-build for a custom binary directory"
                );
                super::zigbuild_only()?;
            }
            let deployment = format!("deployment/{}", args.target.service);
            kube(
                &state,
                &["-n", &namespace, "rollout", "restart", &deployment],
                None,
            )?;
            kube(
                &state,
                &[
                    "-n",
                    &namespace,
                    "rollout",
                    "status",
                    &deployment,
                    "--timeout=120s",
                ],
                None,
            )?;
            Ok(())
        }
        Cmd::Init(_) => unreachable!(),
    }
}

fn up(state: &Path, args: &InstanceArgs) -> Result<()> {
    let mut params = parameters(args)?;
    cluster::ensure(state)?;
    cluster::check_binary_mount(&params)?;
    eprintln!("Loading runtime Secrets for {}", args.name);
    secrets::create(state, args, &mut params)?;
    let namespace = namespace(&args.name)?;
    eprintln!("Building the declared instance");
    let bundle = render::build(state, &params, "bundle")?;
    let manifests = std::fs::canonicalize(bundle.join("manifests"))?;
    render::check_directory(&manifests)?;
    eprintln!("Pushing image layers to the local registry");
    render::push_store(&bundle.join("push"))?;
    eprintln!("Applying declarations");
    let claims = std::fs::canonicalize(bundle.join("claims"))?;
    kube(
        state,
        &[
            "-n",
            &namespace,
            "apply",
            "--server-side",
            "--force-conflicts",
            "--field-manager=macro-kube",
            "-f",
            path_str(&claims)?,
        ],
        None,
    )?;
    let workloads = std::fs::canonicalize(bundle.join("workloads"))?;
    kube(
        state,
        &[
            "-n",
            &namespace,
            "apply",
            "--server-side",
            "--force-conflicts",
            "--field-manager=macro-kube",
            "--prune",
            "--applyset=macro",
            "-f",
            path_str(&workloads)?,
        ],
        None,
    )?;
    kube(
        state,
        &[
            "-n",
            &namespace,
            "wait",
            "--for=condition=complete",
            "job",
            "--all",
            "--timeout=600s",
        ],
        None,
    )?;
    kube(
        state,
        &[
            "-n",
            &namespace,
            "rollout",
            "status",
            "deployment",
            "--selector=macro.local/managed=true",
            "--timeout=600s",
        ],
        None,
    )?;
    std::fs::write(
        state.join(format!("{}.json", args.name)),
        serde_json::to_vec_pretty(&params)?,
    )?;
    link(&params)
}

fn parameters(args: &InstanceArgs) -> Result<Value> {
    validate_name(&args.name)?;
    let binaries = if args.full_images {
        None
    } else {
        Some(
            std::fs::canonicalize(args.binaries_dir.clone().unwrap_or_else(|| {
                super::repo_root().join("target/x86_64-unknown-linux-gnu/debug")
            }))
            .context("binary directory is missing; run cargo x zigbuild first")?,
        )
    };
    if let Some(path) = &binaries {
        ensure!(
            path.is_dir(),
            "binary directory is missing; run cargo x zigbuild first"
        );
    }
    Ok(
        json!({"name": args.name, "host": super::tls::hostname()?, "slot": args.slot,
        "devBinaries": binaries, "seeded": !args.no_seed, "expose": !args.headless, "telemetry": !args.no_telemetry }),
    )
}

fn link(params: &Value) -> Result<()> {
    if params["expose"] == false {
        println!(
            "{} (ClusterIP ingress)",
            namespace(params["name"].as_str().context("instance name missing")?)?
        );
        return Ok(());
    }
    println!(
        "https://{}:{}/app/",
        params["host"].as_str().context("host missing")?,
        32443 + params["slot"].as_u64().unwrap_or(0)
    );
    Ok(())
}

fn validate_name(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty()
            && name.len() <= 40
            && name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && name.as_bytes()[0].is_ascii_alphanumeric(),
        "invalid Kubernetes resource name"
    );
    Ok(())
}

fn namespace(name: &str) -> Result<String> {
    validate_name(name)?;
    Ok(format!("macro-kube-{name}"))
}

#[allow(clippy::disallowed_methods)]
fn state() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME missing")?;
    let owner = super::repo_root().to_string_lossy().into_owned();
    let hash = format!("{:x}", Sha256::digest(owner.as_bytes()));
    let path = PathBuf::from(home)
        .join(".local/state/macro-kubernetes")
        .join(&hash[..16]);
    std::fs::create_dir_all(&path)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    Ok(path)
}

fn owned(state: &Path, name: &str) -> Result<String> {
    let namespace = namespace(name)?;
    let object: Value = serde_json::from_str(&kube(
        state,
        &["get", "namespace", &namespace, "-o", "json"],
        None,
    )?)?;
    ensure!(
        object["metadata"]["annotations"]["macro.local/checkout"]
            == super::repo_root().to_string_lossy().as_ref(),
        "namespace belongs to another checkout"
    );
    Ok(namespace)
}

fn kubectl(state: &Path) -> Command {
    let mut cmd = Command::new(state.join("tools/bin/kubectl"));
    cmd.arg("--kubeconfig")
        .arg(state.join("kubeconfig"))
        .args(["--context", &format!("kind-{CLUSTER}")]);
    cmd.env("KUBECTL_APPLYSET", "true");
    cmd
}

fn kube(state: &Path, args: &[&str], input: Option<&Value>) -> Result<String> {
    let mut cmd = kubectl(state);
    cmd.args(args);
    output(&mut cmd, input)
}

fn output(cmd: &mut Command, input: Option<&Value>) -> Result<String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().context("starting local tool")?;
    if let Some(value) = input {
        use std::io::Write;
        child
            .stdin
            .take()
            .context("subprocess stdin missing")?
            .write_all(&serde_json::to_vec(value)?)?;
    }
    let result = child.wait_with_output()?;
    // Never include subprocess stderr for operations that accept Secret data.
    ensure!(
        result.status.success(),
        "local tool failed{}",
        if input.is_none() {
            format!(": {}", String::from_utf8_lossy(&result.stderr))
        } else {
            String::new()
        }
    );
    Ok(String::from_utf8(result.stdout)?)
}

fn path_str(path: &Path) -> Result<&str> {
    path.to_str().context("path is not UTF-8")
}

#[cfg(feature = "local-stack")]
fn kafka() -> Result<()> {
    use rdkafka::{
        ClientConfig,
        admin::{AdminClient, AdminOptions, NewTopic, TopicReplication},
        client::DefaultClientContext,
        types::RDKafkaErrorCode,
    };
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        let admin: AdminClient<DefaultClientContext> = ClientConfig::new()
            .set("bootstrap.servers", "kafka:29092")
            .create()?;
        let names = macro_event_topics::all_topic_names();
        let topics: Vec<_> = names
            .iter()
            .map(|name| NewTopic::new(name, 6, TopicReplication::Fixed(1)))
            .collect();
        for result in admin
            .create_topics(
                &topics,
                &AdminOptions::new().operation_timeout(Some(std::time::Duration::from_secs(30))),
            )
            .await?
        {
            match result {
                Ok(_) | Err((_, RDKafkaErrorCode::TopicAlreadyExists)) => {}
                Err((name, error)) => anyhow::bail!("topic {name}: {error}"),
            }
        }
        Ok(())
    })
}

#[cfg(not(feature = "local-stack"))]
fn kafka() -> Result<()> {
    anyhow::bail!("build with --features local-stack")
}
