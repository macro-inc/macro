use super::NotificationLane;

#[test]
fn serializes_as_lowercase_lane_names() {
    for (lane, json) in [
        (NotificationLane::Signal, "\"signal\""),
        (NotificationLane::Noise, "\"noise\""),
    ] {
        assert_eq!(lane.to_string(), lane.as_str());
        assert_eq!(serde_json::to_string(&lane).unwrap(), json);
        assert_eq!(
            serde_json::from_str::<NotificationLane>(json).unwrap(),
            lane
        );
    }
}

#[test]
fn rejects_unknown_lanes() {
    for json in ["null", "\"Noise\"", "\"all\"", "\"\""] {
        assert!(serde_json::from_str::<NotificationLane>(json).is_err());
    }
}

#[test]
fn a_reader_that_names_no_lane_reads_signal() {
    assert_eq!(NotificationLane::default(), NotificationLane::Signal);
}
