//! [`Machines`] over jailed Firecracker processes.

use std::io::ErrorKind;
use std::path::Path;
use std::time::Instant;

use firecracker_host_api::mmds::Document;
use firecracker_host_api::{ComputerId, Usage};
use tokio::net::UnixStream;
use tracing::Instrument;

use super::{
    JailError, Jails, copy, elapsed_ms, io, is_firecracker, own, partial_hibernation, reflink,
    remove_directory, stat_field, sync_path, wait_exit,
};
use crate::crash_point::{self, CrashPoint};
use crate::domain::model::{ComputerRecord, Process, Slot};
use crate::domain::ports::{
    BootSource, ComputerDisks, GuestSwap, Jail, LaunchPhases, Launched, Machines,
};
use crate::outbound::file_clone::move_file;
use crate::outbound::firecracker_api::{FirecrackerApiError, SnapshotCreate, VmState};
use crate::outbound::inventory;
use crate::outbound::layout::{JailId, KERNEL, MEMORY};

impl Machines for Jails {
    type Err = JailError;
    type GuestStream = UnixStream;

    #[tracing::instrument(name = "firecracker_host.launch", skip_all, fields(computer_id = %record.computer_id, slot = i64::from(slot.0), source = %source), err)]
    async fn launch(
        &self,
        record: &ComputerRecord,
        slot: Slot,
        source: BootSource,
        disks: &ComputerDisks,
        document: &Document,
    ) -> Result<Launched, JailError> {
        let plan = self.launch_plan(record, slot, disks);
        let mut phases = LaunchPhases::default();
        let result = async {
            let started = Instant::now();
            self.prepare_chroot(&plan).await?;
            match source {
                BootSource::Golden => {
                    self.link_snapshot(&plan.jail, &self.layout().golden(&record.golden_key()))?
                }
                BootSource::Hibernation => {
                    self.link_snapshot(&plan.jail, &self.layout().hibernation(record.computer_id))?
                }
                BootSource::ColdBoot => {
                    let kernel = self.layout().in_chroot(&plan.jail, KERNEL);
                    copy(&self.layout().image(&record.image).join("vmlinux"), &kernel).await?;
                    own(&kernel, self.uid(slot), 0o400)?;
                }
            }
            phases.jail_ms = elapsed_ms(started);
            let started = Instant::now();
            let pid = self.spawn(&plan).await?;
            crash_point::reach(CrashPoint::LaunchSpawned);
            phases.jailer_ms = elapsed_ms(started);
            let booted = match source {
                BootSource::Golden | BootSource::Hibernation => {
                    self.restore(&plan.jail, document, &mut phases).await
                }
                BootSource::ColdBoot => {
                    let document = serde_json::to_value(document)
                        .map_err(|error| JailError::Api(FirecrackerApiError::Encode(error)))?;
                    let started = Instant::now();
                    let booted = self.configure_and_boot(&plan, &document).await;
                    phases.resume_ms = elapsed_ms(started);
                    booted
                }
            };
            if let Err(error) = booted {
                self.end(pid).await?;
                return Err(error);
            }
            Ok(Launched {
                process: Process { slot, pid },
                phases,
            })
        }
        .await;
        if result.is_err() {
            self.remove_jail(&plan.jail).await?;
        }
        result
    }

