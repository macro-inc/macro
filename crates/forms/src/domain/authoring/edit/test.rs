use super::*;
use models_forms::{FormQuestionId, FormSectionId};

#[test]
fn help_text_edit_preserves_a_simultaneous_required_change_and_refuses_same_field() {
    let question = FormQuestionId::new();
    let base = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::new(),
            title: "Team".into(),
            description: String::new(),
            questions: vec![QuestionLayout {
                id: question,
                column: ColumnId::new(),
                help_text: "People".into(),
                required: false,
                widget: None,
            }],
        }],
    };
    let mut latest = base.clone();
    let FormSection::Questions { questions, .. } = &mut latest.sections[0] else {
        panic!("questions")
    };
    questions[0].required = true;
    let changes = vec![Change::SetQuestion {
        question_id: question,
        help_text: Some("Full-time and part-time".into()),
        required: None,
        widget: None,
    }];
    let merged = apply(&base, &latest, &changes).unwrap();
    let FormSection::Questions { questions, .. } = &merged.sections[0] else {
        panic!("questions")
    };
    assert!(questions[0].required);
    assert_eq!(questions[0].help_text, "Full-time and part-time");
    let FormSection::Questions { questions, .. } = &mut latest.sections[0] else {
        panic!("questions")
    };
    questions[0].help_text = "Human text".into();
    assert!(
        apply(&base, &latest, &changes)
            .unwrap_err()
            .to_string()
            .contains("ConcurrentFieldChange")
    );
}

#[test]
fn a_batch_can_move_then_edit_a_question_without_losing_either_change() {
    let question = FormQuestionId::new();
    let first = FormSectionId::new();
    let second = FormSectionId::new();
    let base = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: first,
                title: String::new(),
                description: String::new(),
                questions: vec![QuestionLayout {
                    id: question,
                    column: ColumnId::new(),
                    help_text: String::new(),
                    required: false,
                    widget: None,
                }],
            },
            FormSection::Questions {
                id: second,
                title: String::new(),
                description: String::new(),
                questions: vec![],
            },
        ],
    };
    let changes = vec![
        Change::MoveQuestion {
            question_id: question,
            section_id: second,
            after: None,
        },
        Change::SetQuestion {
            question_id: question,
            help_text: Some("Moved safely".into()),
            required: None,
            widget: None,
        },
    ];
    let next = apply(&base, &base, &changes).expect("ordered batch keeps its own earlier moves");
    let FormSection::Questions { questions, .. } = &next.sections[1] else {
        panic!("questions")
    };
    assert_eq!(questions[0].id, question);
    assert_eq!(questions[0].help_text, "Moved safely");
}

#[test]
fn a_batch_can_add_then_edit_a_question() {
    let section = FormSectionId::new();
    let question = FormQuestionId::new();
    let base = FormLayout {
        sections: vec![FormSection::Questions {
            id: section,
            title: String::new(),
            description: String::new(),
            questions: vec![],
        }],
    };
    let changes = vec![
        Change::AddQuestion {
            section_id: section,
            question: QuestionLayout {
                id: question,
                column: ColumnId::new(),
                help_text: String::new(),
                required: false,
                widget: None,
            },
            after: None,
        },
        Change::SetQuestion {
            question_id: question,
            help_text: None,
            required: Some(true),
            widget: None,
        },
    ];
    let next = apply(&base, &base, &changes)
        .expect("later operations can target identities added by the same batch");
    let FormSection::Questions { questions, .. } = &next.sections[0] else {
        panic!("questions")
    };
    assert!(questions[0].required);
}

#[test]
fn deleting_a_question_refuses_a_concurrent_new_reference() {
    let question = FormQuestionId::new();
    let column = ColumnId::new();
    let base = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::new(),
            title: String::new(),
            description: String::new(),
            questions: vec![QuestionLayout {
                id: question,
                column,
                help_text: String::new(),
                required: false,
                widget: None,
            }],
        }],
    };
    let mut latest = base.clone();
    latest.sections.push(FormSection::Gate {
        id: FormSectionId::new(),
        title: String::new(),
        description: String::new(),
        message: "Required".into(),
        rules: models_databases::views::FilterGroup {
            conjunction: models_databases::views::Conjunction::And,
            conditions: vec![models_databases::views::FilterNode::Condition(
                models_databases::views::FilterCondition {
                    column,
                    test: models_databases::views::FilterTest::Presence {
                        operator: models_databases::views::PresenceOperator::IsNotEmpty,
                    },
                },
            )],
        },
    });
    assert!(
        apply(
            &base,
            &latest,
            &[Change::RemoveQuestion {
                question_id: question
            }]
        )
        .is_err(),
        "a human's new screener cannot be silently stranded"
    );
}
