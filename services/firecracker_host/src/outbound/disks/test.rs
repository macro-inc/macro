use firecracker_host_api::ComputerResources;

use super::{BYTES_PER_GIB, computer_quota_bytes, grow};

#[test]
fn a_quota_holds_both_disks_all_of_memory_and_headroom() {
    let resources = ComputerResources {
        vcpus: 2,
        memory_mib: 4096,
        root_disk_gib: 30,
        home_disk_gib: 10,
    };
    // 30 root + 10 home + 4 memory + 1 headroom.
    assert_eq!(computer_quota_bytes(&resources, 20), 45 * BYTES_PER_GIB);
}

#[test]
fn a_quota_rounds_memory_up_and_never_undercuts_the_golden() {
    let resources = ComputerResources {
        vcpus: 1,
        memory_mib: 1500,
        root_disk_gib: 5,
        home_disk_gib: 1,
    };
    // The golden's 20 root + 1 home + 2 memory (1500 MiB rounded up) + 1.
    assert_eq!(computer_quota_bytes(&resources, 20), 24 * BYTES_PER_GIB);
}

#[test]
fn grow_never_shrinks() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("home.ext4");
    grow(&path, 2).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 2 * BYTES_PER_GIB);
    grow(&path, 1).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 2 * BYTES_PER_GIB);
}
