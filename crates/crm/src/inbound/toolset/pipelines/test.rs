use ai_toolset::schema::generate_validated_input_schema;

use super::*;

#[test]
fn every_pipeline_tool_schema_is_valid_for_strict_tool_use() {
    for (name, validated) in [
        (
            "ListPipelines",
            generate_validated_input_schema::<ListPipelines>(),
        ),
        (
            "FindPipelineEntries",
            generate_validated_input_schema::<FindPipelineEntries>(),
        ),
        (
            "AddToPipeline",
            generate_validated_input_schema::<AddToPipeline>(),
        ),
        (
            "UpdatePipelineEntries",
            generate_validated_input_schema::<UpdatePipelineEntries>(),
        ),
        (
            "RemoveFromPipeline",
            generate_validated_input_schema::<RemoveFromPipeline>(),
        ),
        (
            "CreatePipeline",
            generate_validated_input_schema::<CreatePipeline>(),
        ),
        (
            "EditPipeline",
            generate_validated_input_schema::<EditPipeline>(),
        ),
    ] {
        let validated = validated.unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(validated.name, name);
        // The deferred-tool catalog shows only the first sentence: it must
        // say what CRM users call these things.
        let first = validated.description.split(". ").next().unwrap_or_default();
        assert!(
            ["pipeline", "deal"].iter().any(|word| first.contains(word)),
            "{name}: {first}"
        );
    }
}

#[test]
fn a_field_value_is_one_value_several_or_empty() {
    let value = |value: Option<&str>, values: Option<Vec<&str>>| ToolFieldValue {
        field: "Stage".into(),
        value: value.map(Into::into),
        values: values.map(|values| values.into_iter().map(Into::into).collect()),
    };
    assert_eq!(
        value(Some("Demo"), None).pair().1,
        FieldInput::One("Demo".into())
    );
    assert_eq!(
        value(Some("Demo"), Some(vec!["Demo", "Trial"])).pair().1,
        FieldInput::Many(vec!["Demo".into(), "Trial".into()])
    );
    assert_eq!(value(None, Some(Vec::new())).pair().1, FieldInput::Clear);
    assert_eq!(value(None, None).pair().1, FieldInput::Clear);
}

#[test]
fn single_values_read_plainly_and_several_as_lists() {
    assert_eq!(
        json(&FieldValue::Labels(vec!["Demo".into()])),
        serde_json::json!("Demo")
    );
    assert_eq!(
        json(&FieldValue::References(vec![
            "macro|a@x.com".into(),
            "macro|b@x.com".into()
        ])),
        serde_json::json!(["macro|a@x.com", "macro|b@x.com"])
    );
    assert_eq!(
        json(&FieldValue::Number(48_000.0)),
        serde_json::json!(48_000.0)
    );
}
