//! Golden builds: boot an image once, let it settle, scan it for secrets,
//! and keep its paused snapshot beside the rootfs it ran on.

use std::io::ErrorKind;
use std::path::Path;

use firecracker_host_api::GoldenKey;
use tracing::Instrument;

use super::{GoldenRefusal, JailError, Jails, LaunchPlan, copy, io, own};
use crate::crash_point::{self, CrashPoint};
use crate::domain::ports::DriveBacking;
use crate::outbound::file_clone::move_file;
use crate::outbound::firecracker_api::{SnapshotCreate, VmState};
use crate::outbound::layout::{JailId, KERNEL, MEMORY, VMSTATE};
use crate::outbound::secret_scan;

/// The unit a self-warming image runs last; present only in such images.
const WARMUP_UNIT: &str = "macro-warmup-done.service";
/// The user whose processes must be gone before a warm golden is saved.
const WARMUP_USER: &str = "macro";

impl Jails {
    /// Boot `key`'s image once, wait until it settles, snapshot it paused,
    /// and keep the snapshot beside the rootfs it ran on.
    #[tracing::instrument(name = "firecracker_host.golden_build", skip(self), fields(image = %key.image, vcpus = i64::from(key.vcpus), memory_mib = i64::from(key.memory_mib)), err)]
    pub async fn build_golden(
        &self,
        key: &GoldenKey,
        rootfs: &DriveBacking,
    ) -> Result<(), JailError> {
        let image = self.layout().image(&key.image);
        let golden = self.layout().golden(key);
        tokio::fs::create_dir_all(&golden)
            .await
            .map_err(io("create", &golden))?;
        for name in ["ready.json", "vmstate", "mem", "mem.refused"] {
            let path = golden.join(name);
            match tokio::fs::remove_file(&path).await {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(io("remove", &path)(error)),
            }
        }

        let plan = LaunchPlan {
            jail: JailId::golden(),
            slot: self.settings.golden_slot,
            vcpus: key.vcpus,
            memory_mib: key.memory_mib,
            rootfs: rootfs.clone(),
            home: None,
            image: &key.image,
        };
        let result = async {
            self.prepare_chroot(&plan).await?;
            let kernel = self.layout().in_chroot(&JailId::golden(), KERNEL);
            copy(&image.join("vmlinux"), &kernel).await?;
            own(&kernel, self.uid(plan.slot), 0o400)?;
            let pid = self.spawn(&plan).await?;

            // MMDS answers, but without `macro.identity`: the guest's
            // macro-restore leaves the golden boot alone.
            let empty = serde_json::json!({});
            self.configure_and_boot(&plan, &empty).await?;
            self.wait_settled(&JailId::golden()).await?;
            crash_point::reach(CrashPoint::GoldenBooted);

            let api = self.api(&JailId::golden());
            api.patch("/vm", &VmState { state: "Paused" }).await?;
            api.put(
                "/snapshot/create",
                &SnapshotCreate {
                    snapshot_type: "Full",
                    snapshot_path: VMSTATE,
                    mem_file_path: MEMORY,
                },
            )
            .instrument(tracing::info_span!("firecracker_host.snapshot_create"))
            .await?;
            self.end(pid).await?;

            for (name, path) in [("vmstate", VMSTATE), ("mem", MEMORY)] {
                let source = self.layout().in_chroot(&JailId::golden(), path);
                let target = golden.join(name);
                move_file(&source, &target)
                    .await
                    .map_err(io("move", &source))?;
                own(&target, 0, 0o444)?;
            }
            Ok::<_, JailError>(())
        }
        .await;
        self.remove_jail(&JailId::golden()).await?;
        result?;

        if let Err(error) = self.refuse_secrets(key, &golden, rootfs).await {
            // Kept for inspection, root-only, under a name nothing restores.
            let refused = golden.join("mem.refused");
            let _ = tokio::fs::rename(golden.join("mem"), &refused).await;
            let _ = own(&refused, 0, 0o400);
            let _ = tokio::fs::remove_file(golden.join("vmstate")).await;
            return Err(error);
        }
        Ok(())
    }

