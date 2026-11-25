use firecracker_host_api::ComputerResources;

use super::{
    BYTES_PER_GIB, computer_quota_bytes, grow, home_file_name, snapshot_name, split_golden_homes,
    system_disk_file_name, system_disk_of_file,
};
use crate::domain::model::SystemDisk;

#[test]
fn system_disk_files_round_trip_and_nothing_else_is_one() {
    assert_eq!(system_disk_file_name(SystemDisk(0)), "rootfs.ext4");
    assert_eq!(system_disk_file_name(SystemDisk(3)), "rootfs.3.ext4");
    for generation in [0, 1, 42] {
        let name = system_disk_file_name(SystemDisk(generation));
        assert_eq!(system_disk_of_file(&name), Some(SystemDisk(generation)));
    }
    for name in [
        "home.ext4",
        "rootfs.0.ext4",
        "rootfs.01.ext4",
        "rootfs.x.ext4",
        "rootfs.ext4.new",
        "record.json",
    ] {
        assert_eq!(system_disk_of_file(name), None, "{name}");
    }
}

#[test]
fn a_quota_holds_both_disks_all_of_memory_and_headroom() {
    let resources = ComputerResources {
        vcpus: 2,
        memory_mib: 4096,
        root_disk_gib: 30,
        home_disk_gib: 10,
    };
    // 2 x 30 root + 10 home + 4 memory + 1 headroom.
    assert_eq!(computer_quota_bytes(&resources, 20), 75 * BYTES_PER_GIB);
}

#[test]
fn a_quota_rounds_memory_up_and_never_undercuts_the_golden() {
    let resources = ComputerResources {
        vcpus: 1,
        memory_mib: 1500,
        root_disk_gib: 5,
        home_disk_gib: 1,
    };
    // 2 x the golden's 20 root + 1 home + 2 memory (1500 MiB rounded up) + 1.
    assert_eq!(computer_quota_bytes(&resources, 20), 44 * BYTES_PER_GIB);
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

#[tokio::test]
async fn a_system_disk_is_cloned_beside_the_others_and_leftovers_go() {
    use firecracker_host_api::{GoldenKey, GuestImage};

    use super::{Containers, FileDisks};
    use crate::domain::ports::Disks;
    use crate::outbound::layout::Layout;

    let directory = tempfile::tempdir().unwrap();
    let layout = Layout::new(
        directory.path().join("durable"),
        directory.path().join("images"),
    );
    let key = GoldenKey {
        image: GuestImage::try_new("macro-box/next").unwrap(),
        vcpus: 2,
        memory_mib: 2048,
    };
    let golden = layout.golden(&key);
    std::fs::create_dir_all(&golden).unwrap();
    std::fs::write(golden.join("rootfs.ext4"), b"next image").unwrap();
    let request = firecracker_host_api::CreateComputer {
        control_plane_id: firecracker_host_api::ControlPlaneId::try_new("dev").unwrap(),
        generation: firecracker_host_api::EnrollmentGeneration::new(1),
        pairing_id: firecracker_host_api::PairingId::new_from_uuid(uuid::Uuid::from_u128(9)),
        image: GuestImage::try_new("macro-box/old").unwrap(),
        role: firecracker_host_api::ComputerRole::Person,
        resources: ComputerResources {
            vcpus: 2,
            memory_mib: 2048,
            root_disk_gib: 1,
            home_disk_gib: 1,
        },
        enrollment: firecracker_host_api::EnrollmentDocument(serde_json::json!({})),
        start: false,
        return_when_resumed: false,
    };
    let record = crate::domain::model::ComputerRecord::new(
        firecracker_host_api::ComputerId::new_from_uuid(uuid::Uuid::from_u128(7)),
        &request,
        chrono::Utc::now(),
    );
    let computer = layout.computer(record.computer_id);
    std::fs::create_dir_all(&computer).unwrap();
    for name in [
        "rootfs.ext4",
        "rootfs.4.ext4",
        "rootfs.5.ext4.new",
        "home.ext4",
    ] {
        std::fs::write(computer.join(name), b"x").unwrap();
    }
    let disks = FileDisks::new(layout, Containers::Xfs, 1);

    disks
        .clone_system_disk(&record, &key, SystemDisk(5))
        .await
        .unwrap();
    let cloned = computer.join("rootfs.5.ext4");
    let mut start = [0; 10];
    std::io::Read::read_exact(&mut std::fs::File::open(&cloned).unwrap(), &mut start).unwrap();
    assert_eq!(&start, b"next image");
    assert_eq!(
        std::fs::metadata(&cloned).unwrap().len(),
        u64::from(record.resources.root_disk_gib) * BYTES_PER_GIB
    );

    let removed = disks
        .remove_other_system_disks(record.computer_id, &[SystemDisk(0), SystemDisk(5)])
        .await
        .unwrap();
    assert_eq!(removed, [SystemDisk(4)]);
    let mut left: Vec<String> = std::fs::read_dir(&computer)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    left.sort();
    assert_eq!(left, ["home.ext4", "rootfs.5.ext4", "rootfs.ext4"]);
}
