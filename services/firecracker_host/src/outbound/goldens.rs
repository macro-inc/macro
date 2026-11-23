//! [`Goldens`]: which goldens exist on disk, and their builds, one at a
//! time in the background (they share the golden slot and jail).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use firecracker_host_api::{GoldenImage, GoldenKey, GoldenState, GuestImage};
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use crate::domain::ports::{Disks, GoldenAvailability, Goldens};
use crate::domain::service::image_name_is_safe;
use crate::outbound::jails::{JailError, Jails};
use crate::outbound::layout::Layout;

/// Why a golden build failed.
#[derive(Debug, thiserror::Error)]
enum GoldenBuildError<DiskErr: std::error::Error> {
    /// Its rootfs could not be made or sealed.
    #[error(transparent)]
    Disks(DiskErr),
    /// Its boot or snapshot failed.
    #[error(transparent)]
    Jails(#[from] JailError),
}

/// Goldens on this host.
#[derive(Debug, Clone)]
pub struct GoldenBuilds<D> {
    layout: Layout,
    jails: Jails,
    disks: D,
    /// Builds running or failed since the agent started; ready ones are
    /// read from disk.
    builds: Arc<Mutex<HashMap<GoldenKey, GoldenState>>>,
    one_at_a_time: Arc<tokio::sync::Mutex<()>>,
    tasks: TaskTracker,
}

#[derive(serde::Deserialize)]
struct Ready {
    created_at: DateTime<Utc>,
}

impl<D: Disks + Clone> GoldenBuilds<D> {
    /// Goldens in `layout`, booted by `jails` on `disks`; builds are tracked
    /// by `tasks`.
    pub fn new(layout: Layout, jails: Jails, disks: D, tasks: TaskTracker) -> Self {
        Self {
            layout,
            jails,
            disks,
            builds: Arc::new(Mutex::new(HashMap::new())),
            one_at_a_time: Arc::new(tokio::sync::Mutex::new(())),
            tasks,
        }
    }

    fn builds(&self) -> std::sync::MutexGuard<'_, HashMap<GoldenKey, GoldenState>> {
        self.builds
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn ready_at(&self, key: &GoldenKey) -> Option<DateTime<Utc>> {
        let directory = self.layout.golden(key);
        let complete = ["vmstate", "mem"]
            .iter()
            .all(|name| directory.join(name).is_file())
            && self.disks.golden_rootfs_present(key);
        if !complete {
            return None;
        }
        let text = std::fs::read(directory.join("ready.json")).ok()?;
        serde_json::from_slice::<Ready>(&text)
            .ok()
            .map(|ready| ready.created_at)
    }

    /// Boot on a fresh rootfs copy, snapshot, seal the rootfs, publish.
    async fn build_now(&self, key: &GoldenKey) -> Result<(), GoldenBuildError<D::Err>> {
        let rootfs = self
            .disks
            .create_golden_rootfs(key)
            .await
            .map_err(GoldenBuildError::Disks)?;
        self.jails.build_golden(key, &rootfs).await?;
        self.disks
            .seal_golden_rootfs(key)
            .instrument(tracing::info_span!("firecracker_host.golden_seal"))
            .await
            .map_err(GoldenBuildError::Disks)?;
        self.jails
            .mark_golden_ready(key)
            .instrument(tracing::info_span!("firecracker_host.golden_publish"))
            .await?;
        Ok(())
    }

    fn image_installed(&self, image: &GuestImage) -> bool {
        let directory = self.layout.image(image);
        image_name_is_safe(image.as_str())
            && ["vmlinux", "rootfs.ext4", "boot_args"]
                .iter()
                .all(|name| directory.join(name).is_file())
    }
}

impl<D: Disks + Clone> Goldens for GoldenBuilds<D> {
    fn availability(&self, key: &GoldenKey) -> GoldenAvailability {
        if !self.image_installed(&key.image) {
            return GoldenAvailability::ImageMissing;
        }
        match self.builds().get(key) {
            Some(GoldenState::Building) => return GoldenAvailability::Building,
            Some(GoldenState::Failed { .. }) => return GoldenAvailability::Absent,
            Some(GoldenState::Ready { .. }) | None => {}
        }
        if self.ready_at(key).is_some() {
            GoldenAvailability::Ready
        } else {
            GoldenAvailability::Absent
        }
    }

