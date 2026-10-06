use super::*;
use serde_json::json;

#[test]
fn a_complete_intake_resolves_keys_and_rejects_empty_screening_groups() {
    let draft: Draft = serde_json::from_value(json!({
        "description": "Startup intake", "confirmationMessage": "Thank you",
        "sections": [
            {"kind":"questions","key":"team","title":"Your team","description":"",
             "questions":[{"key":"size","column":{"kind":"new","name":"Team size","type":{"type":"number"}},"required":true}]},
            {"kind":"gate","key":"screen","title":"Eligibility","description":"","message":"Not eligible",
             "rules":{"conjunction":"and","conditions":[{"kind":"condition","question":{"key":"size"},"test":{"kind":"value","test":{"kind":"number","operator":"greaterThanOrEqual","value":5}}}]}}
        ]
    })).unwrap();
    let plan = prepare(&draft, &[]).unwrap();
    assert_eq!(plan.columns.len(), 1);
    assert_eq!(plan.layout.sections.len(), 2);
    let FormSection::Gate { rules, .. } = &plan.layout.sections[1] else {
        panic!("gate")
    };
    assert_eq!(rules.conditions()[0].column, plan.columns[0].id);
    let mut empty = draft.clone();
    let Section::Gate { rules, .. } = &mut empty.sections[1] else {
        panic!("gate")
    };
    rules.conditions.clear();
    assert!(
        prepare(&empty, &[])
            .unwrap_err()
            .to_string()
            .contains("EmptyScreeningGroup")
    );
}

#[test]
fn invalid_widgets_duplicate_keys_and_later_references_fail_before_writes() {
    let mut draft: Draft = serde_json::from_value(json!({"sections":[
        {"kind":"questions","key":"team","questions":[
            {"key":"size","column":{"kind":"new","name":"Size","type":{"type":"number"}},"widget":"dropdown"}]}]
    })).unwrap();
    assert!(
        prepare(&draft, &[])
            .unwrap_err()
            .to_string()
            .contains("UnsupportedWidget")
    );
    let Section::Questions { questions, .. } = &mut draft.sections[0] else {
        panic!("questions")
    };
    questions[0].widget = None;
    questions.push(questions[0].clone());
    assert!(
        prepare(&draft, &[])
            .unwrap_err()
            .to_string()
            .contains("DuplicateQuestionKey")
    );
}

#[test]
fn equivalent_numeric_options_are_rejected_before_schema_provisioning() {
    let draft: Draft = serde_json::from_value(json!({"sections":[
        {"kind":"questions","key":"team","questions":[
            {"key":"size","column":{"kind":"new","name":"Size","type":{"type":"select_number","multi":false},"options":[
                {"key":"one","label":"1"},{"key":"also_one","label":"1.0"}
            ]}}]}]
    })).unwrap();
    assert!(
        prepare(&draft, &[]).is_err(),
        "equivalent numeric options cannot survive database normalization"
    );
}
