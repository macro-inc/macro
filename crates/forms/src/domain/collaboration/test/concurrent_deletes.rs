use super::*;

#[test]
fn a_deleted_question_stays_deleted_when_moved_concurrently() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let deleted = replace_layout(
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
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();
    let moved_across = replace_layout(
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
                        help_text: "Moved".to_owned(),
                        required: true,
                        widget: None,
                    }],
                },
            ],
        },
    )
    .unwrap();
    let reordered_within = replace_layout(
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

    let expected = FormLayout {
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
                questions: vec![],
            },
        ],
    };
    assert_eq!(
        merge(
            &snapshot,
            &[
                &deleted.update,
                &moved_across.update,
                &reordered_within.update
            ]
        ),
        expected
    );
    assert_eq!(
        merge(
            &snapshot,
            &[
                &reordered_within.update,
                &moved_across.update,
                &deleted.update
            ]
        ),
        expected
    );
}

#[test]
fn a_deleted_section_stays_deleted_when_reordered_concurrently() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let deleted = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![FormSection::Questions {
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
            }],
        },
    )
    .unwrap();
    let reordered = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: DETAILS,
                    title: "Details first".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
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
            ],
        },
    )
    .unwrap();

    let deleted_first = merge(&snapshot, &[&deleted.update, &reordered.update]);
    let reordered_first = merge(&snapshot, &[&reordered.update, &deleted.update]);

    assert_eq!(deleted_first, reordered_first);
    assert_eq!(
        deleted_first,
        FormLayout {
            sections: vec![FormSection::Questions {
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
            }],
        }
    );
}

#[test]
fn a_question_moved_into_a_concurrently_deleted_section_is_left_out() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let details_deleted = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![FormSection::Questions {
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
            }],
        },
    )
    .unwrap();
    let moved_into_details = replace_layout(
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
                    questions: vec![QuestionLayout {
                        id: PHONE,
                        column: PHONE_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    }],
                },
            ],
        },
    )
    .unwrap();

    let deleted_first = merge(
        &snapshot,
        &[&details_deleted.update, &moved_into_details.update],
    );
    let moved_first = merge(
        &snapshot,
        &[&moved_into_details.update, &details_deleted.update],
    );

    assert_eq!(deleted_first, moved_first);
    assert_eq!(
        deleted_first,
        FormLayout {
            sections: vec![FormSection::Questions {
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
                        id: EMAIL,
                        column: EMAIL_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    },
                ],
            }],
        }
    );
}
