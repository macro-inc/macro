//! [`Disks`] as sparse files. On ZFS (the default) each computer and golden
//! is its own dataset: a computer is a `zfs clone` of its golden's snapshot,
//! which holds the rootfs and an empty `/home` of every sold size, so a
//! create copies no blocks (no block cloning). On XFS the rootfs is a
//! reflink of the golden's and `/home` a reflink of an empty per-size
//! template (~3 ms).

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, PoisonError};

use firecracker_host_api::{ComputerId, ComputerResources, DiskBackend, GoldenKey};

use crate::domain::model::ComputerRecord;
use crate::domain::ports::{ComputerDisks, Disks, DriveBacking};
use crate::outbound::file_clone::clone_file;
use crate::outbound::layout::Layout;
use crate::outbound::zfs::{COMPUTER_RECORDSIZE, Datasets, GOLDEN_RECORDSIZE, ZfsError};

#[cfg(test)]
mod test;

const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;

/// A disk file operation failed.
#[derive(Debug, thiserror::Error)]
pub enum DiskError {
    /// A file operation.
    #[error("{action} {path}: {source}")]
    Io {
        /// What.
        action: &'static str,
        /// Where.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// A dataset operation.
    #[error(transparent)]
    Zfs(#[from] ZfsError),
}

/// What holds each computer's and golden's files.
#[derive(Debug, Clone)]
pub enum Containers {
    /// Directories of one XFS filesystem.
    Xfs,
    /// One dataset each under a parent.
    Zfs(Datasets),
}

/// Headroom of a computer's dataset quota beyond its disks and memory
/// (record, snapshot device state).
const QUOTA_HEADROOM_GIB: u64 = 1;

fn io(action: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> DiskError {
    let path = path.to_owned();
    move |source| DiskError::Io {
        action,
        path,
        source,
    }
}

/// Computers' disk files.
#[derive(Debug, Clone)]
pub struct FileDisks {
    layout: Layout,
    containers: Containers,
    golden_root_disk_gib: u32,
    /// Serializes refilling the spares.
    spares: Arc<tokio::sync::Mutex<()>>,
    /// Serializes making the empty `/home`s (templates, goldens' files and
    /// their snapshots).
    templates: Arc<tokio::sync::Mutex<()>>,
    /// The sold `/home` sizes, from the last [`Disks::prepare_home_templates`]:
    /// a golden sealed later gets them too.
    home_sizes_gib: Arc<std::sync::Mutex<Vec<u32>>>,
    /// Goldens whose latest snapshot holds an empty `/home` of the size (ZFS).
    golden_homes: Arc<std::sync::Mutex<HashSet<(GoldenKey, u32)>>>,
}

impl FileDisks {
    /// Disks in `layout`, held by `containers`; goldens' rootfs grown to
    /// `golden_root_disk_gib` before their boot.
    pub fn new(layout: Layout, containers: Containers, golden_root_disk_gib: u32) -> Self {
        Self {
            layout,
            containers,
            golden_root_disk_gib,
            spares: Arc::default(),
            templates: Arc::default(),
            home_sizes_gib: Arc::default(),
            golden_homes: Arc::default(),
        }
    }

    /// An empty ext4 (label `home`) of `gib`, made once per size (XFS): a
    /// new computer's `/home` is a reflink of it, so the guest mounts it as
    /// is (no mkfs or resize in the guest at restore).
    fn home_template_path(&self, gib: u32) -> PathBuf {
        self.layout.templates().join(home_file_name(gib))
    }

    async fn home_template(&self, gib: u32) -> Result<PathBuf, DiskError> {
        let directory = self.layout.templates();
        let template = self.home_template_path(gib);
        let _turn = self.templates.lock().await;
        if template.is_file() {
            return Ok(template);
        }
        std::fs::create_dir_all(&directory).map_err(io("create", &directory))?;
        format_home(&template, gib).await?;
        Ok(template)
    }

    /// Give the golden's disk set an empty `/home` of each of `sizes_gib`
    /// it lacks; true when it got one. The caller holds `templates`.
    async fn add_golden_homes(
        &self,
        key: &GoldenKey,
        sizes_gib: &[u32],
    ) -> Result<bool, DiskError> {
        let directory = self.layout.golden(key);
        let mut added = false;
        for &gib in sizes_gib {
            let home = directory.join(home_file_name(gib));
            if !home.is_file() {
                format_home(&home, gib).await?;
                added = true;
            }
        }
        Ok(added)
    }

    /// Note that `snapshot` of `key` holds these sizes.
    fn record_golden_homes(&self, key: &GoldenKey, sizes_gib: &[u32]) {
        let mut homes = self
            .golden_homes
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        for &gib in sizes_gib {
            homes.insert((key.clone(), gib));
        }
    }

    /// Make the latest snapshot of `key`'s golden hold an empty `/home` of
    /// every size: add the missing files, then snapshot again. Computers
    /// cloned from an earlier snapshot keep it.
    async fn snapshot_golden_homes(
        &self,
        datasets: &Datasets,
        key: &GoldenKey,
        sizes_gib: &[u32],
    ) -> Result<(), DiskError> {
        // A rebuild drops the marker first (under `templates`, like this):
        // never snapshot a golden whose files are being replaced.
        if !self.layout.golden(key).join(GOLDEN_READY_MARKER).is_file() {
            return Ok(());
        }
        let relative = golden_relative(key);
        let Some(snapshot) = datasets.latest_snapshot(&relative).await? else {
            // Not sealed yet: its seal adds them.
            return Ok(());
        };
        let short = snapshot.rsplit('@').next().unwrap_or(&snapshot);
        let in_snapshot = self.layout.golden(key).join(".zfs/snapshot").join(short);
        let missing: Vec<u32> = sizes_gib
            .iter()
            .copied()
            .filter(|&gib| !in_snapshot.join(home_file_name(gib)).is_file())
            .collect();
        // Snapshotted even when the files were already there: a crash
        // between writing them and the snapshot.
        if !missing.is_empty() {
            self.add_golden_homes(key, &missing).await?;
            datasets
                .snapshot(&relative, &snapshot_name("homes"))
                .await?;
            tracing::info!(golden = %key.image, vcpus = key.vcpus, memory_mib = key.memory_mib, sizes_gib = ?missing, "golden snapshot now holds these /home sizes");
        }
        self.record_golden_homes(key, sizes_gib);
        Ok(())
    }

    /// The golden's snapshot files are not a computer's.
    fn remove_golden_files(&self, directory: &Path) {
        for name in ["vmstate", "mem", "mem.refused", "ready.json"] {
            let _ = std::fs::remove_file(directory.join(name));
        }
    }

    /// Rename a ready spare tagged `tag` into `relative`; false when none
    /// is left (or another create took it first), so the create clones.
    async fn take_spare(
        &self,
        datasets: &Datasets,
        tag: &str,
        relative: &str,
        refquota_bytes: u64,
    ) -> bool {
        let spares = match datasets.spares().await {
            Ok(spares) => spares,
            Err(error) => {
                tracing::warn!(error = ?error, "listing spares failed; cloning");
                return false;
            }
        };
        for (spare, _) in spares.iter().filter(|(_, each)| each == tag) {
            match datasets.adopt_spare(spare, relative, refquota_bytes).await {
                Ok(()) => return true,
                Err(error) => tracing::debug!(spare, error = ?error, "spare gone; trying the next"),
            }
        }
        false
    }

    /// Make one spare disk set of `snapshot` with a `/home` of `gib`: the
    /// golden's rootfs in place and an empty `/home` with its own UUID. It
    /// is tagged only when complete, so a create never takes a half-made
    /// one.
    async fn make_spare(
        &self,
        datasets: &Datasets,
        snapshot: &str,
        gib: u32,
    ) -> Result<(), DiskError> {
        let id = uuid::Uuid::now_v7().simple().to_string();
        let relative = format!("spares/{id}");
        datasets
            .clone_spare(snapshot, &relative, COMPUTER_RECORDSIZE, SPARE_BUILDING)
            .await?;
        let directory = self.layout.spares().join(&id);
        self.remove_golden_files(&directory);
        if !keep_golden_home(&directory, gib).await? {
            format_home(&directory.join("home.ext4"), gib).await?;
        }
        datasets
            .tag_spare(&relative, &spare_tag(snapshot, gib))
            .await?;
        Ok(())
    }

    fn rootfs(&self, computer_id: ComputerId) -> PathBuf {
        self.layout.computer(computer_id).join("rootfs.ext4")
    }

    fn home(&self, computer_id: ComputerId) -> PathBuf {
        self.layout.computer(computer_id).join("home.ext4")
    }

    /// Reflink the golden's rootfs to a staged file, then put it in place.
    /// The computer's directory, or dataset sized to its disks.
    async fn ensure_computer(&self, record: &ComputerRecord) -> Result<(), DiskError> {
        match &self.containers {
            Containers::Xfs => {
                let directory = self.layout.computer(record.computer_id);
                std::fs::create_dir_all(&directory).map_err(io("create", &directory))
            }
            Containers::Zfs(datasets) => {
                let quota_bytes =
                    computer_quota_bytes(&record.resources, self.golden_root_disk_gib);
                let relative = format!("computers/{}", record.computer_id);
                // A computer received from another host has its dataset (a
                // clone of a base from that host) and no golden here.
                if datasets.exists(&relative).await? {
                    return Ok(datasets.set_refquota(&relative, quota_bytes).await?);
                }
                // A clone of the golden's snapshot: the rootfs is the
                // golden's file in place, and a send from that snapshot
                // carries only the computer's own blocks.
                let snapshot = datasets
                    .latest_snapshot(&golden_relative(&record.golden_key()))
                    .await?;
                match snapshot {
                    Some(snapshot) => {
                        let cloned = !self.layout.computer(record.computer_id).exists();
                        if cloned
                            && self
                                .take_spare(
                                    datasets,
                                    &spare_tag(&snapshot, record.resources.home_disk_gib),
                                    &relative,
                                    quota_bytes,
                                )
                                .await
                        {
                            return Ok(());
                        }
                        datasets
                            .clone_from(&snapshot, &relative, COMPUTER_RECORDSIZE, quota_bytes)
                            .await?;
                        if cloned {
                            let directory = self.layout.computer(record.computer_id);
                            self.remove_golden_files(&directory);
                            // Without one of its size, `prepare` formats one.
                            keep_golden_home(&directory, record.resources.home_disk_gib).await?;
                        }
                        Ok(())
                    }
                    None => Ok(datasets
                        .ensure(&relative, Some(COMPUTER_RECORDSIZE), Some(quota_bytes))
                        .await?),
                }
            }
        }
    }

    async fn clone_rootfs(&self, record: &ComputerRecord) -> Result<(), DiskError> {
        let source = self.layout.golden(&record.golden_key()).join("rootfs.ext4");
        reflink_file(&source, &self.rootfs(record.computer_id)).await
    }
}

/// The quota of a computer's dataset. Every byte the guest can write must
/// fit, or a full disk reads to the guest as an I/O error instead of ENOSPC:
/// the rootfs is at least the golden's size, and a hibernation holds up to
/// all of memory.
fn computer_quota_bytes(resources: &ComputerResources, golden_root_disk_gib: u32) -> u64 {
    let root_gib = resources.root_disk_gib.max(golden_root_disk_gib);
    let quota_gib = u64::from(root_gib)
        + u64::from(resources.home_disk_gib)
        + u64::from(resources.memory_mib).div_ceil(1024)
        + QUOTA_HEADROOM_GIB;
    quota_gib * BYTES_PER_GIB
}

/// Ready spares kept per golden and `/home` size.
const SPARES_PER_KIND: usize = 2;

/// The tag of a spare still being made.
const SPARE_BUILDING: &str = "building";

/// What a spare is made of: the golden's snapshot and the `/home` size.
fn spare_tag(snapshot: &str, gib: u32) -> String {
    format!("{snapshot}|home-{gib}g")
}

/// Written into a golden's directory once it is published (`ready.json`).
const GOLDEN_READY_MARKER: &str = "ready.json";

/// The file of an empty `/home` of `gib`, in a template directory or a
/// golden's disk set.
fn home_file_name(gib: u32) -> String {
    format!("home-{gib}g.ext4")
}

/// The size of a [`home_file_name`].
fn home_file_size(name: &str) -> Option<u32> {
    name.strip_prefix("home-")?
        .strip_suffix("g.ext4")?
        .parse()
        .ok()
}

/// A golden's dataset, relative to the parent.
fn golden_relative(key: &GoldenKey) -> String {
    Path::new("goldens")
        .join(Layout::golden_relative(key))
        .to_string_lossy()
        .into_owned()
}

/// `<prefix>-<UTC time to the millisecond>`: a seal and a `/home` top-up in
/// one second still get two names.
fn snapshot_name(prefix: &str) -> String {
    format!("{prefix}-{}", chrono::Utc::now().format("%Y%m%dT%H%M%S%3f"))
}

/// Make an empty ext4 (label `home`) of `gib` at `target`, through a staged
/// file. Lazy init: it is sparse, a few MiB whatever its size.
async fn format_home(target: &Path, gib: u32) -> Result<(), DiskError> {
    let staged = target.with_extension("ext4.new");
    let _ = std::fs::remove_file(&staged);
    grow(&staged, gib)?;
    let output = tokio::process::Command::new("mkfs.ext4")
        .args([
            "-q",
            "-F",
            "-L",
            "home",
            "-E",
            "lazy_itable_init=1,lazy_journal_init=1",
        ])
        .arg(&staged)
        .output()
        .await
        .map_err(io("mkfs.ext4", &staged))?;
    if !output.status.success() {
        return Err(DiskError::Io {
            action: "mkfs.ext4",
            path: staged,
            source: std::io::Error::other(String::from_utf8_lossy(&output.stderr).into_owned()),
        });
    }
    std::fs::rename(&staged, target).map_err(io("replace", target))
}

/// In a fresh clone of a golden at `directory`, keep the empty `/home` of
/// `gib` as `home.ext4`, with a filesystem UUID of its own, and delete the
/// other sizes'; false when the golden has none of `gib`.
async fn keep_golden_home(directory: &Path, gib: u32) -> Result<bool, DiskError> {
    let mut names = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(io("list", directory))? {
        let entry = entry.map_err(io("list", directory))?;
        if let Ok(name) = entry.file_name().into_string() {
            names.push(name);
        }
    }
    let (kept, dropped) = split_golden_homes(&names, gib);
    for name in dropped {
        let path = directory.join(name);
        std::fs::remove_file(&path).map_err(io("remove", &path))?;
    }
    let kept = kept.map(|name| directory.join(name));
    let Some(source) = kept else {
        return Ok(false);
    };
    // Two homes with one UUID collide wherever both meet a kernel or tool;
    // published as `home.ext4` only once it has its own.
    let staged = directory.join("home.ext4.new");
    std::fs::rename(&source, &staged).map_err(io("rename", &source))?;
    new_filesystem_uuid(&staged).await?;
    let home = directory.join("home.ext4");
    std::fs::rename(&staged, &home).map_err(io("replace", &home))?;
    Ok(true)
}

/// Of the files in a golden's clone, the empty `/home` of `gib` to keep and
/// the other sizes' to delete; anything else is no `/home`.
fn split_golden_homes(names: &[String], gib: u32) -> (Option<&str>, Vec<&str>) {
    let mut kept = None;
    let mut dropped = Vec::new();
    for name in names {
        match home_file_size(name) {
            Some(size) if size == gib => kept = Some(name.as_str()),
            Some(_) => dropped.push(name.as_str()),
            None => {}
        }
    }
    (kept, dropped)
}

/// Give the ext4 in `path` a new random UUID.
async fn new_filesystem_uuid(path: &Path) -> Result<(), DiskError> {
    let output = tokio::process::Command::new("tune2fs")
        .args(["-U", "random"])
        .arg(path)
        .output()
        .await
        .map_err(io("tune2fs", path))?;
    if !output.status.success() {
        return Err(DiskError::Io {
            action: "tune2fs",
            path: path.to_owned(),
            source: std::io::Error::other(String::from_utf8_lossy(&output.stderr).into_owned()),
        });
    }
    Ok(())
}

/// Clone `source` to a staged file, then put it at `target`.
async fn reflink_file(source: &Path, target: &Path) -> Result<(), DiskError> {
    let staged = target.with_extension("ext4.new");
    clone_file(source, &staged)
        .await
        .map_err(io("clone", source))?;
    std::fs::rename(&staged, target).map_err(io("replace", target))
}

/// Grow `path` to `gib`, creating it empty; never shrink.
fn grow(path: &Path, gib: u32) -> Result<(), DiskError> {
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(io("open", path))?;
    let size = u64::from(gib) * BYTES_PER_GIB;
    let current = file.metadata().map_err(io("stat", path))?.len();
    if current < size {
        file.set_len(size).map_err(io("grow", path))?;
    }
    Ok(())
}

impl Disks for FileDisks {
    type Err = DiskError;

    #[tracing::instrument(name = "firecracker_host.disks_prepare", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn prepare(&self, record: &ComputerRecord) -> Result<ComputerDisks, DiskError> {
        self.ensure_computer(record).await?;
        if !self.rootfs(record.computer_id).exists() {
            self.clone_rootfs(record).await?;
        }
        grow(
            &self.rootfs(record.computer_id),
            record.resources.root_disk_gib,
        )?;
        let home = self.home(record.computer_id);
        if !home.exists() {
            match &self.containers {
                Containers::Xfs => {
                    let template = self.home_template(record.resources.home_disk_gib).await?;
                    let staged = home.with_extension("ext4.new");
                    clone_file(&template, &staged)
                        .await
                        .map_err(io("clone", &template))?;
                    // A clone carries the template's filesystem UUID; two
                    // homes with one UUID collide wherever both meet a
                    // kernel or tool.
                    new_filesystem_uuid(&staged).await?;
                    std::fs::rename(&staged, &home).map_err(io("replace", &home))?;
                }
                // The clone's own home files, if a crash cut its first
                // prepare short; else the golden had none of this size (not
                // sold when its snapshot was taken): a fresh one.
                Containers::Zfs(_) => {
                    let directory = self.layout.computer(record.computer_id);
                    if !keep_golden_home(&directory, record.resources.home_disk_gib).await? {
                        format_home(&home, record.resources.home_disk_gib).await?;
                    }
                }
            }
        }
        grow(&home, record.resources.home_disk_gib)?;
        Ok(ComputerDisks {
            rootfs: DriveBacking::File(self.rootfs(record.computer_id)),
            home: DriveBacking::File(self.home(record.computer_id)),
        })
    }

    #[tracing::instrument(name = "firecracker_host.golden_rootfs_create", skip(self), err)]
    async fn create_golden_rootfs(&self, key: &GoldenKey) -> Result<DriveBacking, DiskError> {
        let directory = self.layout.golden(key);
        match &self.containers {
            Containers::Xfs => {
                std::fs::create_dir_all(&directory).map_err(io("create", &directory))?;
            }
            Containers::Zfs(datasets) => {
                datasets
                    .ensure(&golden_relative(key), Some(GOLDEN_RECORDSIZE), None)
                    .await?;
            }
        }
        let source = self.layout.image(&key.image).join("rootfs.ext4");
        let target = directory.join("rootfs.ext4");
        {
            // Unmarked first, under `templates`: a `/home` top-up then
            // either finished its snapshot of the old build or skips this one.
            let _turn = self.templates.lock().await;
            for path in [directory.join(GOLDEN_READY_MARKER), target.clone()] {
                // The rootfs: replaces a sealed (read-only) one from an earlier build.
                match std::fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == ErrorKind::NotFound => {}
                    Err(error) => return Err(io("remove", &path)(error)),
                }
            }
        }
        tokio::fs::copy(&source, &target)
            .await
            .map_err(io("copy", &source))?;
        grow(&target, self.golden_root_disk_gib)?;
        Ok(DriveBacking::File(target))
    }

    async fn seal_golden_rootfs(&self, key: &GoldenKey) -> Result<(), DiskError> {
        use std::os::unix::fs::PermissionsExt;

        let rootfs = self.layout.golden(key).join("rootfs.ext4");
        std::os::unix::fs::chown(&rootfs, Some(0), Some(0)).map_err(io("chown", &rootfs))?;
        std::fs::set_permissions(&rootfs, std::fs::Permissions::from_mode(0o444))
            .map_err(io("chmod", &rootfs))?;
        if let Containers::Zfs(datasets) = &self.containers {
            // Sizes read under the lock: a top-up that changes them runs
            // wholly before or after.
            let _turn = self.templates.lock().await;
            let sizes_gib = self
                .home_sizes_gib
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            self.add_golden_homes(key, &sizes_gib).await?;
            // Named per build: a rebuild never touches the snapshot that
            // existing computers are clones of.
            datasets
                .snapshot(&golden_relative(key), &snapshot_name("built"))
                .await?;
            self.record_golden_homes(key, &sizes_gib);
        }
        Ok(())
    }

    fn backend(&self) -> DiskBackend {
        match &self.containers {
            Containers::Xfs => DiskBackend::XfsReflink,
            Containers::Zfs(_) => DiskBackend::ZfsDatasetClone,
        }
    }

    #[tracing::instrument(name = "firecracker_host.home_templates", skip(self), err)]
    async fn prepare_home_templates(
        &self,
        goldens: &[GoldenKey],
        sizes_gib: &[u32],
    ) -> Result<(), DiskError> {
        match &self.containers {
            Containers::Xfs => {
                for &gib in sizes_gib {
                    self.home_template(gib).await?;
                }
            }
            Containers::Zfs(datasets) => {
                // Stored under `templates`, like the seal's read: a seal
                // runs wholly before (and this pass then tops it up) or after.
                let _turn = self.templates.lock().await;
                sizes_gib.clone_into(
                    &mut self
                        .home_sizes_gib
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner),
                );
                for key in goldens {
                    self.snapshot_golden_homes(datasets, key, sizes_gib).await?;
                }
                // Templates of an earlier agent: creates no longer clone them.
                let templates = self.layout.templates();
                match tokio::fs::remove_dir_all(&templates).await {
                    Ok(()) => {}
                    Err(error) if error.kind() == ErrorKind::NotFound => {}
                    Err(error) => return Err(io("remove", &templates)(error)),
                }
            }
        }
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_host.spares_refill", skip_all, fields(made = tracing::field::Empty, dropped = tracing::field::Empty), err)]
    async fn refill_spares(
        &self,
        goldens: &[GoldenKey],
        home_sizes_gib: &[u32],
    ) -> Result<(), DiskError> {
        let Containers::Zfs(datasets) = &self.containers else {
            return Ok(());
        };
        let _turn = self.spares.lock().await;
        let mut wanted = Vec::new();
        for key in goldens {
            if let Some(snapshot) = datasets.latest_snapshot(&golden_relative(key)).await? {
                for &gib in home_sizes_gib {
                    wanted.push((snapshot.clone(), gib));
                }
            }
        }
        let existing = datasets.spares().await?;
        let mut dropped = 0;
        // Under the lock nothing else builds one: a spare still marked as
        // building is a crash's leftover; others are of an old golden or
        // an unsold size.
        for (spare, tag) in &existing {
            if !wanted
                .iter()
                .any(|(snapshot, gib)| *tag == spare_tag(snapshot, *gib))
            {
                datasets.destroy(spare).await?;
                dropped += 1;
            }
        }
        let mut made = 0;
        for (snapshot, gib) in &wanted {
            let tag = spare_tag(snapshot, *gib);
            let ready = existing.iter().filter(|(_, each)| *each == tag).count();
            for _ in ready..SPARES_PER_KIND {
                self.make_spare(datasets, snapshot, *gib).await?;
                made += 1;
            }
        }
        tracing::Span::current().record("made", made);
        tracing::Span::current().record("dropped", dropped);
        Ok(())
    }

    fn home_templates_ready(&self, goldens: &[GoldenKey], sizes_gib: &[u32]) -> bool {
        match &self.containers {
            Containers::Xfs => sizes_gib
                .iter()
                .all(|&gib| self.home_template_path(gib).is_file()),
            Containers::Zfs(_) => {
                let homes = self
                    .golden_homes
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                goldens.iter().all(|key| {
                    sizes_gib
                        .iter()
                        .all(|&gib| homes.contains(&(key.clone(), gib)))
                })
            }
        }
    }

    fn golden_rootfs_present(&self, key: &GoldenKey) -> bool {
        self.layout.golden(key).join("rootfs.ext4").is_file()
    }

    async fn collect_garbage(&self) -> Result<(), DiskError> {
        match &self.containers {
            Containers::Xfs => Ok(()),
            Containers::Zfs(datasets) => Ok(datasets.collect_garbage().await?),
        }
    }

    async fn delete(&self, computer_id: ComputerId) -> Result<(), DiskError> {
        if let Containers::Zfs(datasets) = &self.containers {
            // The record goes with the dataset: the service deletes it last
            // anyway, and a retry finds nothing left.
            return Ok(datasets
                .destroy(&format!("computers/{computer_id}"))
                .await?);
        }
        for path in [self.rootfs(computer_id), self.home(computer_id)] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(io("remove", &path)(error)),
            }
        }
        Ok(())
    }
}
