//! ZFS datasets for computers and goldens: one dataset per computer (so a
//! computer is one `zfs send`) and per golden, under a parent dataset from
//! the configuration, mounted at inherited mountpoints so paths match the
//! directory layout (`outbound::layout`).

use std::path::PathBuf;

#[cfg(test)]
mod test;

/// A `zfs`/`zpool` command failed, or the pool cannot clone blocks.
#[derive(Debug, thiserror::Error)]
pub enum ZfsError {
    /// The command failed.
    #[error("{command} failed: {message}")]
    Command {
        /// The command line.
        command: String,
        /// Its stderr, or why it did not run.
        message: String,
    },
    /// The parent dataset has no mountpoint or is not mounted.
    #[error("dataset {0} is not mounted; set its mountpoint")]
    NotMounted(String),
    /// A dataset with the computer's name is still waiting for its destroy.
    #[error("dataset {0} is still being destroyed; retry")]
    BeingDestroyed(String),
    /// Clones would silently be full copies.
    #[error("ZFS block cloning is off ({0}); every computer would copy its golden in full")]
    NoBlockCloning(BlockCloningOff),
    /// A ZFS module file the startup checks read is unreadable.
    #[error("read {path}: {source}")]
    ModuleState {
        /// The file under `/sys/module/zfs`.
        path: &'static str,
        /// Why.
        source: std::io::Error,
    },
    /// Block cloning runs where it can corrupt or race dirty data.
    #[error("ZFS block cloning is unsafe here ({0}); hibernations and golden builds clone blocks")]
    UnsafeBlockCloning(UnsafeBlockCloning),
}

/// Why block cloning is unsafe on this host.
#[derive(Debug, thiserror::Error)]
pub enum UnsafeBlockCloning {
    /// The module is older than the first release we trust to clone.
    #[error("OpenZFS module {version:?} is older than {MINIMUM_ZFS_VERSION}")]
    OldModule {
        /// `/sys/module/zfs/version`.
        version: String,
    },
    /// A clone of dirty data would not wait for it to be written.
    #[error("{BCLONE_WAIT_DIRTY_PARAMETER} is {value:?}")]
    NoDirtyWait {
        /// Its value.
        value: String,
    },
}

/// Where block cloning is off.
#[derive(Debug, thiserror::Error)]
pub enum BlockCloningOff {
    /// The pool's feature is not enabled.
    #[error("pool {pool} feature@block_cloning is {state}")]
    PoolFeature {
        /// The pool.
        pool: String,
        /// The feature's state.
        state: String,
    },
    /// The module parameter `zfs_bclone_enabled` is not 1.
    #[error("{BCLONE_PARAMETER} is {value:?}")]
    ModuleParameter {
        /// Its value.
        value: String,
    },
}

/// The ZFS module's switch for block cloning.
const BCLONE_PARAMETER: &str = "/sys/module/zfs/parameters/zfs_bclone_enabled";

/// Whether a block clone of dirty data waits for it to be written (1)
/// instead of failing or racing it.
const BCLONE_WAIT_DIRTY_PARAMETER: &str = "/sys/module/zfs/parameters/zfs_bclone_wait_dirty";

/// The loaded module's version, e.g. `2.4.1-1`.
const MODULE_VERSION: &str = "/sys/module/zfs/version";

/// The oldest OpenZFS trusted to clone blocks: 2.2.x shipped cloning with
/// data-corruption bugs; the NixOS module pins the same floor.
const MINIMUM_ZFS_VERSION: &str = "2.4.1";

/// How long a destroy waits for a busy dataset before deferring it.
const DESTROY_BUSY_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

/// Pause between destroys of a busy dataset: the kernel signals nothing
/// when the last lazily detached mount goes, so the destroy is retried.
const DESTROY_BUSY_RETRY: std::time::Duration = std::time::Duration::from_secs(1);

/// User property tagging a spare disk set with what it was made from.
pub const SPARE_PROPERTY: &str = "macro:spare";

/// The spare tag of a disk set a computer took.
const SPARE_TAKEN: &str = "taken";

/// User property marking a dataset whose destroy was deferred.
const DESTROY_PROPERTY: &str = "macro:destroy";

/// Recordsize of computers' datasets (their disks' guest I/O).
pub const COMPUTER_RECORDSIZE: &str = "16k";
/// Recordsize of goldens' datasets: 128k makes cloning a rootfs ~45 ms
/// (16k: ~335 ms).
pub const GOLDEN_RECORDSIZE: &str = "128k";

/// The parent dataset.
#[derive(Debug, Clone)]
pub struct Datasets {
    parent: String,
}

