use super::{MachineConfig, SnapshotLoad};

/// Without dirty page tracking a hibernation snapshot holds every resident
/// page instead of the diff: every load and every boot must ask for it.
#[test]
fn every_load_and_boot_tracks_dirty_pages() {
    let load = serde_json::to_value(SnapshotLoad::paused("/vmstate", "/mem")).unwrap();
    let boot = serde_json::to_value(MachineConfig::new(2, 2048)).unwrap();

    assert_eq!(load["track_dirty_pages"], true);
    assert_eq!(load["resume_vm"], false);
    assert_eq!(load["mem_backend"]["backend_type"], "File");
    assert_eq!(boot["track_dirty_pages"], true);
}
