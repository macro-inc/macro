//! Where everything lives on the durable storage (`storage.disks`; with ZFS
//! `computers/<id>` and `goldens/<image>/<shape>` are datasets mounted at
//! these paths):
//!
//! - `computers/<id>/{record.json,rootfs.ext4,home.ext4}`
//! - `goldens/<image>/<vcpus>v-<memory>m/{rootfs.ext4,vmstate,mem,ready.json}`:
//!   the golden boot's rootfs (the base every computer's rootfs is reflinked
//!   from) and its snapshot.
//! - `hibernation/<id>/{vmstate,mem}`
//! - `templates/home-<gib>g.ext4`: empty `/home` filesystems, reflinked per computer.
//! - `spares/<id>/{rootfs.ext4,home.ext4}` (ZFS): ready disk sets a create
//!   renames into `computers/<id>`.
//! - `jails/firecracker/<jail id>/root`: the jailer's chroots.
//!
//! Files move and clone between them with `outbound::file_clone`
//! (reflink on XFS, block clone across ZFS datasets); snapshot files are
//! bind-mounted into jails. A cold wake from a persistent disk measured as
//! fast as from local NVMe.
//!
//! Inside every chroot the same paths, which the golden's vmstate records:
//! [`ROOTFS`], [`HOME`], [`VSOCK`], [`API_SOCKET`], [`VMSTATE`], [`MEMORY`].

use std::path::PathBuf;

use firecracker_host_api::{ComputerId, GoldenKey, GuestImage};

use crate::domain::ports::Jail;

#[cfg(test)]
mod test;

/// Chroot path of the root drive.
pub const ROOTFS: &str = "/rootfs.ext4";
/// Chroot path of the `/home` drive.
pub const HOME: &str = "/home.ext4";
/// Chroot path of the hybrid vsock socket.
pub const VSOCK: &str = "/v.sock";
/// Chroot path of the Firecracker API socket.
pub const API_SOCKET: &str = "/api.sock";
/// Chroot path of a snapshot's device state.
pub const VMSTATE: &str = "/vmstate";
/// Chroot path of a snapshot's memory.
pub const MEMORY: &str = "/mem";
/// Chroot path of a cold boot's kernel.
pub const KERNEL: &str = "/vmlinux";
/// Chroot path of Firecracker's log.
pub const LOG: &str = "/firecracker.log";

/// Jail id of golden builds; builds run one at a time.
const GOLDEN_JAIL: &str = "golden";

/// A jail's id: the jailer's `--id`, its chroot's and cgroup's name.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JailId(String);

/// A name the jailer refuses as an id.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not a jail id (1..=64 letters, digits or '-')")]
pub struct InvalidJailId(String);

impl JailId {
    /// A computer's jail.
    pub fn computer(computer_id: ComputerId) -> Self {
        Self(format!("c-{}", computer_id.as_uuid().simple()))
    }

    /// The golden builds' jail.
    pub fn golden() -> Self {
        Self(GOLDEN_JAIL.to_owned())
    }

    /// A name found on the host, if the jailer could have made it.
    pub fn parse(name: &str) -> Result<Self, InvalidJailId> {
        if (1..=64).contains(&name.len())
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            Ok(Self(name.to_owned()))
        } else {
            Err(InvalidJailId(name.to_owned()))
        }
    }

    /// The id.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whose jail this is.
    pub fn owner(&self) -> Jail {
        if self.0 == GOLDEN_JAIL {
            return Jail::Golden;
        }
        self.0
            .strip_prefix("c-")
            .filter(|simple| simple.len() == 32)
            .and_then(|simple| uuid::Uuid::try_parse(simple).ok())
            .map_or_else(
                || Jail::Unrecognized(self.0.clone()),
                |uuid| Jail::Computer(ComputerId::new_from_uuid(uuid)),
            )
    }
}

impl std::fmt::Display for JailId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Resolved directories.
#[derive(Debug, Clone)]
pub struct Layout {
    durable: PathBuf,
    images: PathBuf,
}

impl Layout {
    /// Everything under `durable` (an XFS directory, or a ZFS parent
    /// dataset's mountpoint), images under `images`.
    pub fn new(durable: PathBuf, images: PathBuf) -> Self {
        Self { durable, images }
    }

    /// A golden's directory relative to `goldens/` (also its dataset name).
    pub fn golden_relative(key: &GoldenKey) -> PathBuf {
        golden_relative(key)
    }

    /// `computers/` on the durable disk.
    pub fn computers(&self) -> PathBuf {
        self.durable.join("computers")
    }

    /// A computer's directory on the durable disk.
    pub fn computer(&self, computer_id: ComputerId) -> PathBuf {
        self.computers().join(computer_id.to_string())
    }

    /// The images directory.
    pub fn images(&self) -> PathBuf {
        self.images.clone()
    }

    /// `staging/`: computers received from, or released to, another host.
    pub fn staging(&self) -> PathBuf {
        self.durable.join("staging")
    }

    /// A staged computer's directory (its dataset's mountpoint).
    pub fn staged(&self, computer_id: ComputerId) -> PathBuf {
        self.staging().join(computer_id.to_string())
    }

    /// `bases/`: golden snapshots received from other hosts, which staged
    /// computers are clones of.
    pub fn bases(&self) -> PathBuf {
        self.durable.join("bases")
    }

    /// An installed image's directory.
    pub fn image(&self, image: &GuestImage) -> PathBuf {
        self.images.join(image.as_str())
    }

    /// A golden's directory.
    pub fn golden(&self, key: &GoldenKey) -> PathBuf {
        self.goldens().join(golden_relative(key))
    }

    /// `spares/`: ready disk sets for creates (ZFS).
    pub fn spares(&self) -> PathBuf {
        self.durable.join("spares")
    }

    /// `templates/`: empty `/home` filesystems per size.
    pub fn templates(&self) -> PathBuf {
        self.durable.join("templates")
    }

    /// The durable directory itself.
    pub fn durable(&self) -> PathBuf {
        self.durable.clone()
    }

    /// The control plane's limits for this host.
    pub fn host_limits(&self) -> PathBuf {
        self.durable.join("host-limits.json")
    }

    /// `goldens/`.
    pub fn goldens(&self) -> PathBuf {
        self.durable.join("goldens")
    }

    /// A computer's hibernation snapshot.
    pub fn hibernation(&self, computer_id: ComputerId) -> PathBuf {
        self.durable
            .join("hibernation")
            .join(computer_id.to_string())
    }

    /// The jailer's `--chroot-base-dir`.
    pub fn jail_base(&self) -> PathBuf {
        self.durable.join("jails")
    }

    /// A jail's directory (the chroot's parent).
    pub fn jail(&self, jail_id: &JailId) -> PathBuf {
        self.jail_base().join("firecracker").join(jail_id.as_str())
    }

    /// A jail's chroot.
    pub fn chroot(&self, jail_id: &JailId) -> PathBuf {
        self.jail(jail_id).join("root")
    }

    /// `path` (one of the chroot constants) inside a jail's chroot.
    pub fn in_chroot(&self, jail_id: &JailId, path: &str) -> PathBuf {
        self.chroot(jail_id).join(path.trim_start_matches('/'))
    }
}

fn golden_relative(key: &GoldenKey) -> PathBuf {
    PathBuf::from(key.image.as_str()).join(format!("{}v-{}m", key.vcpus, key.memory_mib))
}