    fn build(&self, key: GoldenKey) {
        {
            let mut builds = self.builds();
            if matches!(builds.get(&key), Some(GoldenState::Building)) {
                return;
            }
            builds.insert(key.clone(), GoldenState::Building);
        }
        let this = self.clone();
        // The build outlives the request that asked for it; its span still
        // belongs to that request's trace.
        let span = tracing::info_span!(
            "firecracker_host.golden_build_task",
            image = %key.image,
            vcpus = i64::from(key.vcpus),
            memory_mib = i64::from(key.memory_mib),
        );
        self.tasks.spawn(
            async move {
                let _turn = this
                    .one_at_a_time
                    .lock()
                    .instrument(tracing::info_span!("firecracker_host.golden_build_queue"))
                    .await;
                let state = match this.build_now(&key).await {
                    Ok(()) => GoldenState::Ready {
                        created_at: this.ready_at(&key).unwrap_or_else(Utc::now),
                    },
                    Err(error) => {
                        tracing::error!(image = %key.image, error = ?error, "golden build failed");
                        GoldenState::Failed {
                            message: error.to_string(),
                        }
                    }
                };
                this.builds().insert(key, state);
            }
            .instrument(span),
        );
    }

    fn list(&self) -> Vec<GoldenImage> {
        let mut goldens: HashMap<GoldenKey, GoldenState> = HashMap::new();
        for key in ready_keys(&self.layout.goldens()) {
            if let Some(created_at) = self.ready_at(&key) {
                goldens.insert(key, GoldenState::Ready { created_at });
            }
        }
        for (key, state) in self.builds().iter() {
            if !matches!(state, GoldenState::Ready { .. }) {
                goldens.insert(key.clone(), state.clone());
            }
        }
        let mut goldens: Vec<GoldenImage> = goldens
            .into_iter()
            .map(|(key, state)| GoldenImage { key, state })
            .collect();
        goldens.sort_by(|left, right| {
            (&left.key.image, left.key.vcpus, left.key.memory_mib).cmp(&(
                &right.key.image,
                right.key.vcpus,
                right.key.memory_mib,
            ))
        });
        goldens
    }

    fn images(&self) -> Vec<GuestImage> {
        let mut names = Vec::new();
        collect_images(&self.layout.images(), "", &mut names);
        let mut images: Vec<GuestImage> = names
            .iter()
            .filter_map(|name| GuestImage::try_new(name).ok())
            .filter(|image| self.image_installed(image))
            .collect();
        images.sort();
        images
    }
}

/// Image names under `directory`: every directory holding a `rootfs.ext4`.
fn collect_images(directory: &Path, prefix: &str, images: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let image = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if path.join("rootfs.ext4").is_file() {
            images.push(image.clone());
        }
        collect_images(&path, &image, images);
    }
}

/// Golden keys under `goldens/`: `<image>/<vcpus>v-<memory>m`
/// directories with a `ready.json`.
fn ready_keys(goldens: &Path) -> Vec<GoldenKey> {
    let mut keys = Vec::new();
    let mut pending = vec![(goldens.to_owned(), String::new())];
    while let Some((directory, image)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.join("ready.json").is_file()
                && let Some(key) = parse_shape(&image, &name)
            {
                keys.push(key);
                continue;
            }
            let child = if image.is_empty() {
                name
            } else {
                format!("{image}/{name}")
            };
            pending.push((path, child));
        }
    }
    keys
}

fn parse_shape(image: &str, shape: &str) -> Option<GoldenKey> {
    let (vcpus, memory) = shape.split_once("v-")?;
    let memory_mib = memory.strip_suffix('m')?.parse().ok()?;
    Some(GoldenKey {
        image: GuestImage::try_new(image).ok()?,
        vcpus: vcpus.parse().ok()?,
        memory_mib,
    })
}
