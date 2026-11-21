//! The container engine port: what macrod asks of Docker or Podman to run a
//! teammate, and the exact `run` flags every engine gets.

use std::ffi::OsString;
use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngineKind, TeammateInstall, TeammateInstallId,
};
use ipnet::IpNet;
use teammate_lifecycle::exit::{PREVIOUS_EXIT_VARIABLE, PreviousExit};

use super::egress::NetworkFacts;

/// The label naming a container's install.
pub const INSTALL_LABEL: &str = "macro.teammate.install";

/// The label naming the generation a container runs.
pub const GENERATION_LABEL: &str = "macro.teammate.generation";

/// The label naming which delivery of that generation a container runs.
pub const DELIVERY_LABEL: &str = "macro.teammate.delivery";

/// Where the volume is mounted in the container: the agent's home.
pub const VOLUME_TARGET: &str = "/teammate";

/// Where the credentials file appears in the container.
pub const CREDENTIALS_TARGET: &str = "/run/teammate/agent.env";

/// Where the provider volume is mounted in the container, read-only.
pub const PROVIDER_TARGET: &str = "/teammate-provider";

/// What an engine says about itself and the machine it runs containers on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineInfo {
    /// Which engine answered.
    pub kind: ContainerEngineKind,
    /// Its server version.
    pub version: String,
    /// Whether the version is one macrod supports: Docker Engine 24 or
    /// later (seccomp files, `--mount` volumes), Podman 4.4 or later (pasta).
    pub supported_version: bool,
    /// Whether it runs without root on the host.
    pub rootless: bool,
    /// CPUs the engine's containers can use.
    pub cpus: u32,
    /// Memory the engine's containers can use, in MiB.
    pub memory_mib: u64,
    /// Free disk where the engine keeps images and volumes, in MiB, when the
    /// host can see it (not inside a Docker Desktop VM).
    pub disk_free_mib: Option<u64>,
}

/// Why no engine answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineUnavailable {
    /// Neither `docker` nor `podman` is on `PATH`.
    NotInstalled,
    /// One is installed but its server didn't answer.
    Unreachable,
}

/// An engine command failed. The message is the engine's own, without the
/// credentials file's contents (they never reach a command line).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct EngineError(pub String);

/// A credentials path a `--mount` option list can't carry.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the credentials path {} has a ',' or '=', which a --mount can't carry", .0.display())]
pub struct UnsafeMountPath(pub PathBuf);

/// A container as the engine last saw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerState {
    /// Its id.
    pub id: Option<String>,
    /// Whether it runs now.
    pub running: bool,
    /// Its [`GENERATION_LABEL`] and [`DELIVERY_LABEL`], when it has both.
    pub delivery: Option<Delivery>,
    /// The id (`sha256:<hex>`) of the image it runs.
    pub image_id: Option<String>,
}

/// A `(generation, delivery)` pair, ordered as the service counts them:
/// a runtime applies the highest it has seen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Delivery {
    /// The install's generation.
    pub generation: u64,
    /// Which delivery of that generation.
    pub delivery: u64,
}

impl Delivery {
    /// The pair an install names.
    pub fn of(install: &TeammateInstall) -> Self {
        Self {
            generation: install.generation,
            delivery: install.delivery,
        }
    }
}

/// One teammate container, as `run` creates it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSpec {
    /// The install it belongs to.
    pub install_id: TeammateInstallId,
    /// The generation and delivery it runs.
    pub delivery: Delivery,
    /// The image's id, `sha256:<hex>`.
    pub image_id: String,
    /// The host file bound read-only at [`CREDENTIALS_TARGET`].
    pub credentials_file: PathBuf,
    /// The seccomp profile: Docker's default plus user namespaces for the
    /// inner sandboxes.
    pub seccomp_profile: PathBuf,
    /// The previous run's exit, for `teammate-boot`'s failed-boot count.
    pub previous_exit: PreviousExit,
    /// The holder whose network namespace the container joins (by id, so
    /// a holder recreated under the name is never joined unchecked).
    pub holder_id: String,
}

/// A Docker network name the engine reads only as a name: a letter or
/// digit, then letters, digits, `_`, `.` or `-`, at most 128.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeammateNetwork(String);

