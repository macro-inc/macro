//! The machine-wide registry of allocations and its lock. The registry only has
//! to cover what Docker can't show yet: a start that is still building.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::choose::{PortUse, WindowBlocker, choose_block, choose_window};
use crate::layout::{DEFAULT_INSTANCE, Port};
use crate::machine::Machine;

#[cfg(test)]
mod test;

const REGISTRY_FILE: &str = "instances.json";
const LOCK_FILE: &str = "instances.lock";

/// One instance's allocation, as recorded in the registry.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct Allocation {
    /// The window's first port.
    pub port_base: u16,
    /// The `10.254.<block>.0/24` its networks are carved from.
    pub subnet_block: u8,
    /// The process that allocated this. Keeps the allocation reserved during a
    /// build, before the instance has any Docker resources.
    owner_pid: u32,
}

type Entries = BTreeMap<String, Allocation>;

/// Failing to read or write the registry's directory.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    /// `HOME` isn't set, so there's no default registry location.
    #[error("HOME is not set")]
    NoHome,
    /// A file operation on the registry failed.
    #[error("{action} {}", path.display())]
    Io {
        /// What was being done, such as "locking".
        action: &'static str,
        /// The file or directory.
        path: PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },
    /// The registry couldn't be serialized.
    #[error("serializing the registry")]
    Serialize(#[from] serde_json::Error),
}

fn io(action: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> RegistryError {
    let path = path.to_path_buf();
    move |source| RegistryError::Io {
        action,
        path,
        source,
    }
}

/// Why no allocation could be made.
#[derive(Debug, thiserror::Error)]
pub enum AllocateError {
    /// The pinned window is taken.
    #[error(
        "port window {base} isn't free: {blocker}. Drop --port-base and one is allocated for you"
    )]
    PinnedWindowBusy {
        /// The pinned base.
        base: u16,
        /// What holds it.
        blocker: WindowBlocker,
    },
    /// The default instance's fixed ports are in use.
    #[error(
        "ports {} are in use, and the default instance's ports are fixed. Use a named \
         instance, which gets a free window: --instance <name>",
        join(ports)
    )]
    FixedPortsBusy {
        /// The busy ports.
        ports: Vec<u16>,
    },
    /// Every window or every subnet block is taken.
    #[error("no free {what} on this machine: {running} instances running; {leftovers}")]
    Exhausted {
        /// "port windows" or "Docker subnets".
        what: &'static str,
        /// How many instances are running.
        running: usize,
        /// What's left over that a person could free.
        leftovers: String,
    },
    /// The registry couldn't be written.
    #[error(transparent)]
    Registry(#[from] RegistryError),
}

fn join(ports: &[u16]) -> String {
    let ports: Vec<String> = ports.iter().map(u16::to_string).collect();
    ports.join(", ")
}

impl AllocateError {
    fn exhausted(what: &'static str, machine: &Machine) -> Self {
        let census = machine.census();
        AllocateError::Exhausted {
            what,
            running: census.running.len(),
            leftovers: census
                .leftovers_message()
                .unwrap_or_else(|| "nothing is left over to free".to_string()),
        }
    }
}

/// Which window a start wants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Window {
    /// The default instance's fixed ports. `check_free` says whether they must
    /// be free now; `base` is only recorded.
    Fixed {
        /// The base to record.
        base: u16,
        /// Fail if a fixed port is taken by something else.
        check_free: bool,
    },
    /// Exactly this window (`--port-base`); fails if it isn't free.
    Pinned(u16),
    /// Any free window: the one its containers hold, its last allocation, the
    /// hashed one, then the next free.
    Any,
}

/// One start's request.
#[derive(Clone, Debug)]
pub struct Request<'a> {
    /// The instance's name.
    pub name: &'a str,
    /// The networks the instance creates, so its own subnets don't count as taken.
    pub own_networks: BTreeSet<String>,
    /// The window it wants.
    pub window: Window,
}

/// Where the registry lives.
#[derive(Clone, Debug)]
pub struct Registry {
    dir: PathBuf,
}

impl Registry {
    /// The machine-wide registry, `~/.local/state/macro-local`.
    pub fn machine() -> Result<Self, RegistryError> {
        let home = macro_env_var::maybe_read_env("HOME").ok_or(RegistryError::NoHome)?;
        Ok(Self::at(Path::new(&home).join(".local/state/macro-local")))
    }

    /// A registry in `dir`.
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Registry { dir: dir.into() }
    }

    /// What `name` last allocated, read without the lock.
    pub fn recorded(&self, name: &str) -> Option<Allocation> {
        read_entries(&self.dir).get(name).copied()
    }

    /// Hold the machine-wide allocation lock until the returned guard drops.
    /// Read the [`Machine`] after this, so nothing changes between the read and
    /// the record.
    pub fn lock(&self) -> Result<Locked, RegistryError> {
        std::fs::create_dir_all(&self.dir).map_err(io("creating", &self.dir))?;
        let path = self.dir.join(LOCK_FILE);
        let file = File::create(&path).map_err(io("creating", &path))?;
        file.lock().map_err(io("locking", &path))?;
        Ok(Locked {
            dir: self.dir.clone(),
            _file: file,
        })
    }
}

