use super::*;

#[test]
fn boundaries_are_half_open_and_null_has_a_distinct_key() {
    let boundary = "2026-03-09T04:00:00Z".parse().unwrap();
    let buckets = PropertyDateRanges {
        ranges: vec![
            PropertyDateRange {
                key: "before".into(),
                start: None,
                end: Some(boundary),
            },
            PropertyDateRange {
                key: "after".into(),
                start: Some(boundary),
                end: None,
            },
        ],
        missing_value_bucket_key: "no date".into(),
    };
    assert_eq!(buckets.validate(), Ok(()));
    assert_eq!(
        buckets.key(Some("2026-03-09T03:59:59Z".parse().unwrap())),
        Ok("before")
    );
    assert_eq!(buckets.key(Some(boundary)), Ok("after"));
    assert_eq!(buckets.key(None), Ok("no date"));
}

#[test]
fn rejects_gaps_overlaps_empty_intervals_and_unbounded_edges() {
    let at = |s: &str| s.parse::<DateTime<Utc>>().unwrap();
    let first = at("2026-03-09T04:00:00Z");
    let second = at("2026-03-10T04:00:00Z");
    let mut buckets = PropertyDateRanges {
        ranges: vec![
            PropertyDateRange {
                key: "a".into(),
                start: None,
                end: Some(first),
            },
            PropertyDateRange {
                key: "b".into(),
                start: Some(first),
                end: None,
            },
        ],
        missing_value_bucket_key: "missing".into(),
    };
    buckets.ranges[1].start = Some(second);
    assert_eq!(
        buckets.validate(),
        Err(PropertyDateRangeError::InvalidBounds)
    );
    buckets.ranges[1].start = Some(at("2026-03-08T04:00:00Z"));
    assert_eq!(
        buckets.validate(),
        Err(PropertyDateRangeError::InvalidBounds)
    );
    buckets.ranges[1].start = Some(first);
    buckets.ranges[1].end = Some(first);
    assert_eq!(
        buckets.validate(),
        Err(PropertyDateRangeError::UnboundedEdges)
    );
    buckets.ranges.push(PropertyDateRange {
        key: "c".into(),
        start: Some(first),
        end: None,
    });
    assert_eq!(
        buckets.validate(),
        Err(PropertyDateRangeError::InvalidBounds)
    );
    buckets.ranges.remove(2);
    buckets.ranges[1].end = None;
    buckets.ranges[0].start = Some(first);
    assert_eq!(
        buckets.validate(),
        Err(PropertyDateRangeError::UnboundedEdges)
    );
}

#[test]
fn rejects_duplicate_oversized_or_empty_keys_and_invalid_range_counts() {
    let mut buckets = PropertyDateRanges {
        ranges: vec![PropertyDateRange {
            key: "a".into(),
            start: None,
            end: None,
        }],
        missing_value_bucket_key: "a".into(),
    };
    assert_eq!(buckets.validate(), Err(PropertyDateRangeError::InvalidKey));
    buckets.missing_value_bucket_key = "".into();
    assert_eq!(buckets.validate(), Err(PropertyDateRangeError::InvalidKey));
    buckets.missing_value_bucket_key = "x".repeat(MAX_DATE_RANGE_KEY_BYTES + 1);
    assert_eq!(buckets.validate(), Err(PropertyDateRangeError::InvalidKey));
    buckets.missing_value_bucket_key = "missing".into();
    assert_eq!(buckets.validate(), Ok(()));
    buckets.ranges.clear();
    assert_eq!(buckets.validate(), Err(PropertyDateRangeError::RangeCount));
    buckets.ranges = (0..=MAX_DATE_RANGES)
        .map(|i| PropertyDateRange {
            key: i.to_string(),
            start: None,
            end: None,
        })
        .collect();
    assert_eq!(buckets.validate(), Err(PropertyDateRangeError::RangeCount));
}
