use super::*;

#[test]
fn test_epoch_millis_valid() {
    let now_millis = 1704067200123; // 2024-01-01 with sub-second precision
    let epoch = EpochMillis::new(now_millis);
    assert!(epoch.is_ok());
    assert_eq!(epoch.unwrap().get(), now_millis);
}

#[test]
fn test_epoch_millis_seconds() {
    let now_seconds = 1704067200; // 2024-01-01 in seconds
    let result = EpochMillis::new(now_seconds);
    assert!(result.is_err());
    if let Err(OpensearchClientError::ValidationFailed { details }) = result {
        assert!(details.contains("appears to be in seconds"));
    }
}

#[test]
fn test_epoch_millis_too_far_future() {
    let too_far = 32503680000001; // Just after year 3000 in millis
    let result = EpochMillis::new(too_far);
    assert!(result.is_err());
    if let Err(OpensearchClientError::ValidationFailed { details }) = result {
        assert!(details.contains("exceeds year 3000"));
    }
}

#[test]
fn test_epoch_millis_serialize() {
    let epoch = EpochMillis::new(1704067200123).unwrap();
    let serialized = serde_json::to_string(&epoch).unwrap();
    assert_eq!(serialized, "1704067200123");
}
