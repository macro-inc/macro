use super::disk_swap_devices;

const HEADER: &str = "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n";

fn no_writeback(_: &str) -> Option<String> {
    Some("none\n".to_owned())
}

#[test]
fn only_zram_swap_counts_as_in_ram() {
    assert_eq!(disk_swap_devices(HEADER, no_writeback), 0);
    assert_eq!(disk_swap_devices("", no_writeback), 0);
    assert_eq!(
        disk_swap_devices(
            &format!(
                "{HEADER}/dev/zram0                              partition\t8388604\t\t0\t\t5\n"
            ),
            no_writeback
        ),
        0
    );
    assert_eq!(
        disk_swap_devices(
            &format!(
                "{HEADER}/dev/zram0 partition 8388604 0 5\n/swapfile file 4194300 0 -2\n/dev/sda2 partition 1048572 0 -3\n"
            ),
            no_writeback
        ),
        2
    );
}

#[test]
fn zram_with_a_writeback_device_counts_as_disk() {
    let swaps =
        format!("{HEADER}/dev/zram0 partition 8388604 0 5\n/dev/zram1 partition 8388604 0 5\n");
    let backing = |name: &str| match name {
        "zram1" => Some("/dev/nvme0n1p3\n".to_owned()),
        _ => Some("none\n".to_owned()),
    };
    assert_eq!(disk_swap_devices(&swaps, backing), 1);
    // A kernel without zram writeback has no backing_dev: RAM only.
    assert_eq!(disk_swap_devices(&swaps, |_| None), 0);
}
