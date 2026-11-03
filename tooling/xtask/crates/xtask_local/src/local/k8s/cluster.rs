//! Cluster targets for `cargo x env`: where images go, how the ingress is
//! exposed, and the kubectl/helm invocations scoped to the target's context.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::render::{self, BakedMount};
use super::{ClusterArgs, EnvName, TargetKind};
use crate::local::build::{BinariesDir, RUNTIME_IMAGE_TAG};
use crate::local::instance::Instance;
use crate::local::stage::Stage;
use crate::local::{repo_root, tls};

/// The local kind cluster every `--target kind` environment shares.
pub const KIND_CLUSTER: &str = "macro-envs";
/// Host port the kind cluster's ingress listens on (loopback only).
pub const KIND_HTTPS_PORT: u16 = 9443;

/// The shared EKS environments cluster (`infra/stacks/environments-cluster`).
pub const EKS_CLUSTER: &str = "macro-environments";
/// Wildcard domain the environments cluster serves (`*.<domain>`).
pub const EKS_DOMAIN: &str = "env.macro-internal.com";
const EKS_REGION: &str = "us-east-1";
/// The one ECR repository environment images are pushed to, tagged
/// `<image>-<content digest>`.
const EKS_REPOSITORY: &str = "macro-env";
/// The role developers assume to reach the cluster (the stack's
/// `developerRoleArn`, by name).
const EKS_DEVELOPER_ROLE: &str = "macro-environments-developer-dev";

/// The ingress controller both targets run, pinned.
const TRAEFIK_CHART: &str = "oci://ghcr.io/traefik/helm/traefik";
pub const TRAEFIK_VERSION: &str = "42.3.0";

/// Local tag prefix for images built before they are published.
const BUILD_PREFIX: &str = "macro-env-build";

/// Repository-root bind mounts (`.:/app`) are baked by installing the
/// workspace in the image instead of copying the host's `node_modules`.
const WORKSPACE_BAKE_DOCKERFILE: &str = "docker/k8s/workspace-bake.Dockerfile";

pub enum ClusterTarget {
    Kind { https_port: u16 },
    Eks { cluster: String, domain: String },
}

impl ClusterTarget {
    pub fn from_args(args: &ClusterArgs) -> Result<Self> {
        Ok(match args.target {
            TargetKind::Kind => ClusterTarget::Kind {
                https_port: args.kind_https_port,
            },
            TargetKind::Eks => ClusterTarget::Eks {
                cluster: args.eks_cluster.clone(),
                domain: args.eks_domain.clone(),
            },
        })
    }

