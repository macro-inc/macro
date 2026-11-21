//! [`Machines`](crate::domain::ports::Machines) as jailed Firecracker processes, one per computer.
//!
//! Each process runs under the jailer: its own uid/gid (`uid_base + slot`),
//! a chroot, its slot's netns, a new pid namespace, a
//! cgroup v2 leaf with cpu, memory and pids limits, and Firecracker's default
//! seccomp filter. The chroot holds hard links to the snapshot files and bind
//! mounts of the computer's rootfs and `/home`, at the fixed paths the
//! golden's vmstate records.

use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use firecracker_host_api::exec::GUEST_AGENT_PORT;

use firecracker_host_api::GuestImage;
use firecracker_host_api::mmds::Document;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tracing::Instrument;

use crate::domain::model::{ComputerRecord, Slot};
use crate::domain::ports::{ComputerDisks, DriveBacking, LaunchPhases};
use crate::outbound::file_clone::clone_file;
use crate::outbound::firecracker_api::{
    Balloon, BootSource as KernelSource, Drive, DriveUpdate, FirecrackerApi, FirecrackerApiError,
    InstanceAction, MachineConfig, MmdsConfig, NetworkInterface, SnapshotLoad, VmState, Vsock,
};
use crate::outbound::layout::{
    API_SOCKET, HOME, JailId, KERNEL, LOG, Layout, MEMORY, ROOTFS, VMSTATE, VSOCK,
};
use std::time::Instant;

mod golden_build;
mod machines;

/// `PATH` of commands the agent runs as root in a guest.
const GUEST_ROOT_PATH: &str = "/run/wrappers/bin:/run/current-system/sw/bin";
/// The guest's MAC; fixed by the golden, the same in every netns.
const GUEST_MAC: &str = "06:00:AC:10:00:02";
/// The guest's vsock CID; each VM has its own vsock device.
const GUEST_CID: u32 = 3;
/// The tap in every netns.
const TAP: &str = "tap0";
/// Placeholder size of the golden's `/home` drive; the guest refuses to
/// mount anything under 64 MiB.
const HOME_PLACEHOLDER_BYTES: u64 = 1024 * 1024;
/// Threads Firecracker needs beyond one per vCPU, with room to spare.
const PIDS_LIMIT: u32 = 128;
/// How long the API socket may take to appear after the jailer starts.
const API_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a killed process may take to be gone.
const KILL_TIMEOUT: Duration = Duration::from_secs(10);

