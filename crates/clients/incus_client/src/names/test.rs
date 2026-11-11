use super::*;

#[test]
fn instance_names_require_canonical_computer_uuids() {
    assert!(InstanceName::try_new("mc-01900000000070008000000000000001").is_ok());
    for value in [
        "",
        "mc-worker",
        "mc-01900000-0000-7000-8000-000000000001",
        "mc-0190000000007000800000000000000G",
        "mc-0190000000007000800000000000000A",
    ] {
        assert!(InstanceName::try_new(value).is_err());
        assert!(serde_json::from_value::<InstanceName>(serde_json::json!(value)).is_err());
    }
}

#[test]
fn resource_names_reject_empty_and_unsafe_names() {
    assert!(ImageAlias::try_new("macro-box/2026-11-10").is_ok());
    assert!(ProfileName::try_new("macro-box").is_ok());
    assert!(StoragePoolName::try_new("local_pool-1").is_ok());
    assert!(StorageVolumeName::try_new("mc-01900000000070008000000000000001-data").is_ok());
    for value in ["", "bad name", "bad\nname", "bad\0name", "é"] {
        assert!(ImageAlias::try_new(value).is_err());
        assert!(ProfileName::try_new(value).is_err());
        assert!(StoragePoolName::try_new(value).is_err());
        assert!(StorageVolumeName::try_new(value).is_err());
    }
    assert!(ProfileName::try_new("../profile").is_err());
    assert!(StoragePoolName::try_new("../pool").is_err());
    assert!(StorageVolumeName::try_new("../volume").is_err());
}
