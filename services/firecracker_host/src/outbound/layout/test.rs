use std::path::PathBuf;

use firecracker_host_api::{ComputerId, GoldenKey, GuestImage};

use super::{HOME, JailId, Layout};
use crate::domain::ports::Jail;

fn layout() -> Layout {
    Layout::new(PathBuf::from("/srv/durable"), PathBuf::from("/srv/images"))
}

#[test]
fn a_computers_files_live_under_its_id() {
    let computer_id = ComputerId::new_from_uuid(
        uuid::Uuid::parse_str("0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b").unwrap(),
    );
    let layout = layout();
    assert_eq!(
        layout.computer(computer_id),
        PathBuf::from("/srv/durable/computers/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
    );
    assert_eq!(
        layout.hibernation(computer_id),
        PathBuf::from("/srv/durable/hibernation/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
    );
    let jail = JailId::computer(computer_id);
    assert_eq!(jail.as_str(), "c-0193a1b2c3d47e5f8a9b0c1d2e3f4a5b");
    assert_eq!(
        layout.in_chroot(&jail, HOME),
        PathBuf::from(
            "/srv/durable/jails/firecracker/c-0193a1b2c3d47e5f8a9b0c1d2e3f4a5b/root/home.ext4"
        )
    );
}

#[test]
fn a_golden_lives_under_its_image_and_shape() {
    let key = GoldenKey {
        image: GuestImage::try_new("macro-box/2026-11-17").unwrap(),
        vcpus: 2,
        memory_mib: 4096,
    };
    assert_eq!(
        layout().golden(&key),
        PathBuf::from("/srv/durable/goldens/macro-box/2026-11-17/2v-4096m")
    );
    assert_eq!(
        Layout::golden_relative(&key),
        PathBuf::from("macro-box/2026-11-17/2v-4096m")
    );
    assert_eq!(
        layout().image(&key.image),
        PathBuf::from("/srv/images/macro-box/2026-11-17")
    );
}

#[test]
fn a_jail_names_its_owner() {
    let computer_id = ComputerId::new_from_uuid(uuid::Uuid::from_u128(7));
    assert_eq!(
        JailId::computer(computer_id).owner(),
        Jail::Computer(computer_id)
    );
    assert_eq!(JailId::golden().owner(), Jail::Golden);
    let stranger = JailId::parse("c-not-a-uuid").unwrap();
    assert_eq!(
        stranger.owner(),
        Jail::Unrecognized("c-not-a-uuid".to_owned())
    );
}

#[test]
fn only_names_the_jailer_accepts_are_jail_ids() {
    assert!(JailId::parse("golden").is_ok());
    assert!(JailId::parse("").is_err());
    assert!(JailId::parse("a/b").is_err());
    assert!(JailId::parse("a.b").is_err());
    assert!(JailId::parse(&"a".repeat(65)).is_err());
    assert!(JailId::parse(&"a".repeat(64)).is_ok());
}
