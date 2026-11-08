use super::*;
use databases_types::ColumnId;
use models_forms::{FormQuestionId, FormSectionId};

#[test]
fn help_text_edit_changes_only_requested_fields_in_the_current_layout() {
    let question = FormQuestionId::generate();
    let base = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::generate(),
            title: "Team".into(),
            description: String::new(),
            questions: vec![QuestionLayout {
                id: question,
                column: ColumnId::generate(),
                help_text: "People".into(),
                required: false,
                widget: None,
            }],
            show_when: None,
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
    let merged = apply(&latest, &changes).unwrap();
    let FormSection::Questions { questions, .. } = &merged.sections[0] else {
        panic!("questions")
    };
    assert!(questions[0].required);
    assert_eq!(questions[0].help_text, "Full-time and part-time");
    let FormSection::Questions { questions, .. } = &mut latest.sections[0] else {
        panic!("questions")
    };
    questions[0].help_text = "Human text".into();
    let edited = apply(&latest, &changes).unwrap();
    let FormSection::Questions { questions, .. } = &edited.sections[0] else {
        panic!("questions")
    };
    assert_eq!(questions[0].help_text, "Full-time and part-time");
    assert!(questions[0].required);
}

#[test]
fn a_batch_can_move_then_edit_a_question_without_losing_either_change() {
    let question = FormQuestionId::generate();
    let first = FormSectionId::generate();
    let second = FormSectionId::generate();
    let base = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: first,
                title: String::new(),
                description: String::new(),
                questions: vec![QuestionLayout {
                    id: question,
                    column: ColumnId::generate(),
                    help_text: String::new(),
                    required: false,
                    widget: None,
                }],
                show_when: None,
            },
            FormSection::Questions {
                id: second,
                title: String::new(),
                description: String::new(),
                questions: vec![],
                show_when: None,
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
    let next = apply(&base, &changes).expect("ordered batch keeps its own earlier moves");
    let FormSection::Questions { questions, .. } = &next.sections[1] else {
        panic!("questions")
    };
    assert_eq!(questions[0].id, question);
    assert_eq!(questions[0].help_text, "Moved safely");
}

#[test]
fn a_batch_can_add_then_edit_a_question() {
    let section = FormSectionId::generate();
    let question = FormQuestionId::generate();
    let base = FormLayout {
        sections: vec![FormSection::Questions {
            id: section,
            title: String::new(),
            description: String::new(),
            questions: vec![],
            show_when: None,
        }],
    };
    let changes = vec![
        Change::AddQuestion {
            section_id: section,
            question: QuestionLayout {
                id: question,
                column: ColumnId::generate(),
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
    let next = apply(&base, &changes)
        .expect("later operations can target identities added by the same batch");
    let FormSection::Questions { questions, .. } = &next.sections[0] else {
        panic!("questions")
    };
    assert!(questions[0].required);
}

#[test]
fn show_when_is_set_kept_by_unrelated_edits_cleared_by_null_and_only_on_questions_sections() {
    use databases_types::views::{
        Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, PresenceOperator,
    };
    let first = FormSectionId::generate();
    let second = FormSectionId::generate();
    let gate = FormSectionId::generate();
    let column = ColumnId::generate();
    let rules = FilterGroup {
        conjunction: Conjunction::And,
        conditions: vec![FilterNode::Condition(FilterCondition {
            column,
            test: FilterTest::Presence {
                operator: PresenceOperator::IsNotEmpty,
            },
        })],
    };
    let base = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: first,
                title: "About you".into(),
                description: String::new(),
                questions: vec![QuestionLayout {
                    id: FormQuestionId::generate(),
                    column,
                    help_text: String::new(),
                    required: false,
                    widget: None,
                }],
                show_when: None,
            },
            FormSection::Questions {
                id: second,
                title: "Follow-up".into(),
                description: String::new(),
                questions: vec![],
                show_when: None,
            },
            FormSection::Gate {
                id: gate,
                title: String::new(),
                description: String::new(),
                rules: rules.clone(),
                message: "No".into(),
            },
        ],
    };

    let set = apply(
        &base,
        &[
            Change::SetShowWhen {
                section_id: second,
                show_when: Some(rules.clone()),
            },
            Change::SetSectionText {
                section_id: second,
                title: Some("More".into()),
                description: None,
                message: None,
            },
        ],
    )
    .unwrap();

    assert_eq!(
        set.sections[1],
        FormSection::Questions {
            id: second,
            title: "More".into(),
            description: String::new(),
            questions: vec![],
            show_when: Some(rules.clone()),
        }
    );
    let cleared = apply(
        &set,
        &[Change::SetShowWhen {
            section_id: second,
            show_when: None,
        }],
    )
    .unwrap();
    assert_eq!(
        cleared.sections[1],
        FormSection::Questions {
            id: second,
            title: "More".into(),
            description: String::new(),
            questions: vec![],
            show_when: None,
        }
    );
    assert_eq!(
        apply(
            &base,
            &[Change::SetShowWhen {
                section_id: gate,
                show_when: Some(rules),
            }],
        )
        .unwrap_err()
        .code,
        Code::InvalidEdit
    );
}
