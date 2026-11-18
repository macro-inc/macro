use super::{ControlPlaneId, GuestImage};

#[test]
fn invalid_values_do_not_deserialize() {
    assert!(serde_json::from_str::<GuestImage>("\"macro-box/2026-11-17\"").is_ok());
    assert!(serde_json::from_str::<GuestImage>("\"bad image\"").is_err());
    assert!(serde_json::from_str::<GuestImage>("\"\"").is_err());
    assert!(serde_json::from_str::<ControlPlaneId>("\"dev-1\"").is_ok());
    assert!(serde_json::from_str::<ControlPlaneId>("\"dev/1\"").is_err());
}
