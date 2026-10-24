use super::*;

#[test]
fn validates_candidate_bounds_and_sort_choice() {
    let mut query = CandidateQuery {
        date_property_id: None,
        timestamp_sort: Some(SimpleSortMethod::CreatedAt),
        direction: CandidateDirection::Ascending,
        grouping: None,
        cursor: None,
        limit: 500,
    };
    assert!(query.validate().is_ok());
    query.limit = 0;
    assert!(query.validate().is_err());
    query.limit = 501;
    assert!(query.validate().is_err());
    query.limit = 500;
    query.date_property_id = Some(Uuid::nil());
    assert!(query.validate().is_err());
    query.timestamp_sort = None;
    query.grouping = Some(GroupingConfig::new(crate::GroupByField::Date).with_limit(700));
    assert_eq!(query.per_group_limit(), 500);
    query.grouping = Some(GroupingConfig::new(crate::GroupByField::Date).with_limit(0));
    assert!(query.validate().is_err());
}

#[test]
fn date_groups_reject_unknown_keys_and_invalid_partitions() {
    let mut query = CandidateQuery {
        date_property_id: None,
        timestamp_sort: Some(SimpleSortMethod::UpdatedAt),
        direction: CandidateDirection::Ascending,
        grouping: Some(
            GroupingConfig::new(crate::GroupByField::Property {
                property_definition_id: Uuid::from_u128(42),
                entity_type: None,
                bucketing: Some(crate::PropertyBucketing::DateRanges(
                    crate::PropertyDateRanges {
                        ranges: vec![crate::PropertyDateRange {
                            key: "present".into(),
                            start: None,
                            end: None,
                        }],
                        missing_value_bucket_key: "missing".into(),
                    },
                )),
            })
            .with_group_key("unknown"),
        ),
        cursor: None,
        limit: 10,
    };
    assert_eq!(query.validate(), Err(CandidateQueryError::UnknownGroupKey));
    query.grouping.as_mut().unwrap().group_key = Some("missing".into());
    assert!(query.validate().is_ok());
    let crate::GroupByField::Property {
        bucketing: Some(crate::PropertyBucketing::DateRanges(ranges)),
        ..
    } = &mut query.grouping.as_mut().unwrap().field
    else {
        unreachable!();
    };
    ranges.ranges[0].key = "embedded\0nul".into();
    assert_eq!(
        query.validate(),
        Err(CandidateQueryError::InvalidRanges(
            crate::PropertyDateRangeError::InvalidKey
        ))
    );
}

#[test]
fn grouped_continuation_requires_its_own_group_key() {
    let mut query = CandidateQuery {
        date_property_id: None,
        timestamp_sort: Some(SimpleSortMethod::UpdatedAt),
        direction: CandidateDirection::Ascending,
        grouping: Some(GroupingConfig::new(crate::GroupByField::Date)),
        cursor: Some(CandidateCursor {
            identity: CandidateIdentity {
                id: "last".into(),
                entity_type: "TASK".into(),
            },
            sort_value: CandidateSortValue(None),
        }),
        limit: 1,
    };
    assert_eq!(query.validate(), Err(CandidateQueryError::MissingGroupKey));
    query.grouping.as_mut().unwrap().group_key = Some("first".into());
    assert!(query.validate().is_ok());
}