/// A name that isn't a network name.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not a network name")]
pub struct InvalidTeammateNetwork(String);

impl TeammateNetwork {
    /// `name`, if it is a network name.
    pub fn new(name: &str) -> Result<Self, InvalidTeammateNetwork> {
        if lazy_regex::regex_is_match!(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", name) {
            Ok(Self(name.to_owned()))
        } else {
            Err(InvalidTeammateNetwork(name.to_owned()))
        }
    }

    /// The name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl RunSpec {
    /// The container's name.
    pub fn container(&self) -> String {
        container_name(&self.install_id)
    }
}

/// `macro-teammate-<install>`: the container's name.
pub fn container_name(install_id: &TeammateInstallId) -> String {
    format!("macro-teammate-{}", install_id.as_str())
}

/// `macro-teammate-<install>`: the install's own bridge network, so two
/// teammates on one machine can't reach each other (containers, networks
/// and volumes have separate namespaces).
pub fn network_name(install_id: &TeammateInstallId) -> String {
    container_name(install_id)
}

/// `macro-teammate-<install>`: the agent volume's name.
pub fn volume_name(install_id: &TeammateInstallId) -> String {
    container_name(install_id)
}

/// `macro-teammate-<install>-provider`: the provider sign-in's volume.
pub fn provider_volume_name(install_id: &TeammateInstallId) -> String {
    format!("{}-provider", container_name(install_id))
}

/// A container engine. Every method is safe to repeat: removing what is
/// absent and creating what exists succeed.
pub trait Engine: Send + Sync + 'static {
    /// Find the engine and ask it about the machine.
    fn info(&self) -> impl Future<Output = Result<EngineInfo, EngineUnavailable>> + Send;

    /// Whether a container of `image` can make a user namespace under the
    /// teammate's seccomp profile and without capabilities, as bubblewrap
    /// and Chromium's sandbox do.
    fn user_namespaces(
        &self,
        image: &str,
        seccomp_profile: &std::path::Path,
    ) -> impl Future<Output = Result<bool, EngineError>> + Send;

    /// The id (config digest) of a local image, `None` when it isn't here.
    fn image_id(
        &self,
        reference: &str,
    ) -> impl Future<Output = Result<Option<String>, EngineError>> + Send;

    /// Pull an image by reference.
    fn pull(&self, reference: &str) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Create a named bridge network unless it exists.
    fn create_network(&self, name: &str) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Remove a named network if it exists.
    fn remove_network(&self, name: &str) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Create a named volume unless it exists.
    fn create_volume(&self, name: &str) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Remove a named volume if it exists.
    fn remove_volume(&self, name: &str) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// The container's state, `None` when there is none.
    fn container(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Option<ContainerState>, EngineError>> + Send;

    /// Create and start the container, detached.
    fn run(&self, spec: &RunSpec) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Stop the container: SIGTERM, then SIGKILL after `grace`.
    fn stop(
        &self,
        name: &str,
        grace: Duration,
    ) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Remove the container if it exists, running or not.
    fn remove_container(&self, name: &str) -> impl Future<Output = Result<(), EngineError>> + Send;

    /// Wait for the container to exit and return its exit code.
    fn wait(&self, name: &str) -> impl Future<Output = Result<i64, EngineError>> + Send;

    /// The engines installed here that the configured choice allows, in
    /// the order `auto` prefers them (Docker, then Podman).
    fn installed(&self) -> Vec<ContainerEngineKind>;

    /// Make `kind` the engine every other call uses, and say what it is.
    fn select(
        &self,
        kind: ContainerEngineKind,
    ) -> impl Future<Output = Result<EngineInfo, EngineUnavailable>> + Send;

    /// Create and start an install's holder (it only owns the network
    /// namespace) and return its container id.
    fn run_holder(
        &self,
        spec: &HolderSpec,
    ) -> impl Future<Output = Result<String, EngineError>> + Send;

    /// What the holder's namespace and networks say: resolvers, the
    /// gateways of `networks`, and the prefixes of `networks` and of every
    /// other network the engine has (not the host's: see `host_prefixes`).
    fn network_facts(
        &self,
        holder_id: &str,
        networks: &[String],
    ) -> impl Future<Output = Result<NetworkFacts, EngineError>> + Send;

    /// The addresses a name has inside the holder's namespace (a local
    /// stack's service names resolve only there).
    fn resolve(
        &self,
        holder_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<Vec<std::net::IpAddr>, EngineError>> + Send;

    /// The addresses, on-link prefixes and routes of the machine the
    /// engine's containers run on, read now.
    fn host_network(&self) -> impl Future<Output = Result<HostNetwork, EngineError>> + Send;

    /// Run the guard, a one-shot in the holder's namespace that alone has
    /// `NET_ADMIN`: load `ruleset` with `nft -f -` (none: load nothing),
    /// then print `nft -j list table`. It exits, and is removed, before
    /// this returns.
    fn guard(
        &self,
        holder_id: &str,
        image_id: &str,
        ruleset: Option<&str>,
    ) -> impl Future<Output = Result<String, GuardError>> + Send;
}

/// What the machine's addresses and routes say, for the ruleset.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostNetwork {
    /// Its addresses and on-link prefixes, and every route's destination
    /// but the defaults: all dropped.
    pub prefixes: Vec<IpNet>,
    /// Whether a default (or split default) route goes to the internet, v4
    /// or v6. Without one the agent reaches nothing its policy leaves it.
    pub to_the_internet: bool,
}

