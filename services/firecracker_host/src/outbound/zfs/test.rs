use super::{clone_arguments, create_arguments, version_at_least};

#[test]
fn a_create_sets_only_the_properties_given() {
    assert_eq!(
        create_arguments("tank/fc/computers/c", Some("16k"), Some(25 << 30)),
        [
            "create",
            "-p",
            "-o",
            "recordsize=16k",
            "-o",
            "refquota=26843545600",
            "tank/fc/computers/c",
        ]
    );
    assert_eq!(
        create_arguments("tank/fc/goldens", None, None),
        ["create", "-p", "tank/fc/goldens"]
    );
}

#[test]
fn a_clone_takes_the_snapshot_then_the_name() {
    assert_eq!(
        clone_arguments(
            "tank/fc/goldens/g@ready",
            "tank/fc/computers/c",
            "16k",
            1 << 30
        ),
        [
            "clone",
            "-o",
            "recordsize=16k",
            "-o",
            "refquota=1073741824",
            "tank/fc/goldens/g@ready",
            "tank/fc/computers/c",
        ]
    );
}

#[test]
fn the_module_version_floor_compares_releases_numerically() {
    assert!(version_at_least("2.4.1-1\n", "2.4.1"));
    assert!(version_at_least("2.4.1-1ubuntu1", "2.4.1"));
    assert!(version_at_least("2.10.0", "2.4.1"));
    assert!(version_at_least("3.0.0", "2.4.1"));
    assert!(!version_at_least("2.4.0", "2.4.1"));
    assert!(!version_at_least("2.2.2-0ubuntu9", "2.4.1"));
    assert!(!version_at_least("2.4", "2.4.1"));
    assert!(!version_at_least("", "2.4.1"));
    assert!(!version_at_least("zfs-kmod", "2.4.1"));
}
