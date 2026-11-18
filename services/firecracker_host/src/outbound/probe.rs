//! [`HostProbe`] from `/proc` and the VMs' cgroup.

use crate::domain::service::{HostMeasurement, HostProbe};
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
            // Unreadable reads as none: `SwapTotal` still shows swap exists.
            disk_swap_devices: std::fs::read_to_string("/proc/swaps")
                .map(|swaps| disk_swap_devices(&swaps))
                .unwrap_or(0),
        }
    }
}

/// Swap devices in `/proc/swaps` (a header, then one line per device) that
/// are not zram.
fn disk_swap_devices(swaps: &str) -> u32 {
    let devices = swaps
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().next())
        .filter(|device| !device.starts_with("/dev/zram"))
        .count();
    u32::try_from(devices).unwrap_or(u32::MAX)
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