    #[tracing::instrument(name = "firecracker_host.pause", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn pause(&self, record: &ComputerRecord, _process: Process) -> Result<(), JailError> {
        self.api(&JailId::computer(record.computer_id))
            .patch("/vm", &VmState { state: "Paused" })
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_host.resume", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn resume(
        &self,
        record: &ComputerRecord,
        _process: Process,
        document: &Document,
    ) -> Result<(), JailError> {
        let api = self.api(&JailId::computer(record.computer_id));
        api.put("/mmds", document).await?;
        api.patch("/vm", &VmState { state: "Resumed" }).await?;
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_host.mmds_put", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn put_mmds(
        &self,
        record: &ComputerRecord,
        _process: Process,
        document: &Document,
    ) -> Result<(), JailError> {
        self.api(&JailId::computer(record.computer_id))
            .put("/mmds", document)
            .await?;
        Ok(())
    }

    /// The guest reboots (`systemctl reboot` through the guest agent: the
    /// image has no keyboard controller for Ctrl-Alt-Del, and Firecracker
    /// has no power-off), and Firecracker ends when the guest resets
    /// (`reboot=k`). Killed after the grace period.
    #[tracing::instrument(name = "firecracker_host.shutdown", skip_all, fields(computer_id = %record.computer_id, forced = tracing::field::Empty), err)]
    async fn shutdown(&self, record: &ComputerRecord, process: Process) -> Result<(), JailError> {
        let jail = JailId::computer(record.computer_id);
        let deadline = tokio::time::Instant::now() + self.settings.shutdown_grace;
        let asked = self
            .run_in_guest(&jail, &["systemctl", "reboot", "--no-block"], deadline)
            .await
            .inspect_err(|error| {
                tracing::warn!(computer_id = %record.computer_id, error = %error, "could not ask the guest to shut down");
            });
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let clean = matches!(asked, Ok((0, _))) && wait_exit(process.pid, remaining).await;
        tracing::Span::current().record("forced", !clean);
        if !clean {
            tracing::warn!(computer_id = %record.computer_id, "clean shutdown failed or timed out, killing");
            self.end(process.pid).await?;
        }
        self.remove_jail(&jail).await
    }

    #[tracing::instrument(name = "firecracker_host.hibernate", skip_all, fields(computer_id = %record.computer_id, snapshot_type = tracing::field::Empty, earlier_attempt = tracing::field::Empty), err)]
    async fn hibernate(&self, record: &ComputerRecord, process: Process) -> Result<(), JailError> {
        let jail = JailId::computer(record.computer_id);
        let staged_state = "/hibernation.vmstate";
        let staged_memory = "/hibernation.mem";

        // A VM restored from a memory file (the golden's or its last
        // hibernation's) only needs the pages it wrote since: they are
        // merged into a reflink of that file, a few hundred MiB instead of
        // all of memory. A cold-booted VM has no such file: Full.
        //
        // Every snapshot resets Firecracker's dirty page tracking, so after
        // an earlier attempt in this process (failed, or its agent killed
        // before publishing), a Diff would lack the pages written before
        // that attempt: Full, over whatever the attempt left.
        // Its files may have moved on to the partial hibernation already.
        let mut earlier_attempt =
            partial_hibernation(&self.layout().hibernation(record.computer_id)).exists();
        for staged in [staged_state, staged_memory] {
            let path = self.layout().in_chroot(&jail, staged);
            match std::fs::remove_file(&path) {
                Ok(()) => earlier_attempt = true,
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(io("remove", &path)(error)),
            }
        }
        let loaded = self.layout().in_chroot(&jail, MEMORY);
        let snapshot_type = if loaded.is_file() && !earlier_attempt {
            let merged = self.layout().in_chroot(&jail, staged_memory);
            reflink(&loaded, &merged).await?;
            own(&merged, self.uid(process.slot), 0o600)?;
            "Diff"
        } else {
            "Full"
        };
        tracing::Span::current().record("snapshot_type", snapshot_type);
        tracing::Span::current().record("earlier_attempt", earlier_attempt);
        self.api(&jail)
            .put(
                "/snapshot/create",
                &SnapshotCreate {
                    snapshot_type,
                    snapshot_path: staged_state,
                    mem_file_path: staged_memory,
                },
            )
            .instrument(tracing::info_span!("firecracker_host.snapshot_create"))
            .await?;
        crash_point::reach(CrashPoint::HibernateSnapshotCreated);

        // Published before the process ends, in one rename: an agent killed
        // at any point leaves either no snapshot or a whole one, and the
        // record's `hibernating` tells startup which hibernation it was.
        let target = self.layout().hibernation(record.computer_id);
        let partial = partial_hibernation(&target);
        remove_directory(&partial).await?;
        tokio::fs::create_dir_all(&partial)
            .await
            .map_err(io("create", &partial))?;
        for (staged, name) in [(staged_state, "vmstate"), (staged_memory, "mem")] {
            let source = self.layout().in_chroot(&jail, staged);
            let destination = partial.join(name);
            // Synced by the clone: a host crash after the publish must not
            // leave a whole-looking, torn snapshot.
            move_file(&source, &destination)
                .await
                .map_err(io("move", &source))?;
            own(&destination, 0, 0o444)?;
        }
        sync_path(&partial).await?;
        remove_directory(&target).await?;
        tokio::fs::rename(&partial, &target)
            .await
            .map_err(io("publish", &target))?;
        if let Some(parent) = target.parent() {
            sync_path(parent).await?;
        }
        crash_point::reach(CrashPoint::HibernatePublished);
        self.end(process.pid).await?;
        self.remove_jail(&jail).await
    }

    #[tracing::instrument(name = "firecracker_host.kill", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn kill(&self, record: &ComputerRecord, process: Process) -> Result<(), JailError> {
        self.end(process.pid).await?;
        self.remove_jail(&JailId::computer(record.computer_id))
            .await
    }

    fn has_hibernation(&self, computer_id: ComputerId) -> bool {
        let directory = self.layout().hibernation(computer_id);
        directory.join("vmstate").is_file() && directory.join("mem").is_file()
    }

    async fn discard_hibernation(&self, computer_id: ComputerId) -> Result<(), JailError> {
        let directory = self.layout().hibernation(computer_id);
        remove_directory(&partial_hibernation(&directory)).await?;
        remove_directory(&directory).await
    }

    fn alive(&self, _record: &ComputerRecord, process: Process) -> bool {
        is_firecracker(process.pid)
    }

    #[tracing::instrument(name = "firecracker_host.guest_memory_max", skip(self), err)]
    async fn set_guest_memory_max(&self, bytes: u64) -> Result<(), JailError> {
        let path = Path::new("/sys/fs/cgroup")
            .join(&self.settings.cgroup_parent)
            .join("memory.max");
        tokio::fs::write(&path, bytes.to_string())
            .await
            .map_err(io("write", &path))
    }

    #[tracing::instrument(name = "firecracker_host.guest_swap", skip(self), err)]
    async fn set_guest_swap(&self, swap: GuestSwap) -> Result<(), JailError> {
        let path = Path::new("/sys/fs/cgroup")
            .join(&self.settings.cgroup_parent)
            .join("memory.swap.max");
        let limit = match swap {
            GuestSwap::Allowed => "max",
            GuestSwap::Off => "0",
        };
        tokio::fs::write(&path, limit)
            .await
            .map_err(io("write", &path))
    }

    fn usage(&self, record: &ComputerRecord, _process: Process) -> Option<Usage> {
        let cgroup = self.cgroup(&JailId::computer(record.computer_id));
        let resident_memory_bytes = std::fs::read_to_string(cgroup.join("memory.current"))
            .ok()?
            .trim()
            .parse()
            .ok()?;
        let private_memory_bytes = stat_field(
            &std::fs::read_to_string(cgroup.join("memory.stat")).ok()?,
            "anon",
        )?;
        // Absent on a host without swap: nothing is swapped. Unreadable, it
        // is unknown, which leaves the memory and CPU readings intact.
        let swap_bytes = match std::fs::read_to_string(cgroup.join("memory.swap.current")) {
            Ok(swap) => swap.trim().parse().ok(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(0),
            Err(_) => None,
        };
        let cpu_usage_microseconds = stat_field(
            &std::fs::read_to_string(cgroup.join("cpu.stat")).ok()?,
            "usage_usec",
        )?;
        Some(Usage {
            resident_memory_bytes,
            private_memory_bytes,
            swap_bytes,
            cpu_usage_microseconds,
        })
    }

    #[tracing::instrument(name = "firecracker_host.cpu_weight_set", skip_all, fields(computer_id = %record.computer_id, weight), err)]
    fn set_cpu_weight(
        &self,
        record: &ComputerRecord,
        _process: Process,
        weight: u16,
    ) -> Result<(), JailError> {
        let path = self
            .cgroup(&JailId::computer(record.computer_id))
            .join("cpu.weight");
        std::fs::write(&path, weight.to_string()).map_err(io("write", &path))
    }

    #[tracing::instrument(name = "firecracker_host.memory_reclaim", skip_all, fields(computer_id = %record.computer_id, bytes = i64::try_from(bytes).unwrap_or(i64::MAX), reclaimed = tracing::field::Empty), err)]
    async fn reclaim_memory(
        &self,
        record: &ComputerRecord,
        _process: Process,
        bytes: u64,
    ) -> Result<u64, JailError> {
        let cgroup = self.cgroup(&JailId::computer(record.computer_id));
        let reclaimed = tokio::task::spawn_blocking(move || {
            let current = |cgroup: &Path| -> std::io::Result<u64> {
                std::fs::read_to_string(cgroup.join("memory.current"))?
                    .trim()
                    .parse()
                    .map_err(std::io::Error::other)
            };
            let before = current(&cgroup)?;
            match std::fs::write(cgroup.join("memory.reclaim"), bytes.to_string()) {
                Ok(()) => {}
                // Reclaimed less than asked: what it got is still freed.
                Err(error)
                    if error.raw_os_error() == Some(rustix::io::Errno::AGAIN.raw_os_error()) => {}
                Err(error) => return Err(error),
            }
            Ok(before.saturating_sub(current(&cgroup)?))
        })
        .await
        .map_err(|error| io("reclaim", Path::new("memory.reclaim"))(std::io::Error::other(error)))?
        .map_err(io("reclaim", Path::new("memory.reclaim")))?;
        tracing::Span::current().record("reclaimed", i64::try_from(reclaimed).unwrap_or(i64::MAX));
        Ok(reclaimed)
    }

    fn jails(&self) -> Result<Vec<Jail>, JailError> {
        let chroots = self.layout().jail_base().join("firecracker");
        let cgroups = Path::new("/sys/fs/cgroup").join(&self.settings.cgroup_parent);
        inventory::jails(&chroots, &cgroups).map_err(io("list", &chroots))
    }

    async fn remove_jail(&self, jail: &Jail) -> Result<(), JailError> {
        let name = match jail {
            Jail::Computer(computer_id) => JailId::computer(*computer_id),
            Jail::Golden => JailId::golden(),
            Jail::Unrecognized(name) => JailId::parse(name).map_err(|error| JailError::Io {
                action: "remove",
                path: self.layout().jail_base().join("firecracker").join(name),
                source: std::io::Error::new(std::io::ErrorKind::InvalidInput, error),
            })?,
        };
        Jails::remove_jail(self, &name).await
    }

    #[tracing::instrument(name = "firecracker_host.guest_connect", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn connect_guest(
        &self,
        record: &ComputerRecord,
        _process: Process,
    ) -> Result<UnixStream, JailError> {
        let deadline = tokio::time::Instant::now() + self.settings.guest_agent_timeout;
        self.connect_until(&JailId::computer(record.computer_id), deadline)
            .await
    }

    async fn run_as_root(
        &self,
        record: &ComputerRecord,
        _process: Process,
        argv: &[&str],
    ) -> Result<i32, JailError> {
        let deadline = tokio::time::Instant::now() + self.settings.guest_agent_timeout;
        let (code, _) = self
            .run_in_guest(&JailId::computer(record.computer_id), argv, deadline)
            .await?;
        Ok(code)
    }
}
