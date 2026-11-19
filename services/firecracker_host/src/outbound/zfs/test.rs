use super::{clone_arguments, create_arguments};

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
