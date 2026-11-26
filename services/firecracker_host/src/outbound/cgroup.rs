//! The VMs' parent cgroup, under the agent's own systemd unit (which runs
//! with `Delegate=yes` and `KillMode=process`, so restarting the agent never
//! touches its VMs).
//!
//! cgroup v2 allows processes only in leaves of a tree with controllers on,
//! so the agent moves itself to `<unit>/agent` and VMs go under `<unit>/vms`.

use std::path::{Path, PathBuf};

const ROOT: &str = "/sys/fs/cgroup";
const CONTROLLERS: &str = "+cpu +memory +pids";

/// The cgroup tree could not be set up.
#[derive(Debug, thiserror::Error)]
#[error("cgroup {path}: {source}")]
pub struct CgroupError {
    path: PathBuf,
    source: std::io::Error,
}

fn error(path: &Path) -> impl FnOnce(std::io::Error) -> CgroupError {
    let path = path.to_owned();
    move |source| CgroupError { path, source }
}

/// Set up `<unit>/agent` and `<unit>/vms`; returns the VMs' parent relative
/// to `/sys/fs/cgroup`, for the jailer's `--parent-cgroup`.
#[tracing::instrument(name = "firecracker_host.cgroup_setup", err)]
pub fn set_up() -> Result<String, CgroupError> {
    let own_file = Path::new("/proc/self/cgroup");
    let own = std::fs::read_to_string(own_file).map_err(error(own_file))?;
    // cgroup v2 has the single line `0::/path`.
    let unit = own
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .unwrap_or("/")
        .trim();
    let unit = unit
        .strip_suffix("/agent")
        .unwrap_or(unit)
        .trim_start_matches('/');
    let unit_path = Path::new(ROOT).join(unit);

    let agent = unit_path.join("agent");
    std::fs::create_dir_all(&agent).map_err(error(&agent))?;
    let procs = agent.join("cgroup.procs");
    std::fs::write(&procs, std::process::id().to_string()).map_err(error(&procs))?;

    let control = unit_path.join("cgroup.subtree_control");
    std::fs::write(&control, CONTROLLERS).map_err(error(&control))?;
    let vms = unit_path.join("vms");
    std::fs::create_dir_all(&vms).map_err(error(&vms))?;
    let vms_control = vms.join("cgroup.subtree_control");
    std::fs::write(&vms_control, CONTROLLERS).map_err(error(&vms_control))?;

    Ok(Path::new(unit).join("vms").to_string_lossy().into_owned())
}

/// `memory.current` of the VMs' parent: every VM's charge together.
pub fn vms_memory_current(parent: &str) -> Option<u64> {
    std::fs::read_to_string(Path::new(ROOT).join(parent).join("memory.current"))
        .ok()?
        .trim()
        .parse()
        .ok()
}
