use super::disk_swap_devices;

#[test]
fn only_zram_swap_counts_as_in_ram() {
    let header = "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n";
    assert_eq!(disk_swap_devices(header), 0);
    assert_eq!(
        disk_swap_devices(&format!(
            "{header}/dev/zram0                              partition\t8388604\t\t0\t\t5\n"
        )),
        0
    );
    assert_eq!(
        disk_swap_devices(&format!(
            "{header}/dev/zram0 partition 8388604 0 5\n/swapfile file 4194300 0 -2\n/dev/sda2 partition 1048572 0 -3\n"
        )),
        2
    );
    assert_eq!(disk_swap_devices(""), 0);
}
