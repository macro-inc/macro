use super::*;

#[test]
fn concurrent_edits_of_different_fields_and_the_same_text_both_survive() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let renamed = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact form".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your name".to_owned(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();
    let required = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Our contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your legal name".to_owned(),
                            required: true,
                            widget: None,
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();

    let renamed_first = merge(&snapshot, &[&renamed.update, &required.update]);
    let required_first = merge(&snapshot, &[&required.update, &renamed.update]);

    assert_eq!(renamed_first, required_first);
    assert_eq!(
        renamed_first,
        FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Our contact form".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your legal name".to_owned(),
                            required: true,
                            widget: None,
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        }
    );
}

#[test]
fn questions_inserted_into_the_same_slot_both_survive() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let with_address = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your name".to_owned(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: ADDRESS,
                            column: ADDRESS_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();
    let other_question = FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000015"));
    let with_other = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your name".to_owned(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: other_question,
                            column: ADDRESS_COLUMN,
                            help_text: "Another".to_owned(),
                            required: true,
                            widget: None,
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();

    let address_first = merge(&snapshot, &[&with_address.update, &with_other.update]);
    let other_first = merge(&snapshot, &[&with_other.update, &with_address.update]);

    assert_eq!(address_first, other_first);
    let FormSection::Questions { questions, .. } = &address_first.sections[0] else {
        panic!("the first section is not a questions section");
    };
    let order: Vec<FormQuestionId> = questions.iter().map(|question| question.id).collect();
    assert_eq!(order.len(), 5);
    assert_eq!(order[0], NAME);
    assert!(order[1..3].contains(&ADDRESS));
    assert!(order[1..3].contains(&other_question));
    assert_eq!(order[3..], [EMAIL, PHONE]);
}

#[test]
fn a_question_moved_across_sections_keeps_a_concurrent_edit() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let moved = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your name".to_owned(),
                        required: false,
                        widget: None,
                    }],
                },
            ],
        },
    )
    .unwrap();
    let edited = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your full name".to_owned(),
                            required: true,
                            widget: None,
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();

    let moved_first = merge(&snapshot, &[&moved.update, &edited.update]);
    let edited_first = merge(&snapshot, &[&edited.update, &moved.update]);

    assert_eq!(moved_first, edited_first);
    assert_eq!(
        moved_first,
        FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your full name".to_owned(),
                        required: true,
                        widget: None,
                    }],
                },
            ],
        }
    );
}

#[test]
fn a_question_reordered_within_its_section_keeps_a_concurrent_edit() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let reordered = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your name".to_owned(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();
    let edited = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your name, please".to_owned(),
                            required: false,
                            widget: Some(Widget::Paragraph),
                        },
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();

    let reordered_first = merge(&snapshot, &[&reordered.update, &edited.update]);
    let edited_first = merge(&snapshot, &[&edited.update, &reordered.update]);

    assert_eq!(reordered_first, edited_first);
    assert_eq!(
        reordered_first,
        FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![
                        QuestionLayout {
                            id: EMAIL,
                            column: EMAIL_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: PHONE,
                            column: PHONE_COLUMN,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        },
                        QuestionLayout {
                            id: NAME,
                            column: NAME_COLUMN,
                            help_text: "Your name, please".to_owned(),
                            required: false,
                            widget: Some(Widget::Paragraph),
                        },
                    ],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        }
    );
}

#[test]
fn the_same_reorder_made_twice_concurrently_moves_rather_than_duplicates() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let reordered = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact".to_owned(),
                description: String::new(),
                questions: vec![
                    QuestionLayout {
                        id: PHONE,
                        column: PHONE_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    },
                    QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your name".to_owned(),
                        required: false,
                        widget: None,
                    },
                    QuestionLayout {
                        id: EMAIL,
                        column: EMAIL_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    },
                ],
            },
            FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            },
        ],
    };
    let first = replace_layout(&snapshot, &reordered).unwrap();
    let second = replace_layout(&snapshot, &reordered).unwrap();

    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.import(&first.update).unwrap();
    document.import(&second.update).unwrap();

    let Some(loro::ValueOrContainer::Container(loro::Container::MovableList(order))) = document
        .get_map("questionOrders")
        .get(&CONTACT.as_uuid().to_string())
    else {
        panic!("the contact order is not a movable list");
    };
    assert_eq!(
        serde_json::to_value(order.get_deep_value()).unwrap(),
        serde_json::json!([PHONE, NAME, EMAIL])
    );
    assert_eq!(
        read_layout(&document.export(ExportMode::Snapshot).unwrap())
            .unwrap()
            .layout,
        reordered
    );
}
