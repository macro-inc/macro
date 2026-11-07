use super::*;
use serde_json::{Value, json};
fn convert(
    expressions: Value,
    recurrence: Value,
    intent: InputIntent,
) -> Result<TemporalExpressions, InputError> {
    serde_json::from_value::<Facts>(json!({"expressions":expressions,"recurrence":recurrence}))
        .unwrap()
        .into_expressions(intent)
}
fn clock(role: &str) -> Value {
    json!({"kind":"clock","role":role,"span":"7pm","hour":7,"minute":0,"period":"pm"})
}
#[test]
fn rejects_duplicate_roles_and_conflicting_time_sources() {
    let date = json!({"kind":"relative_day","role":"start","span":"tomorrow","offset_days":1});
    for facts in [
        json!([date, date]),
        json!([clock("start"), clock("start")]),
        json!([clock("start"),{"kind":"offset","span":"in an hour","minutes":60}]),
        json!([clock("end"),{"kind":"duration","span":"one hour","minutes":60}]),
        json!([{"kind":"weekday","role":"end","span":"Friday","weekday":"friday","week":"next"}]),
    ] {
        assert!(convert(facts, json!([]), InputIntent::Calendar).is_err());
    }
}
#[test]
fn preserves_explicit_end_roles_without_inheriting_dates_in_the_adapter() {
    let fields = convert(
        json!([clock("start"), clock("end")]),
        json!([]),
        InputIntent::Calendar,
    )
    .unwrap();
    let TemporalExpressions::Calendar(fields) = fields else {
        panic!("wrong intent")
    };
    assert!(matches!(
        fields.start,
        Some(StartExpression::Local { date: None, .. })
    ));
    assert!(matches!(
        fields.end,
        Some(EndExpression::At { date: None, .. })
    ));
    assert!(convert(json!([clock("end")]), json!([]), InputIntent::Task).is_err());
}
#[test]
fn prompt_examples_match_the_actual_strict_schema_and_typed_adapter() {
    let schema = super::super::AgentTemporalExtractor::schema();
    let validator =
        agent::structured_output::validate_schema(&agent::structured_output::DynamicSchema {
            schema,
            name: "TemporalExpression".into(),
            description: None,
        })
        .unwrap();
    for line in include_str!("../../../../prompts/temporal_prompt.txt").lines() {
        if let Some(example) = line.strip_prefix("JSON: ") {
            let value: Value = serde_json::from_str(example).unwrap();
            validator.validate(&value).unwrap();
            serde_json::from_value::<Facts>(value)
                .unwrap()
                .into_expressions(InputIntent::Calendar)
                .unwrap();
        }
    }
}
