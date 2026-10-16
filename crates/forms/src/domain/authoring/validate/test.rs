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

#[test]
fn review_regression_preserving_human_content_keeps_authoring_limits() {
    use models_forms::{Audience, FormQuestionId, FormSectionId, QuestionLayout};
    let column = Column {
        id: ColumnId::new(),
        name: "Contact".into(),
        kind: ColumnKind::Entity {
            target: models_databases::EntityKind::User,
            multi: false,
        },
        options: vec![],
    };
    let previous = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: FormSectionId::new(),
                title: String::new(),
                description: String::new(),
                questions: vec![QuestionLayout {
                    id: FormQuestionId::new(),
                    column: column.id,
                    help_text: String::new(),
                    required: false,
                    widget: None,
                }],
            },
            FormSection::Gate {
                id: FormSectionId::new(),
                title: String::new(),
                description: String::new(),
                rules: FilterGroup {
                    conjunction: models_databases::views::Conjunction::And,
                    conditions: vec![],
                },
                message: String::new(),
            },
        ],
    };
    assert!(
        canonical_preserving(
            &previous,
            std::slice::from_ref(&column),
            &[],
            Audience::Members,
            Some(&previous)
        )
        .is_ok()
    );
    let mut changed = previous.clone();
    let FormSection::Questions { questions, .. } = &mut changed.sections[0] else {
        panic!("questions")
    };
    questions[0].id = FormQuestionId::new();
    assert_eq!(
        canonical_preserving(
            &changed,
            std::slice::from_ref(&column),
            &[],
            Audience::Members,
            Some(&previous)
        )
        .unwrap_err()
        .code,
        Code::ReferencePickerUnavailable
    );
    let mut changed = previous.clone();
    let FormSection::Gate { id, .. } = &mut changed.sections[1] else {
        panic!("gate")
    };
    *id = FormSectionId::new();
    assert_eq!(
        canonical_preserving(
            &changed,
            std::slice::from_ref(&column),
            &[],
            Audience::Members,
            Some(&previous)
        )
        .unwrap_err()
        .code,
        Code::EmptyScreeningGroup
    );
    let condition = FilterNode::Condition(models_databases::views::FilterCondition {
        column: column.id,
        test: models_databases::views::FilterTest::Presence {
            operator: models_databases::views::PresenceOperator::IsEmpty,
        },
    });
    let mut crowded = previous.clone();
    let FormSection::Gate { rules, .. } = &mut crowded.sections[1] else {
        panic!("gate")
    };
    rules.conditions = vec![condition.clone(); 190];
    let mut more = crowded.clone();
    more.sections.push(FormSection::Gate {
        id: FormSectionId::new(),
        title: String::new(),
        description: String::new(),
        rules: FilterGroup {
            conjunction: models_databases::views::Conjunction::And,
            conditions: vec![condition; 20],
        },
        message: String::new(),
    });
    assert_eq!(
        canonical_preserving(
            &more,
            std::slice::from_ref(&column),
            &[],
            Audience::Members,
            Some(&crowded)
        )
        .unwrap_err()
        .code,
        Code::TooManyConditions
    );
    assert!(
        canonical_preserving(&more, &[column], &[], Audience::Members, Some(&more)).is_ok(),
        "an existing over-limit layout can still be shared or restricted"
    );
}
