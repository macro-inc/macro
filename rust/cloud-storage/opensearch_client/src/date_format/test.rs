use super::*;

#[test]
fn test_epoch_seconds_valid() {
    let now = 1704067200; // 2024-01-01
    let epoch = EpochSeconds::new(now);
    assert!(epoch.is_ok());
    assert_eq!(epoch.unwrap().get(), now);
}

#[test]
fn test_epoch_seconds_milliseconds() {
    let now_millis = 1704067200000; // 2024-01-01 in milliseconds
    let result = EpochSeconds::new(now_millis);
    assert!(result.is_err());
    if let Err(OpensearchClientError::ValidationFailed { details }) = result {
        assert!(details.contains("appears to be in milliseconds"));
    }
}

#[test]
fn test_epoch_seconds_too_old() {
    let old = 946684799; // Just before year 2000
    let result = EpochSeconds::new(old);
    assert!(result.is_err());
    if let Err(OpensearchClientError::ValidationFailed { details }) = result {
        assert!(details.contains("before year 2000"));
    }
}

#[test]
fn test_epoch_seconds_serialize() {
    let epoch = EpochSeconds::new(1704067200).unwrap();
    let serialized = serde_json::to_string(&epoch).unwrap();
    assert_eq!(serialized, "1704067200");
}