impl Datasets {
    /// Check that the pool clones blocks, make the `computers` and
    /// `goldens` children, and return the parent's mountpoint.
    #[tracing::instrument(name = "firecracker_host.zfs_open", err)]
    pub async fn open(parent: &str) -> Result<(Self, PathBuf), ZfsError> {
        let pool = parent.split('/').next().unwrap_or(parent);
        let feature = zfs_output(
            "zpool",
            &["get", "-H", "-o", "value", "feature@block_cloning", pool],
        )
        .await?;
        if !matches!(feature.trim(), "enabled" | "active") {
            return Err(ZfsError::NoBlockCloning(BlockCloningOff::PoolFeature {
                pool: pool.to_owned(),
                state: feature.trim().to_owned(),
            }));
        }
        let enabled = module_state(BCLONE_PARAMETER)?;
        if enabled.trim() != "1" {
            return Err(ZfsError::NoBlockCloning(BlockCloningOff::ModuleParameter {
                value: enabled.trim().to_owned(),
            }));
        }
        let version = module_state(MODULE_VERSION)?;
        if !version_at_least(&version, MINIMUM_ZFS_VERSION) {
            return Err(ZfsError::UnsafeBlockCloning(
                UnsafeBlockCloning::OldModule {
                    version: version.trim().to_owned(),
                },
            ));
        }
        let wait_dirty = module_state(BCLONE_WAIT_DIRTY_PARAMETER)?;
        if wait_dirty.trim() != "1" {
            return Err(ZfsError::UnsafeBlockCloning(
                UnsafeBlockCloning::NoDirtyWait {
                    value: wait_dirty.trim().to_owned(),
                },
            ));
        }
        let datasets = Self {
            parent: parent.to_owned(),
        };
        for child in ["computers", "goldens", "spares"] {
            datasets.ensure(child, None, None).await?;
        }
        let mountpoint =
            zfs_output("zfs", &["get", "-H", "-o", "value", "mountpoint", parent]).await?;
        let mounted = zfs_output("zfs", &["get", "-H", "-o", "value", "mounted", parent]).await?;
        let mountpoint = PathBuf::from(mountpoint.trim());
        if !mountpoint.is_absolute() || mounted.trim() != "yes" {
            return Err(ZfsError::NotMounted(parent.to_owned()));
        }
        Ok((datasets, mountpoint))
    }

    fn name(&self, relative: &str) -> String {
        format!("{}/{relative}", self.parent)
    }

    /// The parent dataset's name.
    pub fn parent(&self) -> &str {
        &self.parent
    }

    /// Create `relative` (and its parents) unless it exists.
    #[tracing::instrument(name = "firecracker_host.zfs_ensure", skip(self), err)]
    pub async fn ensure(
        &self,
        relative: &str,
        recordsize: Option<&str>,
        refquota_bytes: Option<u64>,
    ) -> Result<(), ZfsError> {
        let name = self.name(relative);
        if zfs_output("zfs", &["list", "-H", "-o", "name", &name])
            .await
            .is_ok()
        {
            return self.refuse_pending(&name).await;
        }
        let arguments = create_arguments(&name, recordsize, refquota_bytes);
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
        zfs_output("zfs", &arguments).await.map(drop)
    }

