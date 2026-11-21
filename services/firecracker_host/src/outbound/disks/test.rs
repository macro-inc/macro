use firecracker_host_api::ComputerResources;

use super::{
    BYTES_PER_GIB, computer_quota_bytes, grow, home_file_name, snapshot_name, split_golden_homes,
};

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

#[test]
fn a_golden_clone_keeps_its_size_of_home_and_drops_the_others() {
    let names: Vec<String> = [
        "rootfs.ext4",
        "home-10g.ext4",
        "home-68g.ext4",
        "home-368g.ext4",
        "home-68g.ext4.new",
        "home-xg.ext4",
        "record.json",
    ]
    .map(String::from)
    .to_vec();
    assert_eq!(
        split_golden_homes(&names, 68),
        (
            Some("home-68g.ext4"),
            vec!["home-10g.ext4", "home-368g.ext4"]
        )
    );
    assert_eq!(
        split_golden_homes(&names, 20),
        (
            None,
            vec!["home-10g.ext4", "home-68g.ext4", "home-368g.ext4"]
        )
    );
    assert_eq!(home_file_name(68), "home-68g.ext4");
}

#[test]
fn a_snapshot_name_is_its_kind_and_the_time_to_the_millisecond() {
    let name = snapshot_name("homes");
    let time = name.strip_prefix("homes-").unwrap();
    assert_eq!(time.len(), "20261118T180036123".len());
    assert!(time[..8].bytes().all(|byte| byte.is_ascii_digit()) && &time[8..9] == "T");
}