/// The registry, locked.
#[derive(Debug)]
pub struct Locked {
    dir: PathBuf,
    _file: File,
}

impl Locked {
    /// Reserve a port window and subnet block for a stack about to start.
    /// Calling it again is safe and is how a start re-checks after its build:
    /// it returns the same allocation unless something has taken it since.
    /// Records whose owner died and that hold nothing in Docker are dropped.
    pub fn allocate(
        &mut self,
        request: &Request<'_>,
        machine: &Machine,
        bindable: &dyn Fn(u16) -> bool,
    ) -> Result<Allocation, AllocateError> {
        let name = request.name;
        let mut entries = read_entries(&self.dir);
        entries.retain(|other, allocation| {
            other == name || machine.has_instance(other) || process_alive(allocation.owner_pid)
        });

        let mut windows = machine.windows.clone();
        let own_window = windows.remove(name);
        let mut claimed: BTreeMap<String, u16> = entries
            .iter()
            .filter(|(other, _)| other.as_str() != name && other.as_str() != DEFAULT_INSTANCE)
            .map(|(other, allocation)| (other.clone(), allocation.port_base))
            .collect();
        claimed.extend(windows);

        let (published_by_self, published_by_others) = machine.published_split(name);
        let ports = PortUse {
            claimed: &claimed,
            published_by_others: &published_by_others,
            published_by_self: &published_by_self,
            bindable,
        };
        let recorded = entries.get(name).copied();
        let port_base = match request.window {
            Window::Fixed { base, check_free } => {
                if check_free {
                    ensure_fixed_ports_free(&ports)?;
                }
                base
            }
            Window::Pinned(base) => {
                if let Some(blocker) = ports.blocker(base) {
                    return Err(AllocateError::PinnedWindowBusy { base, blocker });
                }
                base
            }
            Window::Any => {
                let preferred = own_window.or(recorded.map(|allocation| allocation.port_base));
                choose_window(name, preferred, &ports)
                    .ok_or_else(|| AllocateError::exhausted("port windows", machine))?
            }
        };

        let used_subnets = machine.used_subnets(&request.own_networks);
        let claimed_blocks: BTreeSet<u8> = entries
            .iter()
            .filter(|(other, _)| other.as_str() != name)
            .map(|(_, allocation)| allocation.subnet_block)
            .collect();
        let subnet_block = choose_block(
            name,
            recorded.map(|allocation| allocation.subnet_block),
            &used_subnets,
            &claimed_blocks,
        )
        .ok_or_else(|| AllocateError::exhausted("Docker subnets", machine))?;

        let allocation = Allocation {
            port_base,
            subnet_block,
            owner_pid: std::process::id(),
        };
        entries.insert(name.to_string(), allocation);
        write_entries(&self.dir, &entries)?;
        Ok(allocation)
    }

    /// Forget an instance's allocation once its resources are gone.
    pub fn release(&mut self, name: &str) -> Result<(), RegistryError> {
        let mut entries = read_entries(&self.dir);
        if entries.remove(name).is_some() {
            write_entries(&self.dir, &entries)?;
        }
        Ok(())
    }
}

/// The default instance's ports are fixed, so there's no window to move to: say
/// so before the build rather than at `docker compose up` after it. Vite isn't
/// checked because headless stacks don't start it.
fn ensure_fixed_ports_free(ports: &PortUse<'_>) -> Result<(), AllocateError> {
    let busy: Vec<u16> = Port::all()
        .filter(|port| port.is_bound() && *port != Port::Frontend)
        .map(Port::fixed)
        .filter(|port| ports.port_busy(*port))
        .collect();
    if busy.is_empty() {
        Ok(())
    } else {
        Err(AllocateError::FixedPortsBusy { ports: busy })
    }
}

/// A missing file is an empty registry. A file we can't parse is too: it only
/// holds in-flight reservations, so failing would block every start for good.
fn read_entries(dir: &Path) -> Entries {
    std::fs::read_to_string(dir.join(REGISTRY_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_entries(dir: &Path, entries: &Entries) -> Result<(), RegistryError> {
    let path = dir.join(REGISTRY_FILE);
    let staged = dir.join(format!("{REGISTRY_FILE}.{}", std::process::id()));
    std::fs::write(&staged, serde_json::to_string_pretty(entries)?)
        .map_err(io("writing", &staged))?;
    std::fs::rename(&staged, &path).map_err(io("replacing", &path))
}

fn process_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists; nothing is sent.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}
