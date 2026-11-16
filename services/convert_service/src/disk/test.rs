use std::path::Path;

use super::DiskGuard;

const GIB: u64 = 1024 * 1024 * 1024;

#[test]
fn a_disk_with_room_passes() {
    DiskGuard::new(Path::new("/"), 2 * GIB, 50_000)
        .check_free(15 * GIB, 1_000_000, 1_300_000)
        .unwrap();
}

#[test]
fn a_disk_at_its_reserve_passes() {
    DiskGuard::new(Path::new("/"), 2 * GIB, 50_000)
        .check_free(2 * GIB, 50_000, 1_300_000)
        .unwrap();
}

#[test]
fn a_disk_short_on_space_fails() {
    let error = DiskGuard::new(Path::new("/"), 2 * GIB, 50_000)
        .check_free(2 * GIB - 1, 1_000_000, 1_300_000)
        .unwrap_err();

    assert!(error.to_string().contains("bytes free"), "{error}");
}

#[test]
fn a_full_disk_fails() {
    assert!(
        DiskGuard::new(Path::new("/"), 2 * GIB, 50_000)
            .check_free(0, 1_000_000, 1_300_000)
            .is_err()
    );
}

#[test]
fn a_disk_short_on_inodes_fails() {
    let error = DiskGuard::new(Path::new("/"), 2 * GIB, 50_000)
        .check_free(15 * GIB, 49_999, 1_300_000)
        .unwrap_err();

    assert!(error.to_string().contains("inodes free"), "{error}");
}

#[test]
fn a_filesystem_that_does_not_count_inodes_passes() {
    DiskGuard::new(Path::new("/"), 2 * GIB, 50_000)
        .check_free(15 * GIB, 0, 0)
        .unwrap();
}

#[test]
fn the_real_disk_is_read() {
    let dir = tempfile::tempdir().unwrap();

    DiskGuard::new(dir.path(), 0, 0).check().unwrap();
    assert!(DiskGuard::new(dir.path(), u64::MAX, 0).check().is_err());
}

#[test]
fn a_disk_that_cannot_be_read_fails() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing");

    assert!(DiskGuard::new(&missing, 0, 0).check().is_err());
}