/// The holder of an install's network namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HolderSpec {
    /// The install it belongs to.
    pub install_id: TeammateInstallId,
    /// The image it runs (`sleep`, the teammate's pinned image).
    pub image_id: String,
    /// The networks it joins: the install's own, and a local stack's.
    pub networks: Vec<String>,
}

/// `macro-teammate-<install>-net`: the holder's name.
pub fn holder_name(install_id: &TeammateInstallId) -> String {
    format!("{}-net", container_name(install_id))
}

/// Why the guard didn't put the ruleset in place.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GuardError {
    /// The engine couldn't run it (it may pass: backed off like a crash).
    #[error("the engine could not run the guard: {0}")]
    Engine(EngineError),
    /// It ran and `nft` refused: isolation can't be put in place here.
    #[error("the guard could not load the ruleset: {0}")]
    Refused(String),
}

/// The arguments after `<engine>` that create a teammate container
/// (docs/design/teammate-runtime.md, *The container*).
///
/// uid 1000, a read-only root, no capabilities, no privilege gain, the
/// teammate seccomp profile, process, memory and CPU limits, the holder's
/// network namespace (its egress policy loaded), and exactly three mounts: the agent volume, the
/// provider volume read-only and the credentials file read-only. Never the
/// host's home, an engine socket, `--privileged`, devices, published ports
/// or the host's namespaces. `--restart no`: macrod alone starts it again.
/// The only environment is `TEAMMATE_PREVIOUS_EXIT`, never a credential.
///
/// `--mount` is a comma-separated `key=value` list, so a credentials path
/// with `,` or `=` (a home directory named so) could add or change mount
/// options: it is refused.
pub fn run_arguments(spec: &RunSpec) -> Result<Vec<OsString>, UnsafeMountPath> {
    let path = spec.credentials_file.as_os_str().as_encoded_bytes();
    if path.iter().any(|byte| matches!(byte, b',' | b'=')) {
        return Err(UnsafeMountPath(spec.credentials_file.clone()));
    }
    let name = spec.container();
    let volume = volume_name(&spec.install_id);
    let provider = provider_volume_name(&spec.install_id);
    let mut credentials_mount = OsString::from("type=bind,src=");
    credentials_mount.push(&spec.credentials_file);
    credentials_mount.push(format!(",dst={CREDENTIALS_TARGET},readonly"));

    let mut seccomp = OsString::from("seccomp=");
    seccomp.push(&spec.seccomp_profile);

    let mut arguments: Vec<OsString> = [
        "run",
        "--detach",
        "--name",
        &name,
        "--user",
        "1000:1000",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--security-opt",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    arguments.push(seccomp);
    arguments.extend(
        [
            "--pids-limit".to_owned(),
            "512".to_owned(),
            "--memory".to_owned(),
            "4g".to_owned(),
            "--cpus".to_owned(),
            "2".to_owned(),
            "--shm-size".to_owned(),
            "1g".to_owned(),
            "--tmpfs".to_owned(),
            "/tmp".to_owned(),
            "--tmpfs".to_owned(),
            "/run/teammate-runtime".to_owned(),
            "--network".to_owned(),
            format!("container:{}", spec.holder_id),
        ]
        .into_iter()
        .map(OsString::from),
    );
    arguments.extend(
        [
            "--mount".to_owned(),
            format!("type=volume,src={volume},dst={VOLUME_TARGET}"),
            "--mount".to_owned(),
            format!("type=volume,src={provider},dst={PROVIDER_TARGET},readonly"),
            "--mount".to_owned(),
        ]
        .into_iter()
        .map(OsString::from),
    );
    arguments.push(credentials_mount);
    arguments.extend(
        [
            "--label".to_owned(),
            format!("{INSTALL_LABEL}={}", spec.install_id.as_str()),
            "--label".to_owned(),
            format!("{GENERATION_LABEL}={}", spec.delivery.generation),
            "--label".to_owned(),
            format!("{DELIVERY_LABEL}={}", spec.delivery.delivery),
            "--env".to_owned(),
            format!("{PREVIOUS_EXIT_VARIABLE}={}", spec.previous_exit),
            "--restart".to_owned(),
            "no".to_owned(),
            spec.image_id.clone(),
        ]
        .into_iter()
        .map(OsString::from),
    );
    Ok(arguments)
}

/// The label naming what a teammate's container is for.
pub const ROLE_LABEL: &str = "macro.teammate.role";

/// The arguments after `<engine>` that create an install's holder: the
/// pinned image running `sleep`, uid 1000, no capabilities, no privilege
/// gain, read-only, small limits, on the install's networks. It shares
/// nothing but its network namespace, and only by id (`--network
/// container:<id>`, never `--pid` or `--ipc`).
pub fn holder_arguments(spec: &HolderSpec) -> Vec<OsString> {
    let mut arguments: Vec<OsString> = [
        "run",
        "--detach",
        "--name",
        &holder_name(&spec.install_id),
        "--user",
        "1000:1000",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        "16",
        "--memory",
        "64m",
        // Unprivileged ping for the agent's group only (gid 1000), as
        // Docker allows by default and rootless Podman doesn't; a wider
        // range fails on rootless Podman, beyond its mapped gids. The
        // policy still decides where to.
        "--sysctl",
        "net.ipv4.ping_group_range=1000 1000",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    for network in &spec.networks {
        arguments.push("--network".into());
        arguments.push(network.into());
    }
    arguments.extend(
        [
            "--label".to_owned(),
            format!("{INSTALL_LABEL}={}", spec.install_id.as_str()),
            "--label".to_owned(),
            format!("{ROLE_LABEL}=holder"),
            "--restart".to_owned(),
            "no".to_owned(),
            "--entrypoint".to_owned(),
            "sleep".to_owned(),
            spec.image_id.clone(),
            "infinity".to_owned(),
        ]
        .into_iter()
        .map(OsString::from),
    );
    arguments
}

/// What the guard runs: load the ruleset from stdin (when there is one),
/// then print the table.
pub fn guard_script(load: bool) -> &'static str {
    if load {
        "nft -f - && nft -j list table inet macro_teammate"
    } else {
        "nft -j list table inet macro_teammate"
    }
}

/// The arguments after `<engine>` that run the guard: in the holder's
/// network namespace only, uid 0 with `NET_ADMIN` and no other capability,
/// read-only, no mounts, the ruleset on stdin, removed when it exits.
pub fn guard_arguments(holder_id: &str, image_id: &str, load: bool) -> Vec<OsString> {
    [
        "run",
        "--rm",
        "--interactive",
        "--network",
        &format!("container:{holder_id}"),
        "--user",
        "0:0",
        "--read-only",
        "--cap-drop=ALL",
        "--cap-add=NET_ADMIN",
        "--security-opt=no-new-privileges",
        "--pids-limit",
        "16",
        "--label",
        &format!("{ROLE_LABEL}=guard"),
        "--entrypoint",
        "sh",
        image_id,
        "-c",
        guard_script(load),
    ]
    .into_iter()
    .map(OsString::from)
    .collect()
}
