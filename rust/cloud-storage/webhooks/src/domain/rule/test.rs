use super::*;
use serde_json::json;

fn channel_rule(filters: Option<FilterGroup>) -> RuleDefinition {
    RuleDefinition::from_parts(
        Some(1),
        vec!["channel.message.created".to_string()],
        filters,
    )
}

#[test]
fn deserializes_plan_contract_shape() {
    let raw = json!({
        "version": 1,
        "events": ["channel.message.created"],
        "filters": { "all": [
            { "field": "data.channel_id", "op": "in", "value": ["ch_123", "ch_456"] }
        ]}
    });
    let rule: RuleDefinition = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(rule.version, 1);
    assert_eq!(rule.events[0].as_str(), "channel.message.created");
    rule.validate_structure().unwrap();
    // Round-trips back to the same shape.
    assert_eq!(serde_json::to_value(&rule).unwrap(), raw);
}

#[test]
fn rejects_unknown_event() {
    let rule = RuleDefinition::from_parts(Some(1), vec!["nope.bad".to_string()], None);
    assert_eq!(
        rule.validate_structure(),
        Err(RuleValidationError::UnknownEvent("nope.bad".to_string()))
    );
}

#[test]
fn rejects_unsupported_version_and_empty_events() {
    assert_eq!(
        RuleDefinition::from_parts(Some(2), vec!["channel.message.created".into()], None)
            .validate_structure(),
        Err(RuleValidationError::UnsupportedVersion(2))
    );
    assert_eq!(
        RuleDefinition::from_parts(Some(1), vec![], None).validate_structure(),
        Err(RuleValidationError::NoEvents)
    );
}

#[test]
fn rejects_disallowed_field() {
    let rule = channel_rule(Some(FilterGroup::All(vec![FilterNode::Condition(
        Condition {
            field: "data.secret".to_string(),
            op: FilterOperator::Eq,
            value: Some(json!("x")),
        },
    )])));
    assert_eq!(
        rule.validate_structure(),
        Err(RuleValidationError::FieldNotAllowed {
            field: "data.secret".to_string()
        })
    );
}

#[test]
fn rejects_bad_operator_value_shapes() {
    // `in` requires an array.
    let rule = channel_rule(Some(FilterGroup::All(vec![FilterNode::Condition(
        Condition {
            field: "data.channel_id".to_string(),
            op: FilterOperator::In,
            value: Some(json!("not-an-array")),
        },
    )])));
    assert!(matches!(
        rule.validate_structure(),
        Err(RuleValidationError::InvalidFilter { .. })
    ));
}

#[test]
fn collects_resource_refs_for_positive_membership_only() {
    let rule = channel_rule(Some(FilterGroup::All(vec![
        FilterNode::Condition(Condition {
            field: "data.channel_id".to_string(),
            op: FilterOperator::In,
            value: Some(json!(["ch_1", "ch_2"])),
        }),
        // not_in must NOT be access-checked.
        FilterNode::Condition(Condition {
            field: "data.channel_id".to_string(),
            op: FilterOperator::NotIn,
            value: Some(json!(["ch_999"])),
        }),
    ])));
    rule.validate_structure().unwrap();
    let refs = rule.resource_refs();
    let ids: Vec<&str> = refs.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, vec!["ch_1", "ch_2"]);
    assert!(refs.iter().all(|r| r.entity_type == EntityType::Channel));
}

#[test]
fn nested_group_is_walked() {
    let rule = channel_rule(Some(FilterGroup::All(vec![FilterNode::Group(
        FilterGroup::Any(vec![FilterNode::Condition(Condition {
            field: "data.channel_id".to_string(),
            op: FilterOperator::Eq,
            value: Some(json!("ch_nested")),
        })]),
    )])));
    rule.validate_structure().unwrap();
    assert_eq!(rule.resource_refs()[0].id, "ch_nested");
}
