//! [`Disks`] as sparse files, cloned copy-on-write: the rootfs from the
//! golden's, `/home` from an empty per-size template. On ZFS (the default)
//! each computer and golden is its own dataset and clones are block clones
//! across datasets (~45 ms); on XFS they are reflinks (~3 ms).

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use firecracker_host_api::{ComputerId, DiskBackend, GoldenKey};

use crate::domain::model::ComputerRecord;
use crate::domain::ports::{ComputerDisks, Disks, DriveBacking};
use crate::outbound::file_clone::clone_file;
use crate::outbound::layout::Layout;
use crate::outbound::zfs::{COMPUTER_RECORDSIZE, Datasets, GOLDEN_RECORDSIZE, ZfsError};

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
    spares: std::sync::Arc<tokio::sync::Mutex<()>>,
    /// Serializes making `/home` templates.
    templates: std::sync::Arc<tokio::sync::Mutex<()>>,
}

impl FileDisks {
    /// Disks in `layout`, held by `containers`; goldens' rootfs grown to
    /// `golden_root_disk_gib` before their boot.
    pub fn new(layout: Layout, containers: Containers, golden_root_disk_gib: u32) -> Self {
        Self {
            layout,
            containers,
            golden_root_disk_gib,
            spares: std::sync::Arc::new(tokio::sync::Mutex::new(())),
            templates: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// An empty ext4 (label `home`) of `gib`, made once per size: a new
    /// computer's `/home` is a reflink of it, so the guest mounts it as is
    /// (no mkfs or resize in the guest at restore).
    fn home_template_path(&self, gib: u32) -> PathBuf {
        self.layout.templates().join(format!("home-{gib}g.ext4"))
    }

    async fn home_template(&self, gib: u32) -> Result<PathBuf, DiskError> {
        let directory = self.layout.templates();
        let template = self.home_template_path(gib);
        let _turn = self.templates.lock().await;
        if template.is_file() {
            return Ok(template);
        }
        std::fs::create_dir_all(&directory).map_err(io("create", &directory))?;
        let staged = template.with_extension("ext4.new");
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
        std::fs::rename(&staged, &template).map_err(io("replace", &template))?;
        Ok(template)
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
        let template = self.home_template(gib).await?;
        let staged = directory.join("home.ext4.new");
        clone_file(&template, &staged).map_err(io("clone", &template))?;
        new_filesystem_uuid(&staged).await?;
        let home = directory.join("home.ext4");
        std::fs::rename(&staged, &home).map_err(io("replace", &home))?;
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
                // Every byte the guest can write must fit, or a full disk
                // reads to the guest as an I/O error instead of ENOSPC: the
                // rootfs is at least the golden's size, and a hibernation
                // holds up to all of memory.
                let root_gib = record
                    .resources
                    .root_disk_gib
                    .max(self.golden_root_disk_gib);
                let quota_gib = u64::from(root_gib)
                    + u64::from(record.resources.home_disk_gib)
                    + u64::from(record.resources.memory_mib).div_ceil(1024)
                    + QUOTA_HEADROOM_GIB;
                let relative = format!("computers/{}", record.computer_id);
                // A computer received from another host has its dataset (a
                // clone of a base from that host) and no golden here.
                if datasets.exists(&relative).await? {
                    return Ok(datasets
                        .set_refquota(&relative, quota_gib * BYTES_PER_GIB)
                        .await?);
                }
                // A clone of the golden's snapshot: the rootfs is the
                // golden's file in place, and a send from that snapshot
                // carries only the computer's own blocks.
                let golden =
                    Path::new("goldens").join(Layout::golden_relative(&record.golden_key()));
                let snapshot = datasets.latest_snapshot(&golden.to_string_lossy()).await?;
                match snapshot {
                    Some(snapshot) => {
                        let cloned = !self.layout.computer(record.computer_id).exists();
                        if cloned
                            && self
                                .take_spare(
                                    datasets,
                                    &spare_tag(&snapshot, record.resources.home_disk_gib),
                                    &relative,
                                    quota_gib * BYTES_PER_GIB,
                                )
                                .await
                        {
                            return Ok(());
                        }
                        datasets
                            .clone_from(
                                &snapshot,
                                &relative,
                                COMPUTER_RECORDSIZE,
                                quota_gib * BYTES_PER_GIB,
                            )
                            .await?;
                        if cloned {
                            self.remove_golden_files(&self.layout.computer(record.computer_id));
                        }
                        Ok(())
                    }
                    None => Ok(datasets
                        .ensure(
                            &relative,
                            Some(COMPUTER_RECORDSIZE),
                            Some(quota_gib * BYTES_PER_GIB),
                        )
                        .await?),
                }
            }
        }
    }

    fn clone_rootfs(&self, record: &ComputerRecord) -> Result<(), DiskError> {
        let source = self.layout.golden(&record.golden_key()).join("rootfs.ext4");
        reflink_file(&source, &self.rootfs(record.computer_id))
    }
}

/// Ready spares kept per golden and `/home` size.
const SPARES_PER_KIND: usize = 2;

/// The tag of a spare still being made.
const SPARE_BUILDING: &str = "building";

/// What a spare is made of: the golden's snapshot and the `/home` size.
fn spare_tag(snapshot: &str, gib: u32) -> String {
    format!("{snapshot}|home-{gib}g")
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
fn reflink_file(source: &Path, target: &Path) -> Result<(), DiskError> {
    let staged = target.with_extension("ext4.new");
    clone_file(source, &staged).map_err(io("clone", source))?;
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
            self.clone_rootfs(record)?;
        }
        grow(
            &self.rootfs(record.computer_id),
            record.resources.root_disk_gib,
        )?;
        let home = self.home(record.computer_id);
        if !home.exists() {
            let template = self.home_template(record.resources.home_disk_gib).await?;
            let staged = home.with_extension("ext4.new");
            clone_file(&template, &staged).map_err(io("clone", &template))?;
            // A clone carries the template's filesystem UUID; two homes with
            // one UUID collide wherever both meet a kernel or tool.
            new_filesystem_uuid(&staged).await?;
            std::fs::rename(&staged, &home).map_err(io("replace", &home))?;
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
                let relative = Path::new("goldens").join(Layout::golden_relative(key));
                datasets
                    .ensure(&relative.to_string_lossy(), Some(GOLDEN_RECORDSIZE), None)
                    .await?;
            }
        }
        let source = self.layout.image(&key.image).join("rootfs.ext4");
        let target = directory.join("rootfs.ext4");
        // Replaces a sealed (read-only) one from an earlier build.
        match std::fs::remove_file(&target) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io("remove", &target)(error)),
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
            // Named per build: a rebuild never touches the snapshot that
            // existing computers are clones of.
            let relative = Path::new("goldens").join(Layout::golden_relative(key));
            let name = format!("built-{}", chrono::Utc::now().format("%Y%m%dT%H%M%S"));
            datasets
                .snapshot(&relative.to_string_lossy(), &name)
                .await?;
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
    async fn prepare_home_templates(&self, sizes_gib: &[u32]) -> Result<(), DiskError> {
        for &gib in sizes_gib {
            self.home_template(gib).await?;
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
            let golden = Path::new("goldens").join(Layout::golden_relative(key));
            if let Some(snapshot) = datasets.latest_snapshot(&golden.to_string_lossy()).await? {
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

    fn home_templates_ready(&self, sizes_gib: &[u32]) -> bool {
        sizes_gib
            .iter()
            .all(|&gib| self.home_template_path(gib).is_file())
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
