use std::collections::HashSet;

use firecracker_host_api::ComputerId;
use uuid::Uuid;

use super::{jails, owner};
use crate::domain::ports::Jail;
use crate::outbound::layout::JailId;

#[test]
fn a_computer_jail_name_maps_back_to_its_computer() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(0xabcdef));
    assert_eq!(
        owner(JailId::computer(computer_id).as_str()),
        Jail::Computer(computer_id)
    );
    assert_eq!(owner("golden"), Jail::Golden);
    assert_eq!(owner("c-nothex"), Jail::Unrecognized("c-nothex".to_owned()));
    assert_eq!(owner("agent"), Jail::Unrecognized("agent".to_owned()));
}

#[test]
fn chroots_and_cgroups_are_listed_once_each_and_files_are_skipped() {
    let root = tempfile::tempdir().unwrap();
    let chroots = root.path().join("firecracker");
    let cgroups = root.path().join("vms");
    let in_both = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let cgroup_only = ComputerId::new_from_uuid(Uuid::from_u128(2));
    std::fs::create_dir_all(chroots.join(JailId::computer(in_both).as_str())).unwrap();
    std::fs::create_dir_all(chroots.join("golden")).unwrap();
    std::fs::create_dir_all(cgroups.join(JailId::computer(in_both).as_str())).unwrap();
    std::fs::create_dir_all(cgroups.join(JailId::computer(cgroup_only).as_str())).unwrap();
    std::fs::write(cgroups.join("memory.current"), "0").unwrap();

    let found: HashSet<Jail> = jails(&chroots, &cgroups).unwrap().into_iter().collect();
    assert_eq!(
        found,
        HashSet::from([
            Jail::Computer(in_both),
            Jail::Computer(cgroup_only),
            Jail::Golden,
        ])
    );
}

#[test]
fn missing_directories_hold_no_jails() {
    let root = tempfile::tempdir().unwrap();
    assert_eq!(
        jails(&root.path().join("absent"), &root.path().join("absent-too")).unwrap(),
        Vec::new()
    );
}
