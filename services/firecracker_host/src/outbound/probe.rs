//! [`HostProbe`] from `/proc` and the VMs' cgroup.

use crate::domain::service::{HostMeasurement, HostProbe, SwapPlacement};
use crate::outbound::cgroup::vms_memory_current;

#[cfg(test)]
mod test;

const PAGE_BYTES: u64 = 4096;

/// Reads the host.
#[derive(Debug, Clone)]
pub struct ProcProbe {
    /// The VMs' parent cgroup.
    pub cgroup_parent: String,
}

impl HostProbe for ProcProbe {
    fn measure(&self) -> HostMeasurement {
        let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let kib = |key: &str| {
            meminfo
                .lines()
                .find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))
                .and_then(|value| value.trim().trim_end_matches(" kB").parse::<u64>().ok())
                .unwrap_or(0)
                * 1024
        };
        let ksm_pages = std::fs::read_to_string("/sys/kernel/mm/ksm/pages_sharing")
            .ok()
            .and_then(|text| text.trim().parse::<u64>().ok())
            .unwrap_or(0);
        HostMeasurement {
            cpus: std::thread::available_parallelism()
                .map(|count| u32::try_from(count.get()).unwrap_or(u32::MAX))
                .unwrap_or(0),
            memory_total_bytes: kib("MemTotal"),
            memory_available_bytes: kib("MemAvailable"),
            guest_resident_memory_bytes: vms_memory_current(&self.cgroup_parent).unwrap_or(0),
            ksm_shared_bytes: ksm_pages * PAGE_BYTES,
            swap_total_bytes: kib("SwapTotal"),
            swap_used_bytes: kib("SwapTotal").saturating_sub(kib("SwapFree")),
            zram_used_bytes: zram_used_bytes(),
            swap_placement: match std::fs::read_to_string("/proc/swaps") {
                Err(_) => SwapPlacement::Unknown,
                Ok(swaps) => match disk_swap_devices(&swaps, zram_backing_device) {
                    0 => SwapPlacement::RamOnly,
                    devices => SwapPlacement::Disk { devices },
                },
            },
        }
    }
}

/// Swap devices in `/proc/swaps` (a header, then one line per device) that
/// put pages on a disk: every one but zram, and zram whose `backing_device`
/// (by device name, e.g. `zram0`) is a writeback device rather than `none`.
fn disk_swap_devices(swaps: &str, backing_device: impl Fn(&str) -> Option<String>) -> u32 {
    let devices = swaps
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().next())
        .filter(|device| match device.strip_prefix("/dev/") {
            Some(name) if name.starts_with("zram") => {
                backing_device(name).is_some_and(|backing| backing.trim() != "none")
            }
            _ => true,
        })
        .count();
    u32::try_from(devices).unwrap_or(u32::MAX)
}

/// A zram device's writeback device (`/sys/block/<name>/backing_dev`);
/// `None` without writeback support in the kernel (no such file).
fn zram_backing_device(name: &str) -> Option<String> {
    std::fs::read_to_string(format!("/sys/block/{name}/backing_dev")).ok()
}

/// `mem_used_total` (the third `mm_stat` field) of every zram device.
fn zram_used_bytes() -> u64 {
    let Ok(devices) = std::fs::read_dir("/sys/block") else {
        return 0;
    };
    devices
        .filter_map(Result::ok)
        .filter(|device| device.file_name().to_string_lossy().starts_with("zram"))
        .filter_map(|device| std::fs::read_to_string(device.path().join("mm_stat")).ok())
        .filter_map(|stat| stat.split_whitespace().nth(2)?.parse::<u64>().ok())
        .sum()
}