    pub fn label(&self) -> &'static str {
        match self {
            ClusterTarget::Kind { .. } => "kind",
            ClusterTarget::Eks { .. } => "eks",
        }
    }

    /// The kubeconfig context for this target.
    pub fn context(&self) -> String {
        match self {
            ClusterTarget::Kind { .. } => format!("kind-{KIND_CLUSTER}"),
            ClusterTarget::Eks { cluster, .. } => cluster.clone(),
        }
    }

    pub fn host(&self, name: &EnvName) -> String {
        match self {
            ClusterTarget::Kind { .. } => format!("{}.localhost", name.as_str()),
            ClusterTarget::Eks { domain, .. } => format!("{}.{domain}", name.as_str()),
        }
    }

    pub fn origin(&self, name: &EnvName) -> String {
        match self {
            ClusterTarget::Kind { https_port: 443 } | ClusterTarget::Eks { .. } => {
                format!("https://{}", self.host(name))
            }
            ClusterTarget::Kind { https_port } => {
                format!("https://{}:{https_port}", self.host(name))
            }
        }
    }

    pub fn kubectl(&self) -> Command {
        let mut cmd = Command::new("kubectl");
        cmd.args(["--context", &self.context()]);
        cmd
    }

    pub fn helm(&self) -> Command {
        let mut cmd = Command::new("helm");
        cmd.args(["--kube-context", &self.context()]);
        cmd
    }

    /// Make the cluster usable: create it (kind) or fetch its credentials
    /// (EKS), install the ingress controller (kind; Pulumi owns it on EKS), and
    /// log in to the image registry.
    pub fn ensure_ready(&self, stage: &Stage) -> Result<()> {
        match self {
            ClusterTarget::Kind { https_port } => {
                ensure_kind_cluster(stage, *https_port)?;
                self.install_kind_ingress(stage)
            }
            ClusterTarget::Eks { .. } => {
                self.ensure_context(stage)?;
                let registry = self.registry()?;
                let password = Command::new("aws")
                    .args(["ecr", "get-login-password", "--region", EKS_REGION])
                    .output()
                    .context("running aws ecr get-login-password")?;
                ensure!(
                    password.status.success(),
                    "aws ecr get-login-password failed: {}",
                    String::from_utf8_lossy(&password.stderr)
                );
                let mut login = Command::new("docker")
                    .args(["login", "--username", "AWS", "--password-stdin", &registry])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .spawn()
                    .context("running docker login")?;
                if let Some(stdin) = login.stdin.as_mut() {
                    use std::io::Write;
                    stdin.write_all(&password.stdout)?;
                }
                ensure!(login.wait()?.success(), "docker login to {registry} failed");
                Ok(())
            }
        }
    }

    /// Point kubectl at the target without creating anything.
    pub fn ensure_context(&self, stage: &Stage) -> Result<()> {
        match self {
            ClusterTarget::Kind { .. } => Ok(()),
            ClusterTarget::Eks { cluster, .. } => {
                let role = format!("arn:aws:iam::{}:role/{EKS_DEVELOPER_ROLE}", aws_account()?);
                let mut cmd = Command::new("aws");
                cmd.args([
                    "eks",
                    "update-kubeconfig",
                    "--name",
                    cluster,
                    "--region",
                    EKS_REGION,
                    "--alias",
                    cluster,
                    "--role-arn",
                    &role,
                ]);
                stage.run(&format!("Fetching credentials for {cluster}"), &mut cmd)
            }
        }
    }

    fn install_kind_ingress(&self, stage: &Stage) -> Result<()> {
        let values = json!({
            "nodeSelector": { "ingress-ready": "true" },
            "tolerations": [{
                "key": "node-role.kubernetes.io/control-plane",
                "operator": "Exists",
                "effect": "NoSchedule",
            }],
            "service": { "type": "ClusterIP" },
            "ingressClass": { "enabled": true, "isDefaultClass": true, "name": "traefik" },
            "ports": {
                "websecure": {
                    "hostPort": 443,
                    // Uploads and long requests: no entrypoint read deadline.
                    "transport": { "respondingTimeouts": { "readTimeout": 0 } },
                },
            },
        });
        let path = std::env::temp_dir().join("macro-env-kind-traefik.json");
        std::fs::write(&path, values.to_string())?;
        let mut cmd = self.helm();
        cmd.args([
            "upgrade",
            "--install",
            "traefik",
            TRAEFIK_CHART,
            "--version",
            TRAEFIK_VERSION,
            "-n",
            "traefik",
            "--create-namespace",
            "--wait",
            "-f",
        ])
        .arg(&path);
        stage.run("Installing the ingress controller (Traefik)", &mut cmd)
    }

    fn registry(&self) -> Result<String> {
        Ok(format!(
            "{}.dkr.ecr.{EKS_REGION}.amazonaws.com",
            aws_account()?
        ))
    }

    /// Publish a locally built image under its content digest and return the
    /// reference the cluster pulls.
    fn publish(&self, stage: &Stage, key: &str, local_tag: &str) -> Result<String> {
        let id = image_digest(local_tag)?;
        let reference = match self {
            ClusterTarget::Kind { .. } => format!("macro-env/{key}:{id}"),
            ClusterTarget::Eks { .. } => {
                format!("{}/{EKS_REPOSITORY}:{key}-{id}", self.registry()?)
            }
        };
        run_quiet(Command::new("docker").args(["tag", local_tag, &reference]))?;
        match self {
            ClusterTarget::Kind { .. } => {
                if !kind_has_image(&reference) {
                    let mut load = Command::new("kind");
                    load.args(["load", "docker-image", "--name", KIND_CLUSTER, &reference]);
                    stage.run(&format!("Loading {key} into kind"), &mut load)?;
                }
            }
            ClusterTarget::Eks { .. } => {
                let mut push = Command::new("docker");
                push.args(["push", "--quiet", &reference]);
                stage.run(&format!("Pushing {key}"), &mut push)?;
            }
        }
        Ok(reference)
    }

    /// The TLS certificate the ingress serves, when TLS terminates in-cluster.
    pub fn tls_secret(&self, instance: &Instance) -> Result<Option<TlsSecret>> {
        match self {
            // `stack up`'s certificate: signed by the development CA, valid
            // for `*.localhost`.
            ClusterTarget::Kind { .. } => {
                let dir = tls::certs_dir(instance);
                Ok(Some(TlsSecret {
                    cert: std::fs::read_to_string(dir.join("server.pem"))
                        .context("reading the development certificate")?,
                    key: std::fs::read_to_string(dir.join("server-key.pem"))
                        .context("reading the development certificate key")?,
                }))
            }
            // The NLB terminates TLS with the cluster's ACM wildcard.
            ClusterTarget::Eks { .. } => Ok(None),
        }
    }

    pub fn ingress_values(&self, tls_secret: &str) -> Value {
        json!({ "className": "traefik", "tlsSecret": tls_secret })
    }

    pub fn storage_class(&self) -> &'static str {
        match self {
            ClusterTarget::Kind { .. } => "",
            ClusterTarget::Eks { .. } => "gp3",
        }
    }

    pub fn trust_note(&self) -> Option<String> {
        match self {
            ClusterTarget::Kind { .. } => Some(format!(
                "tls:      trust {} once on this machine",
                repo_root().join("infra/local/certs/ca.pem").display()
            )),
            ClusterTarget::Eks { .. } => None,
        }
    }

    /// `kubectl apply --server-side` a manifest, keeping a copy at `path`.
    pub fn apply(&self, stage: &Stage, manifest: &Value, path: &Path) -> Result<()> {
        std::fs::write(path, serde_json::to_string_pretty(manifest)?)?;
        let kind = manifest["kind"].as_str().unwrap_or("manifest");
        let name = manifest["metadata"]["name"].as_str().unwrap_or("");
        let mut cmd = self.kubectl();
        cmd.args(["apply", "--server-side", "--force-conflicts", "-f"])
            .arg(path);
        stage.run(&format!("Applying {kind} {name}"), &mut cmd)
    }

    pub fn release_exists(&self, name: &EnvName) -> bool {
        self.helm()
            .args(["status", name.as_str(), "-n", &name.namespace()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }

    /// `helm upgrade --install` the environment, waiting for every selected
    /// workload to become ready.
    pub fn helm_install(
        &self,
        stage: &Stage,
        name: &EnvName,
        values: &Path,
        only_infra: bool,
    ) -> Result<()> {
        let mut cmd = self.helm();
        cmd.args(["upgrade", "--install", name.as_str()])
            .arg(super::chart_dir())
            .args(["-n", &name.namespace(), "-f"])
            .arg(values)
            .args([
                "--set",
                &format!("onlyInfra={only_infra}"),
                "--wait",
                "--timeout",
                super::HELM_TIMEOUT,
            ]);
        let label = if only_infra {
            "Starting infra (helm, waiting for readiness)"
        } else {
            "Starting services (helm, waiting for readiness)"
        };
        let result = stage.run(label, &mut cmd);
        if result.is_err() {
            let _ = self
                .kubectl()
                .args(["-n", &name.namespace(), "get", "pods", "-o", "wide"])
                .status();
        }
        result
    }

    pub fn port_forward(
        &self,
        namespace: &str,
        svc: &str,
        local: u16,
        remote: u16,
    ) -> Result<Child> {
        self.kubectl()
            .args([
                "-n",
                namespace,
                "port-forward",
                &format!("svc/{svc}"),
                &format!("{local}:{remote}"),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("port-forwarding {svc}"))
    }
}

pub struct TlsSecret {
    cert: String,
    key: String,
}

impl TlsSecret {
    pub fn manifest(&self, namespace: &str) -> Value {
        json!({
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": { "name": super::TLS_SECRET, "namespace": namespace },
            "type": "kubernetes.io/tls",
            "stringData": { "tls.crt": self.cert, "tls.key": self.key },
        })
    }
}

fn ensure_kind_cluster(stage: &Stage, https_port: u16) -> Result<()> {
    let out = Command::new("kind")
        .args(["get", "clusters"])
        .output()
        .context("running kind (run inside nix develop)")?;
    ensure!(out.status.success(), "kind get clusters failed");
    if String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|l| l.trim() == KIND_CLUSTER)
    {
        return Ok(());
    }
    let config = format!(
        r#"kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 443
        hostPort: {https_port}
        listenAddress: 127.0.0.1
"#
    );
    let path = std::env::temp_dir().join("macro-env-kind.yaml");
    std::fs::write(&path, config)?;
    let mut cmd = Command::new("kind");
    cmd.args(["create", "cluster", "--name", KIND_CLUSTER, "--config"])
        .arg(&path);
    stage.run(&format!("Creating kind cluster {KIND_CLUSTER}"), &mut cmd)
}

fn kind_has_image(reference: &str) -> bool {
    let node = format!("{KIND_CLUSTER}-control-plane");
    let full = if reference.contains('/')
        && !reference.split('/').next().is_some_and(|r| r.contains('.'))
    {
        format!("docker.io/{reference}")
    } else {
        reference.to_owned()
    };
    Command::new("docker")
        .args(["exec", &node, "crictl", "inspecti", &full])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn aws_account() -> Result<String> {
    let out = Command::new("aws")
        .args([
            "sts",
            "get-caller-identity",
            "--query",
            "Account",
            "--output",
            "text",
        ])
        .output()
        .context("running aws sts get-caller-identity")?;
    ensure!(
        out.status.success(),
        "aws sts get-caller-identity failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?.trim().to_owned())
}

/// The first 12 hex characters of a local image's ID.
fn image_digest(tag: &str) -> Result<String> {
    let out = Command::new("docker")
        .args(["image", "inspect", "--format", "{{.Id}}", tag])
        .output()
        .context("running docker image inspect")?;
    ensure!(out.status.success(), "image {tag} not found");
    let id = String::from_utf8(out.stdout)?;
    let hex = id.trim().trim_start_matches("sha256:");
    ensure!(hex.len() >= 12, "unexpected image id {id}");
    Ok(hex[..12].to_owned())
}

fn run_quiet(cmd: &mut Command) -> Result<()> {
    let out = cmd.output().context("running docker")?;
    ensure!(
        out.status.success(),
        "{:?} failed: {}",
        cmd,
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// Build every image the environment needs and publish it to the target.
/// Returns compose service name → image reference for [`render::Inputs`].
pub fn build_images(
    stage: &Stage,
    target: &ClusterTarget,
    compose: &Value,
    binaries: &BinariesDir,
    dir: &Path,
) -> Result<BTreeMap<String, String>> {
    // compose service → (image key, local tag)
    let mut local: BTreeMap<String, (String, String)> = BTreeMap::new();

    if !super::runtime_binaries(compose)?.is_empty() {
        let ctx = stage_services_context(stage, compose, binaries, dir)?;
        let tag = format!("{BUILD_PREFIX}/services:latest");
        let mut build = Command::new("docker");
        build.args(["build", "-t", &tag]).arg(&ctx);
        stage.run("Building the services image", &mut build)?;
        for (name, svc) in render::services(compose)? {
            if svc.get("image").and_then(Value::as_str) == Some(RUNTIME_IMAGE_TAG) {
                local.insert(name.to_owned(), ("services".into(), tag.clone()));
            }
        }
    }

    for (name, svc) in render::services(compose)? {
        let Some(spec) = svc.get("build") else {
            continue;
        };
        let key = render::dns_name(name);
        let tag = format!("{BUILD_PREFIX}/{key}:latest");
        let mut build = compose_build(spec, &tag)?;
        stage.run(&format!("Building {key}"), &mut build)?;
        local.insert(name.to_owned(), (key, tag));
    }

    let mut baked: BTreeMap<String, Vec<BakedMount>> = BTreeMap::new();
    for mount in render::large_bind_mounts(compose)? {
        baked.entry(mount.service.clone()).or_default().push(mount);
    }
    for (service, mounts) in baked {
        let svc = render::services(compose)?
            .into_iter()
            .find(|(n, _)| *n == service)
            .map(|(_, s)| s)
            .context("baked mount for an unknown service")?;
        let mut base = match local.get(&service) {
            Some((_, tag)) => tag.clone(),
            None => svc
                .get("image")
                .and_then(Value::as_str)
                .context("service without image")?
                .to_owned(),
        };
        let key = format!("{}-baked", render::dns_name(&service));
        let tag = format!("{BUILD_PREFIX}/{key}:latest");
        for mount in mounts {
            let mut build = bake(&base, &mount, &tag, dir)?;
            stage.run(
                &format!(
                    "Baking {} into {}",
                    mount.target,
                    render::dns_name(&service)
                ),
                &mut build,
            )?;
            base = tag.clone();
        }
        local.insert(service, (key, tag));
    }

    let mut published: BTreeMap<String, String> = BTreeMap::new();
    let mut images = BTreeMap::new();
    for (service, (key, tag)) in local {
        let reference = match published.get(&tag) {
            Some(r) => r.clone(),
            None => {
                let r = target.publish(stage, &key, &tag)?;
                published.insert(tag.clone(), r.clone());
                r
            }
        };
        images.insert(service, reference);
    }
    Ok(images)
}

fn stage_services_context(
    stage: &Stage,
    compose: &Value,
    binaries: &BinariesDir,
    dir: &Path,
) -> Result<PathBuf> {
    let mut ctx = None;
    stage.run_step("Staging stripped service binaries", || {
        ctx = Some(super::services_image_context(compose, binaries, dir)?);
        Ok(())
    })?;
    ctx.context("services image context was not staged")
}

/// `docker build` for a compose `build:` spec.
fn compose_build(spec: &Value, tag: &str) -> Result<Command> {
    let context = spec
        .get("context")
        .and_then(Value::as_str)
        .context("compose build without context")?;
    let mut cmd = Command::new("docker");
    cmd.args(["build", "-t", tag]);
    if let Some(dockerfile) = spec.get("dockerfile").and_then(Value::as_str) {
        let path = Path::new(dockerfile);
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            Path::new(context).join(path)
        };
        cmd.arg("-f").arg(path);
    }
    if let Some(target) = spec.get("target").and_then(Value::as_str) {
        cmd.args(["--target", target]);
    }
    for (k, v) in spec
        .get("args")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if let Some(v) = v.as_str() {
            cmd.args(["--build-arg", &format!("{k}={v}")]);
        }
    }
    cmd.arg(context);
    Ok(cmd)
}

/// `docker build` that bakes one large bind mount into `base`.
fn bake(base: &str, mount: &BakedMount, tag: &str, dir: &Path) -> Result<Command> {
    let mut cmd = Command::new("docker");
    cmd.args(["build", "-t", tag, "--build-arg", &format!("BASE={base}")]);
    if mount.source == repo_root() {
        if mount.target != "/app" {
            bail!(
                "repository mounts must target /app to be baked (got {})",
                mount.target
            );
        }
        let token = macro_env_var::maybe_read_env("GITHUB_PACKAGES_TOKEN").unwrap_or_default();
        cmd.args(["--build-arg", &format!("GITHUB_PACKAGES_TOKEN={token}")])
            .arg("-f")
            .arg(repo_root().join(WORKSPACE_BAKE_DOCKERFILE))
            .arg(repo_root());
        return Ok(cmd);
    }
    let dockerfile = dir.join(format!(
        "bake-{}.Dockerfile",
        render::dns_name(&mount.target.trim_matches('/').replace('/', "-"))
    ));
    std::fs::write(
        &dockerfile,
        format!("ARG BASE\nFROM ${{BASE}}\nCOPY . {}\n", mount.target),
    )?;
    cmd.arg("-f").arg(dockerfile).arg(&mount.source);
    Ok(cmd)
}