    /// Mark `key`'s golden restorable, once its rootfs is sealed.
    pub async fn mark_golden_ready(&self, key: &GoldenKey) -> Result<(), JailError> {
        let ready = self.layout().golden(key).join("ready.json");
        let created_at = serde_json::json!({ "created_at": chrono::Utc::now() });
        tokio::fs::write(&ready, created_at.to_string())
            .await
            .map_err(io("write", &ready))
    }

    /// Scan the golden's memory and rootfs for secrets the golden boot made
    /// (S-9); key material the image itself ships is not one.
    #[tracing::instrument(name = "firecracker_host.golden_secret_scan", skip(self), err)]
    async fn refuse_secrets(
        &self,
        key: &GoldenKey,
        golden: &Path,
        rootfs: &DriveBacking,
    ) -> Result<(), JailError> {
        let image_rootfs = self.layout().image(&key.image).join("rootfs.ext4");
        let scanned_files = [golden.join("mem"), rootfs.path().to_owned()];
        let scanned = tokio::task::spawn_blocking(move || {
            let public = secret_scan::image_fragments(&image_rootfs)
                .map_err(|error| (image_rootfs.clone(), error))?;
            for path in scanned_files {
                match secret_scan::scan(&path, &public) {
                    Ok(Some(finding)) => return Ok(Some((path, finding))),
                    Ok(None) => {}
                    Err(error) => return Err((path, error)),
                }
            }
            Ok(None)
        })
        .await
        .map_err(|error| io("scan", golden)(std::io::Error::other(error)))?;
        match scanned {
            Ok(None) => Ok(()),
            Ok(Some((path, finding))) => Err(JailError::SecretInGolden {
                path,
                pattern: finding.pattern,
                offset: finding.offset,
            }),
            Err((path, error)) => Err(io("scan", &path)(error)),
        }
    }

    /// Wait until the golden guest finished booting (its page cache warmed
    /// by macro-prewarm, part of multi-user).
    #[tracing::instrument(name = "firecracker_host.golden_settle", skip(self), err)]
    async fn wait_settled(&self, jail: &JailId) -> Result<(), JailError> {
        let deadline = tokio::time::Instant::now() + self.settings.golden_boot_timeout;
        let (_, stdout) = self
            .run_in_guest(
                jail,
                &["systemctl", "is-system-running", "--wait"],
                deadline,
            )
            .await?;

        // `degraded` means a unit failed; the snapshot is still usable and
        // the failure is logged for the image's owner.
        let state = String::from_utf8_lossy(&stdout).trim().to_owned();
        if state != "running" {
            tracing::warn!(jail = %jail, state, "golden guest settled not fully running");
        }
        self.refuse_unfinished_warmup(jail, deadline).await
    }

    /// An image that warms itself up (`macro-warmup-done.service`) is only
    /// snapshotted after that unit succeeded and no process of the user
    /// `macro` is left: the warm-up's processes and their state must not
    /// reach every computer.
    async fn refuse_unfinished_warmup(
        &self,
        jail: &JailId,
        deadline: tokio::time::Instant,
    ) -> Result<(), JailError> {
        let (_, unit) = self
            .run_in_guest(
                jail,
                &[
                    "systemctl",
                    "show",
                    "--property=LoadState,ActiveState,Result",
                    WARMUP_UNIT,
                ],
                deadline,
            )
            .await?;
        let unit = String::from_utf8_lossy(&unit);
        if !unit.lines().any(|line| line == "LoadState=loaded") {
            return Ok(());
        }
        if !(unit.lines().any(|line| line == "ActiveState=active")
            && unit.lines().any(|line| line == "Result=success"))
        {
            return Err(JailError::GoldenRefused(GoldenRefusal::WarmupUnfinished(
                unit.lines().collect::<Vec<_>>().join(" "),
            )));
        }
        let (code, pids) = self
            .run_in_guest(jail, &["pgrep", "-u", WARMUP_USER], deadline)
            .await?;
        // pgrep exits 1 when nothing matches.
        if code != 1 {
            return Err(JailError::GoldenRefused(GoldenRefusal::UserProcesses(
                String::from_utf8_lossy(&pids)
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect(),
            )));
        }
        Ok(())
    }
}
