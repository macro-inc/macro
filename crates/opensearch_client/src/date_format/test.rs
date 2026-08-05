use super::*;

#[test]
fn test_epoch_millis_valid() {
    let now_millis = 1704067200123; // 2024-01-01 with sub-second precision
    let epoch = EpochMillis::new(now_millis);
    assert!(epoch.is_ok());
    assert_eq!(epoch.unwrap().get(), now_millis);
}

#[test]
fn test_epoch_millis_zero_and_negative_are_accepted() {
    // Prod has ~11.7k email messages dated before year 2000, 3.4k of them
    // exactly at epoch 0. OpenSearch indexes these fine (1970, sorting
    // oldest-first); rejecting them used to fail the whole batch the message
    // arrived in and leave its entire email thread unindexed.
    assert_eq!(EpochMillis::new(0).unwrap().get(), 0);
    assert_eq!(EpochMillis::new(-1000).unwrap().get(), -1000);
    assert_eq!(EpochMillis::new(-86_400_000).unwrap().get(), -86_400_000);
}

#[test]
fn test_epoch_millis_seconds_are_accepted_now() {
    // A seconds value would index as January 1970 rather than being rejected.
    // Nothing can produce one: every caller builds this from chrono's
    // `timestamp_millis()`, so the unit is guaranteed before we get here.
    let now_seconds = 1704067200; // 2024-01-01 in seconds
    assert_eq!(EpochMillis::new(now_seconds).unwrap().get(), now_seconds);
}

#[test]
fn test_epoch_millis_too_far_future() {
    // The bound that still earns its place: sorts are descending, so one
    // far-future doc pins itself to the top of every page. It also catches
    // micros or nanos passed as millis.
    let too_far = 32503680000001; // Just after year 3000 in millis
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
