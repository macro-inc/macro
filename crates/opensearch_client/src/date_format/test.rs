use super::*;

#[test]
fn test_epoch_millis_valid() {
    let now_millis = 1704067200123;
    let epoch = EpochMillis::new(now_millis);
    assert!(epoch.is_ok());
    assert_eq!(epoch.unwrap().get(), now_millis);
}

#[test]
fn test_epoch_millis_zero_and_negative_are_accepted() {
    assert_eq!(EpochMillis::new(0).unwrap().get(), 0);
    assert_eq!(EpochMillis::new(-1000).unwrap().get(), -1000);
    assert_eq!(EpochMillis::new(-86_400_000).unwrap().get(), -86_400_000);
}

#[test]
fn test_epoch_millis_seconds_are_accepted() {
    let now_seconds = 1704067200;
    assert_eq!(EpochMillis::new(now_seconds).unwrap().get(), now_seconds);
}

#[test]
fn test_epoch_millis_too_far_future() {
    let too_far = 32503680000001;
    let result = EpochMillis::new(too_far);
    assert!(result.is_err());
    if let Err(OpensearchClientError::ValidationFailed { details }) = result {
        assert!(details.contains("exceeds year 3000"));
    }
}

#[test]
fn test_plausible_filters_only_future_garbage() {
    assert!(EpochMillis::plausible(32503680000001).is_none());
    assert_eq!(EpochMillis::plausible(0).map(|e| e.get()), Some(0));
    assert_eq!(EpochMillis::plausible(-1000).map(|e| e.get()), Some(-1000));
    let millis = 1704067200123;
    assert_eq!(
        EpochMillis::plausible(millis).map(|e| e.get()),
        Some(millis)
    );
}

#[test]
fn test_epoch_millis_serialize() {
    let epoch = EpochMillis::new(1704067200123).unwrap();
    let serialized = serde_json::to_string(&epoch).unwrap();
    assert_eq!(serialized, "1704067200123");
}
