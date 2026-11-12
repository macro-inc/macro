use super::*;
use crate::domain::size::{DiskGib, MemoryGib, Vcpus};

#[test]
fn the_data_disk_gets_the_quota_beyond_the_root_disk() {
    let resources = |disk_gib| ComputerResources {
        vcpus: Vcpus::new(4),
        memory_gib: MemoryGib::new(8),
        disk_gib: DiskGib::new(disk_gib),
    };
    assert_eq!(data_disk_gib(resources(100)), Some(68));
    assert_eq!(data_disk_gib(resources(400)), Some(368));
    assert_eq!(data_disk_gib(resources(ROOT_DISK_GIB)), None);
    assert_eq!(data_disk_gib(resources(8)), None);
}

#[test]
fn image_names_take_incus_aliases_and_docker_tags_only() {
    for valid in [
        "macro-box/2026-11-10",
        "macro-box:latest",
        "macro-box@sha256:ab12",
    ] {
        assert!(GuestImage::try_new(valid).is_ok(), "{valid}");
    }
    for invalid in ["", "macro box", "macro-box;rm", &"a".repeat(256)] {
        assert!(GuestImage::try_new(invalid).is_err(), "{invalid}");
    }
}
