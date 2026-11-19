use super::{ComputerRole, ControlPlaneId, GuestImage};

#[test]
fn invalid_values_do_not_deserialize() {
    assert!(serde_json::from_str::<GuestImage>("\"macro-box/2026-11-17\"").is_ok());
    assert!(serde_json::from_str::<GuestImage>("\"bad image\"").is_err());
    assert!(serde_json::from_str::<GuestImage>("\"\"").is_err());
    assert!(serde_json::from_str::<ControlPlaneId>("\"dev-1\"").is_ok());
    assert!(serde_json::from_str::<ControlPlaneId>("\"dev/1\"").is_err());
}

#[test]
fn a_computer_role_is_its_snake_case_name_on_every_wire() {
    for (role, wire) in [
        (ComputerRole::Person, "person"),
        (ComputerRole::Agent, "agent"),
    ] {
        assert_eq!(serde_json::to_value(role).unwrap(), wire);
        assert_eq!(role.to_string(), wire);
    }
}