/// A host operation on a jail failed.
#[derive(Debug, thiserror::Error)]
pub enum JailError {
    /// A file operation failed.
    #[error("{action} {path}: {source}")]
    Io {
        /// What was being done.
        action: &'static str,
        /// On what.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// Firecracker refused or failed.
    #[error(transparent)]
    Api(#[from] FirecrackerApiError),
    /// The jailer did not start Firecracker.
    #[error("the jailer for {jail} failed: {message}")]
    Jailer {
        /// Jail id.
        jail: JailId,
        /// Why.
        message: String,
    },
    /// The guest agent did not answer.
    #[error("guest agent of {jail} unreachable: {source}")]
    Guest {
        /// Jail id.
        jail: JailId,
        /// Why.
        source: GuestLinkError,
    },
    /// The golden holds a secret every customer could read.
    #[error("golden {path} contains {pattern:?} at byte {offset}; not publishing it")]
    SecretInGolden {
        /// The file.
        path: PathBuf,
        /// What was found.
        pattern: &'static str,
        /// Where.
        offset: u64,
    },
    /// The golden guest is not fit to be saved.
    #[error("not saving the golden: {0}")]
    GoldenRefused(GoldenRefusal),
    /// The process did not end.
    #[error("firecracker {pid} did not end")]
    Unkillable {
        /// Its pid.
        pid: i32,
    },
}

/// Why a settled golden guest is not saved.
#[derive(Debug, thiserror::Error)]
pub enum GoldenRefusal {
    /// The image's warm-up unit did not succeed.
    #[error("macro-warmup-done.service did not succeed ({0})")]
    WarmupUnfinished(String),
    /// Processes of the warm-up user are still alive.
    #[error("processes of user macro still run: {0:?}")]
    UserProcesses(Vec<String>),
}

/// How the vsock link to a guest agent failed.
#[derive(Debug, thiserror::Error)]
pub enum GuestLinkError {
    /// The hybrid vsock socket did not connect.
    #[error("{socket}: {source}")]
    Connect {
        /// The socket.
        socket: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// The `CONNECT` handshake broke off.
    #[error("vsock handshake: {0}")]
    Handshake(std::io::Error),
    /// Nothing listens on the guest agent's port yet.
    #[error("vsock answered {0:?}")]
    Refused(String),
    /// An exec frame did not go through.
    #[error(transparent)]
    Frame(#[from] firecracker_host_api::exec::FrameError),
    /// The guest agent could not run the program.
    #[error("the guest could not run it: {0}")]
    Failed(String),
    /// The guest closed the exec before the program exited.
    #[error("the guest closed the exec")]
    Closed,
    /// The program did not finish before the deadline.
    #[error("{0:?} did not finish in time")]
    TimedOut(Vec<String>),
}

fn io(action: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> JailError {
    let path = path.to_owned();
    move |source| JailError::Io {
        action,
        path,
        source,
    }
}

/// Everything the jails need from the configuration.
#[derive(Debug, Clone)]
pub struct JailSettings {
    /// Directories.
    pub layout: Layout,
    /// `firecracker`.
    pub firecracker: PathBuf,
    /// `jailer`.
    pub jailer: PathBuf,
    /// Slot `n` runs as `uid_base + n`.
    pub uid_base: u32,
    /// cgroup path (relative to `/sys/fs/cgroup`) VM cgroups go under.
    pub cgroup_parent: String,
    /// Extra memory per VM cgroup.
    pub memory_overhead_mib: u32,
    /// Netns names: `<prefix>-<slot>`.
    pub network_prefix: String,
    /// The slot golden builds use (one past the computers' slots).
    pub golden_slot: Slot,
    /// Clean shutdown deadline.
    pub shutdown_grace: Duration,
    /// How long a golden boot may take.
    pub golden_boot_timeout: Duration,
    /// How long a guest agent may take to answer.
    pub guest_agent_timeout: Duration,
}

/// The jailed processes.
#[derive(Debug, Clone)]
pub struct Jails {
    settings: std::sync::Arc<JailSettings>,
}

/// What one launch needs.
struct LaunchPlan<'a> {
    jail: JailId,
    slot: Slot,
    vcpus: u8,
    memory_mib: u32,
    rootfs: DriveBacking,
    /// `None` for the golden boot: a placeholder the guest never mounts.
    home: Option<DriveBacking>,
    image: &'a GuestImage,
}

impl Jails {
    /// The jails described by `settings`.
    pub fn new(settings: JailSettings) -> Self {
        Self {
            settings: std::sync::Arc::new(settings),
        }
    }

    fn layout(&self) -> &Layout {
        &self.settings.layout
    }

    fn uid(&self, slot: Slot) -> u32 {
        self.settings.uid_base + u32::from(slot.0)
    }

    fn api(&self, jail: &JailId) -> FirecrackerApi {
        FirecrackerApi::new(self.layout().in_chroot(jail, API_SOCKET))
    }

    fn cgroup(&self, jail: &JailId) -> PathBuf {
        Path::new("/sys/fs/cgroup")
            .join(&self.settings.cgroup_parent)
            .join(jail.as_str())
    }

    /// Create the chroot with the drives in place: empty files bind-mounted
    /// over by the durable rootfs and `/home` (or a placeholder `/home`).
    #[tracing::instrument(name = "firecracker_host.jail_prepare", skip_all, fields(jail = %plan.jail), err)]
    async fn prepare_chroot(&self, plan: &LaunchPlan<'_>) -> Result<(), JailError> {
        self.remove_jail(&plan.jail).await?;
        let chroot = self.layout().chroot(&plan.jail);
        tokio::fs::create_dir_all(&chroot)
            .await
            .map_err(io("create", &chroot))?;
        let uid = self.uid(plan.slot);

        let rootfs_target = self.layout().in_chroot(&plan.jail, ROOTFS);
        place_drive(&plan.rootfs, &rootfs_target, uid)?;

        let home_target = self.layout().in_chroot(&plan.jail, HOME);
        match &plan.home {
            Some(home) => place_drive(home, &home_target, uid)?,
            None => {
                let file =
                    std::fs::File::create(&home_target).map_err(io("create", &home_target))?;
                file.set_len(HOME_PLACEHOLDER_BYTES)
                    .map_err(io("size", &home_target))?;
                own(&home_target, uid, 0o600)?;
            }
        }

        let log = self.layout().in_chroot(&plan.jail, LOG);
        std::fs::File::create(&log).map_err(io("create", &log))?;
        own(&log, uid, 0o600)?;
        Ok(())
    }

    /// Bind-mount a snapshot's files into the chroot (they may sit on
    /// another dataset). They stay root's and read-only: a private mapping
    /// only needs read.
    fn link_snapshot(&self, jail: &JailId, directory: &Path) -> Result<(), JailError> {
        for (name, target) in [("vmstate", VMSTATE), ("mem", MEMORY)] {
            let source = directory.join(name);
            let target = self.layout().in_chroot(jail, target);
            std::fs::File::create(&target).map_err(io("create", &target))?;
            rustix::mount::mount_bind(&source, &target).map_err(|error| JailError::Io {
                action: "bind-mount",
                path: source.clone(),
                source: error.into(),
            })?;
        }
        Ok(())
    }

    /// Start the jailer; returns Firecracker's pid once its API answers.
    #[tracing::instrument(name = "firecracker_host.jailer_spawn", skip_all, fields(jail = %plan.jail, slot = i64::from(plan.slot.0), pid = tracing::field::Empty), err)]
    async fn spawn(&self, plan: &LaunchPlan<'_>) -> Result<i32, JailError> {
        let uid = self.uid(plan.slot).to_string();
        let netns = format!(
            "/var/run/netns/{}-{}",
            self.settings.network_prefix, plan.slot.0
        );
        let memory_max = format!(
            "memory.max={}M",
            plan.memory_mib + self.settings.memory_overhead_mib
        );
        let cpu_max = format!("cpu.max={} 100000", u32::from(plan.vcpus) * 100_000);
        let pids_max = format!("pids.max={PIDS_LIMIT}");
        let chroot_base = self.layout().jail_base();

        let output = tokio::process::Command::new(&self.settings.jailer)
            .args(["--id", plan.jail.as_str(), "--exec-file"])
            .arg(&self.settings.firecracker)
            .args(["--uid", &uid, "--gid", &uid, "--chroot-base-dir"])
            .arg(&chroot_base)
            .args(["--netns", &netns])
            .args(["--cgroup-version", "2", "--parent-cgroup"])
            .arg(&self.settings.cgroup_parent)
            .args([
                "--cgroup",
                &memory_max,
                "--cgroup",
                &cpu_max,
                "--cgroup",
                &pids_max,
                // An OOM kill takes the whole VM, never one Firecracker thread.
                "--cgroup",
                "memory.oom.group=1",
            ])
            .args(["--resource-limit", "no-file=4096"])
            .args(["--new-pid-ns", "--daemonize"])
            .args([
                "--",
                "--api-sock",
                API_SOCKET,
                "--level",
                "Warn",
                "--log-path",
                LOG,
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(io("run", &self.settings.jailer))?;
        if !output.status.success() {
            return Err(JailError::Jailer {
                jail: plan.jail.clone(),
                message: format!(
                    "{}: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            });
        }

        self.api(&plan.jail).wait_ready(API_TIMEOUT).await?;

        // With --new-pid-ns the jailer forks Firecracker and records its
        // host pid in the chroot.
        let pid_file = self.layout().in_chroot(&plan.jail, "/firecracker.pid");
        let pid_text = tokio::fs::read_to_string(&pid_file)
            .await
            .map_err(io("read", &pid_file))?;
        let pid = pid_text
            .trim()
            .parse::<i32>()
            .map_err(|error| JailError::Jailer {
                jail: plan.jail.clone(),
                message: format!("pid file {pid_text:?}: {error}"),
            })?;
        tracing::Span::current().record("pid", i64::from(pid));
        // The agent runs with oom_score_adj -1000 so it outlives any VM;
        // its VMs inherit that and must be the OOM killer's candidates.
        let oom_score_adj = PathBuf::from(format!("/proc/{pid}/oom_score_adj"));
        tokio::fs::write(&oom_score_adj, "0")
            .await
            .map_err(io("write", &oom_score_adj))?;
        Ok(pid)
    }

    /// Configure and boot a VM from a kernel (cold boot, golden boot).
    #[tracing::instrument(name = "firecracker_host.cold_boot", skip_all, fields(jail = %plan.jail), err)]
    async fn configure_and_boot(
        &self,
        plan: &LaunchPlan<'_>,
        document: &serde_json::Value,
    ) -> Result<(), JailError> {
        let image = self.layout().image(plan.image);
        let boot_args_path = image.join("boot_args");
        let boot_args = tokio::fs::read_to_string(&boot_args_path)
            .await
            .map_err(io("read", &boot_args_path))?;
        let api = self.api(&plan.jail);
        api.put(
            "/machine-config",
            &MachineConfig::new(plan.vcpus, plan.memory_mib),
        )
        .await?;
        api.put(
            "/boot-source",
            &KernelSource {
                kernel_image_path: KERNEL.to_owned(),
                boot_args: boot_args.trim().to_owned(),
            },
        )
        .await?;
        for (drive_id, path, is_root_device) in [("rootfs", ROOTFS, true), ("home", HOME, false)] {
            api.put(
                &format!("/drives/{drive_id}"),
                &Drive {
                    drive_id,
                    path_on_host: path,
                    is_root_device,
                    is_read_only: false,
                    cache_type: "Writeback",
                    discard: true,
                },
            )
            .await?;
        }
        api.put(
            "/network-interfaces/eth0",
            &NetworkInterface {
                iface_id: "eth0",
                host_dev_name: TAP,
                guest_mac: GUEST_MAC,
            },
        )
        .await?;
        api.put(
            "/mmds/config",
            &MmdsConfig {
                version: "V2",
                network_interfaces: ["eth0"],
            },
        )
        .await?;
        api.put("/mmds", document).await?;
        api.put(
            "/vsock",
            &Vsock {
                guest_cid: GUEST_CID,
                uds_path: VSOCK,
            },
        )
        .await?;
        api.put(
            "/balloon",
            &Balloon {
                amount_mib: 0,
                deflate_on_oom: true,
                stats_polling_interval_s: 0,
                free_page_reporting: true,
            },
        )
        .await?;
        api.put(
            "/actions",
            &InstanceAction {
                action_type: "InstanceStart",
            },
        )
        .await?;
        Ok(())
    }

    /// Load a snapshot paused, reopen the drives at their new sizes, serve
    /// the computer's MMDS document, resume.
    #[tracing::instrument(name = "firecracker_host.restore", skip_all, fields(jail = %jail), err)]
    async fn restore(
        &self,
        jail: &JailId,
        document: &Document,
        phases: &mut LaunchPhases,
    ) -> Result<(), JailError> {
        let api = self.api(jail);
        let started = Instant::now();
        api.put("/snapshot/load", &SnapshotLoad::paused(VMSTATE, MEMORY))
            .instrument(tracing::info_span!("firecracker_host.snapshot_load"))
            .await?;
        phases.snapshot_load_ms = Some(elapsed_ms(started));
        let started = Instant::now();
        async {
            for (drive_id, path) in [("rootfs", ROOTFS), ("home", HOME)] {
                api.patch(
                    &format!("/drives/{drive_id}"),
                    &DriveUpdate {
                        drive_id,
                        path_on_host: path,
                    },
                )
                .await?;
            }
            Ok::<_, FirecrackerApiError>(())
        }
        .instrument(tracing::info_span!("firecracker_host.drives_patch"))
        .await?;
        phases.drives_patch_ms = Some(elapsed_ms(started));
        let started = Instant::now();
        api.put("/mmds", document)
            .instrument(tracing::info_span!("firecracker_host.mmds_put"))
            .await?;
        phases.mmds_ms = Some(elapsed_ms(started));
        let started = Instant::now();
        api.patch("/vm", &VmState { state: "Resumed" })
            .instrument(tracing::info_span!("firecracker_host.resume"))
            .await?;
        phases.resume_ms = elapsed_ms(started);
        Ok(())
    }

    /// End a process: SIGKILL, then wait for it to be gone.
    async fn end(&self, pid: i32) -> Result<(), JailError> {
        let Some(process) = rustix::process::Pid::from_raw(pid) else {
            return Ok(());
        };
        if !is_firecracker(pid) {
            return Ok(());
        }
        let _ = rustix::process::kill_process(process, rustix::process::Signal::KILL);
        if wait_exit(pid, KILL_TIMEOUT).await {
            Ok(())
        } else {
            Err(JailError::Unkillable { pid })
        }
    }

    /// Unmount the drives, delete the chroot and the cgroup leaf. Safe to
    /// repeat; the drives are unmounted before anything is deleted, so the
    /// durable files are never touched.
    #[tracing::instrument(name = "firecracker_host.jail_remove", skip(self), err)]
    async fn remove_jail(&self, jail: &JailId) -> Result<(), JailError> {
        self.kill_cgroup(jail).await?;
        for path in [ROOTFS, HOME, VMSTATE, MEMORY] {
            let target = self.layout().in_chroot(jail, path);
            match rustix::mount::unmount(&target, rustix::mount::UnmountFlags::DETACH) {
                Ok(()) => {}
                // Not mounted, or already gone.
                Err(rustix::io::Errno::INVAL | rustix::io::Errno::NOENT) => {}
                Err(error) => {
                    return Err(JailError::Io {
                        action: "unmount",
                        path: target,
                        source: error.into(),
                    });
                }
            }
        }
        let directory = self.layout().jail(jail);
        match tokio::fs::remove_dir_all(&directory).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io("remove", &directory)(error)),
        }
        let cgroup = self.cgroup(jail);
        match tokio::fs::remove_dir(&cgroup).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io("remove", &cgroup)(error)),
        }
        Ok(())
    }

    /// Kill whatever still runs in the jail's cgroup (a process that failed
    /// halfway through a launch), and wait until the cgroup is empty.
    async fn kill_cgroup(&self, jail: &JailId) -> Result<(), JailError> {
        let cgroup = self.cgroup(jail);
        let kill = cgroup.join("cgroup.kill");
        match tokio::fs::write(&kill, "1").await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io("kill", &kill)(error)),
        }
        // The kernel gives no awaitable signal short of inotify on
        // cgroup.events; the processes go within milliseconds.
        let events = cgroup.join("cgroup.events");
        let deadline = tokio::time::Instant::now() + KILL_TIMEOUT;
        loop {
            let populated = tokio::fs::read_to_string(&events)
                .await
                .map(|text| text.lines().any(|line| line == "populated 1"))
                .unwrap_or(false);
            if !populated {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(JailError::Io {
                    action: "empty",
                    path: cgroup,
                    source: std::io::Error::other("processes survived cgroup.kill"),
                });
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    fn launch_plan<'a>(
        &self,
        record: &'a ComputerRecord,
        slot: Slot,
        disks: &ComputerDisks,
    ) -> LaunchPlan<'a> {
        LaunchPlan {
            jail: JailId::computer(record.computer_id),
            slot,
            vcpus: record.resources.vcpus,
            memory_mib: record.resources.memory_mib,
            rootfs: disks.rootfs.clone(),
            home: Some(disks.home.clone()),
            image: &record.image,
        }
    }

    async fn connect(&self, jail: &JailId) -> Result<UnixStream, GuestLinkError> {
        let socket = self.layout().in_chroot(jail, VSOCK);
        let mut stream = match UnixStream::connect(&socket).await {
            Ok(stream) => stream,
            Err(source) => return Err(GuestLinkError::Connect { socket, source }),
        };
        stream
            .write_all(format!("CONNECT {GUEST_AGENT_PORT}\n").as_bytes())
            .await
            .map_err(GuestLinkError::Handshake)?;
        // Read the `OK <port>\n` answer byte by byte, so nothing after it is
        // buffered away from the exec frames.
        let mut answer = Vec::new();
        let mut reader = BufReader::with_capacity(1, &mut stream);
        reader
            .read_until(b'\n', &mut answer)
            .await
            .map_err(GuestLinkError::Handshake)?;
        if !answer.starts_with(b"OK ") {
            return Err(GuestLinkError::Refused(
                String::from_utf8_lossy(&answer).into_owned(),
            ));
        }
        Ok(stream)
    }

    /// Run `argv` as root in the guest; its exit code and stdout. Waits for
    /// the guest agent to listen, and for the program, until `deadline`.
    async fn run_in_guest(
        &self,
        jail: &JailId,
        argv: &[&str],
        deadline: tokio::time::Instant,
    ) -> Result<(i32, Vec<u8>), JailError> {
        use firecracker_host_api::exec::{ExecRequest, Frame, read_frame, write_frame};

        let guest = |source: GuestLinkError| JailError::Guest {
            jail: jail.to_owned(),
            source,
        };
        let mut stream = self.connect_until(jail, deadline).await?;
        let request = ExecRequest {
            argv: argv.iter().map(|arg| (*arg).to_owned()).collect(),
            uid: 0,
            gid: 0,
            env: [("PATH".to_owned(), GUEST_ROOT_PATH.to_owned())].into(),
            cwd: "/".to_owned(),
            trace_id: macro_tower_layers::current_trace_id(),
        };
        write_frame(&mut stream, &Frame::Start(request))
            .await
            .map_err(|error| guest(error.into()))?;
        write_frame(&mut stream, &Frame::CloseStdin)
            .await
            .map_err(|error| guest(error.into()))?;
        let mut stdout = Vec::new();
        let outcome = tokio::time::timeout_at(deadline, async {
            loop {
                match read_frame(&mut stream).await {
                    Ok(Some(Frame::Stdout(bytes))) => stdout.extend(bytes),
                    Ok(Some(Frame::Exited(code))) => return Ok(code),
                    Ok(Some(Frame::Failed(message))) => {
                        return Err(GuestLinkError::Failed(message));
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => return Err(GuestLinkError::Closed),
                    Err(error) => return Err(error.into()),
                }
            }
        })
        .await
        .map_err(|_| {
            guest(GuestLinkError::TimedOut(
                argv.iter().map(|arg| (*arg).to_owned()).collect(),
            ))
        })?;
        let code = outcome.map_err(guest)?;
        Ok((code, stdout))
    }

    /// Connect to the guest agent, retrying until `deadline`: it starts
    /// listening some time into a boot, and the vsock gives no signal.
    async fn connect_until(
        &self,
        jail: &JailId,
        deadline: tokio::time::Instant,
    ) -> Result<UnixStream, JailError> {
        loop {
            match self.connect(jail).await {
                Ok(stream) => return Ok(stream),
                Err(source) if tokio::time::Instant::now() >= deadline => {
                    return Err(JailError::Guest {
                        jail: jail.to_owned(),
                        source,
                    });
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
            }
        }
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// A `key value` line of a cgroup stat file.
fn stat_field(stat: &str, key: &str) -> Option<u64> {
    stat.lines().find_map(|line| {
        let (name, value) = line.split_once(' ')?;
        (name == key).then(|| value.trim().parse().ok()).flatten()
    })
}

/// Whether `pid` is a live Firecracker process (not a reused pid).
fn is_firecracker(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .is_ok_and(|comm| comm.trim_end() == "firecracker")
}

/// Wait up to `timeout` for `pid` to end: a pidfd turns readable when the
/// process exits. True when it ended.
async fn wait_exit(pid: i32, timeout: Duration) -> bool {
    let Some(process) = rustix::process::Pid::from_raw(pid) else {
        return true;
    };
    let pidfd = match rustix::process::pidfd_open(process, rustix::process::PidfdFlags::empty()) {
        Ok(pidfd) => pidfd,
        // No such process: it ended.
        Err(_) => return true,
    };
    let waited = tokio::task::spawn_blocking(move || {
        let timeout = rustix::event::Timespec {
            tv_sec: i64::try_from(timeout.as_secs()).unwrap_or(i64::MAX),
            tv_nsec: i64::from(timeout.subsec_nanos()),
        };
        let mut descriptors = [rustix::event::PollFd::new(
            &pidfd,
            rustix::event::PollFlags::IN,
        )];
        rustix::event::poll(&mut descriptors, Some(&timeout))
    })
    .await;
    matches!(waited, Ok(Ok(ready)) if ready > 0)
}

/// Put a drive at its chroot path, owned by the VM's user: a file is
/// bind-mounted over an empty file; a block device gets its own device node
/// (the chroot's filesystem allows nodes; the jailer makes its own there).
fn place_drive(backing: &DriveBacking, target: &Path, uid: u32) -> Result<(), JailError> {
    match backing {
        DriveBacking::File(source) => {
            own(source, uid, 0o600)?;
            std::fs::File::create(target).map_err(io("create", target))?;
            rustix::mount::mount_bind(source, target).map_err(|error| JailError::Io {
                action: "bind-mount",
                path: source.clone(),
                source: error.into(),
            })
        }
        DriveBacking::BlockDevice(device) => {
            use std::os::unix::fs::MetadataExt;

            let device_id = std::fs::metadata(device)
                .map_err(io("stat", device))?
                .rdev();
            rustix::fs::mknodat(
                rustix::fs::CWD,
                target,
                rustix::fs::FileType::BlockDevice,
                rustix::fs::Mode::from_raw_mode(0o600),
                device_id,
            )
            .map_err(|error| JailError::Io {
                action: "mknod",
                path: target.to_owned(),
                source: error.into(),
            })?;
            own(target, uid, 0o600)
        }
    }
}

fn own(path: &Path, uid: u32, mode: u32) -> Result<(), JailError> {
    std::os::unix::fs::chown(path, Some(uid), Some(uid)).map_err(io("chown", path))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).map_err(io("chmod", path))
}

/// A copy-on-write clone of `source` at `target`.
async fn reflink(source: &Path, target: &Path) -> Result<(), JailError> {
    clone_file(source, target)
        .await
        .map_err(io("clone", source))
}

/// Where a hibernation is assembled before its one-rename publish.
fn partial_hibernation(target: &Path) -> PathBuf {
    target.with_extension("partial")
}

/// Remove a directory tree; absent is fine.
async fn remove_directory(directory: &Path) -> Result<(), JailError> {
    match tokio::fs::remove_dir_all(directory).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io("remove", directory)(error)),
    }
}

/// fsync a directory, so renames in it survive a host crash.
async fn sync_path(path: &Path) -> Result<(), JailError> {
    let owned = path.to_owned();
    tokio::task::spawn_blocking(move || std::fs::File::open(&owned)?.sync_all())
        .await
        .map_err(|error| io("sync", path)(std::io::Error::other(error)))?
        .map_err(io("sync", path))
}

async fn copy(source: &Path, target: &Path) -> Result<(), JailError> {
    tokio::fs::copy(source, target)
        .await
        .map(|_| ())
        .map_err(io("copy", source))
}