    /// Whether `relative` exists.
    #[tracing::instrument(name = "firecracker_host.zfs_exists", skip(self), err)]
    pub async fn exists(&self, relative: &str) -> Result<bool, ZfsError> {
        let name = self.name(relative);
        match zfs_output("zfs", &["list", "-H", "-o", "name", &name]).await {
            Ok(_) => Ok(true),
            Err(ZfsError::Command { message, .. }) if message.contains("does not exist") => {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    /// Set `relative`'s `refquota`.
    #[tracing::instrument(name = "firecracker_host.zfs_set_refquota", skip(self), err)]
    pub async fn set_refquota(&self, relative: &str, bytes: u64) -> Result<(), ZfsError> {
        let name = self.name(relative);
        let refquota = format!("refquota={bytes}");
        zfs_output("zfs", &["set", &refquota, &name])
            .await
            .map(drop)
    }

    /// Snapshot `relative` as `@<name>`.
    #[tracing::instrument(name = "firecracker_host.zfs_snapshot", skip(self), err)]
    pub async fn snapshot(&self, relative: &str, name: &str) -> Result<(), ZfsError> {
        let snapshot = format!("{}@{name}", self.name(relative));
        zfs_output("zfs", &["snapshot", &snapshot]).await.map(drop)
    }

    /// The newest snapshot of `relative`, as a full `dataset@name`.
    #[tracing::instrument(name = "firecracker_host.zfs_latest_snapshot", skip(self), err)]
    pub async fn latest_snapshot(&self, relative: &str) -> Result<Option<String>, ZfsError> {
        let name = self.name(relative);
        let listing = zfs_output(
            "zfs",
            &[
                // createtxg, not creation (whole seconds): two snapshots in
                // one second still sort in the order they were taken.
                "list",
                "-H",
                "-t",
                "snapshot",
                "-o",
                "name",
                "-s",
                "createtxg",
                &name,
            ],
        )
        .await?;
        Ok(listing.lines().last().map(str::to_owned))
    }

    /// Create `relative` as a clone of `snapshot` unless it exists.
    #[tracing::instrument(name = "firecracker_host.zfs_clone", skip(self), err)]
    pub async fn clone_from(
        &self,
        snapshot: &str,
        relative: &str,
        recordsize: &str,
        refquota_bytes: u64,
    ) -> Result<(), ZfsError> {
        let name = self.name(relative);
        if zfs_output("zfs", &["list", "-H", "-o", "name", &name])
            .await
            .is_ok()
        {
            return self.refuse_pending(&name).await;
        }
        let arguments = clone_arguments(snapshot, &name, recordsize, refquota_bytes);
        let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
        zfs_output("zfs", &arguments).await.map(drop)
    }

    /// Clone `snapshot` as `relative`, tagged `tag` in [`SPARE_PROPERTY`]
    /// and without a quota: a spare disk set.
    #[tracing::instrument(name = "firecracker_host.zfs_clone_spare", skip(self), err)]
    pub async fn clone_spare(
        &self,
        snapshot: &str,
        relative: &str,
        recordsize: &str,
        tag: &str,
    ) -> Result<(), ZfsError> {
        let recordsize = format!("recordsize={recordsize}");
        let tag = format!("{SPARE_PROPERTY}={tag}");
        zfs_output(
            "zfs",
            &[
                "clone",
                "-o",
                &recordsize,
                "-o",
                &tag,
                snapshot,
                &self.name(relative),
            ],
        )
        .await
        .map(drop)
    }

    /// Tag spare `relative` as `tag`.
    #[tracing::instrument(name = "firecracker_host.zfs_tag_spare", skip(self), err)]
    pub async fn tag_spare(&self, relative: &str, tag: &str) -> Result<(), ZfsError> {
        let tag = format!("{SPARE_PROPERTY}={tag}");
        zfs_output("zfs", &["set", &tag, &self.name(relative)])
            .await
            .map(drop)
    }

    /// Every spare under `spares/`: its name relative to the parent and its
    /// tag.
    #[tracing::instrument(name = "firecracker_host.zfs_spares", skip(self), fields(count = tracing::field::Empty), err)]
    pub async fn spares(&self) -> Result<Vec<(String, String)>, ZfsError> {
        let root = self.name("spares");
        let property = format!("name,{SPARE_PROPERTY}");
        let listing = zfs_output(
            "zfs",
            &[
                "list",
                "-H",
                "-r",
                "-d",
                "1",
                "-t",
                "filesystem",
                "-o",
                &property,
                &root,
            ],
        )
        .await?;
        let prefix = format!("{}/", self.parent);
        let spares: Vec<(String, String)> = listing
            .lines()
            .filter_map(|line| line.split_once('\t'))
            .filter(|(name, _)| *name != root)
            .filter_map(|(name, tag)| {
                name.strip_prefix(&prefix)
                    .map(|relative| (relative.to_owned(), tag.to_owned()))
            })
            .collect();
        tracing::Span::current().record("count", spares.len());
        Ok(spares)
    }

    /// Make spare `spare` the dataset `relative`, with its quota and
    /// without its tag.
    #[tracing::instrument(name = "firecracker_host.zfs_adopt_spare", skip(self), err)]
    pub async fn adopt_spare(
        &self,
        spare: &str,
        relative: &str,
        refquota_bytes: u64,
    ) -> Result<(), ZfsError> {
        let name = self.name(relative);
        zfs_output("zfs", &["rename", &self.name(spare), &name]).await?;
        // One command: the quota, and a tag no spare listing matches.
        let refquota = format!("refquota={refquota_bytes}");
        let taken = format!("{SPARE_PROPERTY}={SPARE_TAKEN}");
        zfs_output("zfs", &["set", &refquota, &taken, &name])
            .await
            .map(drop)
    }

    /// Destroy `relative` and everything under it; absent is fine. A
    /// dataset that stays busy (other jails' mount namespaces can hold it
    /// until those VMs end) is unmounted from use and marked for the
    /// upkeep's [`Datasets::collect_garbage`], which destroys it later.
    #[tracing::instrument(name = "firecracker_host.zfs_destroy", skip(self), fields(deferred = tracing::field::Empty), err)]
    pub async fn destroy(&self, relative: &str) -> Result<(), ZfsError> {
        let name = self.name(relative);
        if zfs_output("zfs", &["list", "-H", "-o", "name", &name])
            .await
            .is_err()
        {
            return Ok(());
        }
        let deadline = tokio::time::Instant::now() + DESTROY_BUSY_WAIT;
        loop {
            match zfs_output("zfs", &["destroy", "-r", &name]).await {
                Ok(_) => return Ok(()),
                Err(ZfsError::Command { message, .. }) if message.contains("dataset is busy") => {
                    if tokio::time::Instant::now() >= deadline {
                        break;
                    }
                    tokio::time::sleep(DESTROY_BUSY_RETRY).await;
                }
                Err(error) => return Err(error),
            }
        }
        tracing::Span::current().record("deferred", true);
        tracing::warn!(dataset = %name, "dataset busy; destroy deferred to the upkeep");
        let pending = format!("{DESTROY_PROPERTY}=pending");
        zfs_output("zfs", &["set", "canmount=off", &pending, &name])
            .await
            .map(drop)
    }

    /// Destroy every dataset whose destroy was deferred, if no longer busy.
    #[tracing::instrument(name = "firecracker_host.zfs_collect_garbage", skip(self), err)]
    pub async fn collect_garbage(&self) -> Result<(), ZfsError> {
        let root = self.name("computers");
        let property = format!("name,{DESTROY_PROPERTY}");
        let listing = zfs_output(
            "zfs",
            &[
                "list",
                "-H",
                "-r",
                "-t",
                "filesystem",
                "-o",
                &property,
                &root,
            ],
        )
        .await?;
        for line in listing.lines() {
            let Some((name, "pending")) = line.split_once('\t') else {
                continue;
            };
            match zfs_output("zfs", &["destroy", "-r", name]).await {
                Ok(_) => tracing::info!(dataset = %name, "deferred destroy done"),
                Err(ZfsError::Command { message, .. }) if message.contains("dataset is busy") => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    /// Refuse to reuse a dataset still waiting for its destroy.
    async fn refuse_pending(&self, name: &str) -> Result<(), ZfsError> {
        let value =
            zfs_output("zfs", &["get", "-H", "-o", "value", DESTROY_PROPERTY, name]).await?;
        if value.trim() == "pending" {
            return Err(ZfsError::BeingDestroyed(name.to_owned()));
        }
        Ok(())
    }
}

/// `zfs create` of `name` with its parents and the given properties.
fn create_arguments(
    name: &str,
    recordsize: Option<&str>,
    refquota_bytes: Option<u64>,
) -> Vec<String> {
    let mut arguments = vec!["create".to_owned(), "-p".to_owned()];
    if let Some(recordsize) = recordsize {
        arguments.extend(["-o".to_owned(), format!("recordsize={recordsize}")]);
    }
    if let Some(bytes) = refquota_bytes {
        arguments.extend(["-o".to_owned(), format!("refquota={bytes}")]);
    }
    arguments.push(name.to_owned());
    arguments
}

/// `zfs clone` of `snapshot` as `name` with a recordsize and a quota.
fn clone_arguments(
    snapshot: &str,
    name: &str,
    recordsize: &str,
    refquota_bytes: u64,
) -> Vec<String> {
    vec![
        "clone".to_owned(),
        "-o".to_owned(),
        format!("recordsize={recordsize}"),
        "-o".to_owned(),
        format!("refquota={refquota_bytes}"),
        snapshot.to_owned(),
        name.to_owned(),
    ]
}

/// A file of the loaded ZFS module.
fn module_state(path: &'static str) -> Result<String, ZfsError> {
    std::fs::read_to_string(path).map_err(|source| ZfsError::ModuleState { path, source })
}

/// Whether `version` (`2.4.1-1`, `2.4.1-1ubuntu1`, `2.5.0`) is at least
/// `minimum` (`2.4.1`); anything unparsable is not. Not `semver`: it reads
/// the packaging suffix of `2.4.1-1ubuntu1` as a pre-release, which sorts
/// below `2.4.1`.
fn version_at_least(version: &str, minimum: &str) -> bool {
    let release = |text: &str| -> Option<Vec<u32>> {
        let release = text.trim().split(['-', '_', '+']).next()?;
        release.split('.').map(|part| part.parse().ok()).collect()
    };
    match (release(version), release(minimum)) {
        (Some(version), Some(minimum)) => version >= minimum,
        _ => false,
    }
}

async fn zfs_output(program: &str, arguments: &[&str]) -> Result<String, ZfsError> {
    let command = format!("{program} {}", arguments.join(" "));
    let output = tokio::process::Command::new(program)
        .args(arguments)
        .output()
        .await
        .map_err(|error| ZfsError::Command {
            command: command.clone(),
            message: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(ZfsError::Command {
            command,
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
