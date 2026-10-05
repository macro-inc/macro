use loro::{ExportMode, LoroDoc, LoroMap, LoroMovableList, LoroText};
use models_databases::ColumnId;
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, TextOperator,
};
use models_forms::{
    FormLayout, FormQuestionId, FormSection, FormSectionId, QuestionLayout, Widget,
};
use uuid::uuid;

use super::*;

const CONTACT: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000001"));
const SCREENING: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000002"));
const DETAILS: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000003"));
const NAME: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000011"));
const EMAIL: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000012"));
const PHONE: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000013"));
const ADDRESS: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000014"));
const NAME_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000021"));
const EMAIL_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000022"));
const PHONE_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000023"));
const ADDRESS_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000024"));

/// The layout both cross-language fixtures hold.
fn fixture_layout() -> FormLayout {
    FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact".to_owned(),
                description: "How we reach you".to_owned(),
                questions: vec![
                    QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your full name".to_owned(),
                        required: true,
                        widget: Some(Widget::Short),
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
            FormSection::Gate {
                id: SCREENING,
                title: "Screening".to_owned(),
                description: String::new(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition {
                        column: NAME_COLUMN,
                        test: FilterTest::Text {
                            operator: TextOperator::Is,
                            value: "Ada".to_owned(),
                        },
                    })],
                },
                message: "Only Ada may continue".to_owned(),
            },
            FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            },
        ],
    }
}

/// Two question sections, the starting point of every concurrency test.
fn shared_layout() -> FormLayout {
    FormLayout {
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
}

/// The layout after importing `updates` into `snapshot` in order.
fn merge(snapshot: &[u8], updates: &[&[u8]]) -> FormLayout {
    let document = LoroDoc::from_snapshot(snapshot).unwrap();
    for update in updates {
        document.import(update).unwrap();
    }
    let merged = document.export(ExportMode::Snapshot).unwrap();
    read_layout(&merged).unwrap().layout
}

#[test]
fn seeding_then_reading_returns_the_layout() {
    let snapshot = seed_layout(&fixture_layout()).unwrap();

    let decoded = read_layout(&snapshot).unwrap();

    assert_eq!(decoded.layout, fixture_layout());
    assert!(!decoded.revision.is_empty());
}

#[test]
fn a_booking_target_survives_seeding_and_an_independent_title_edit() {
    let layout = FormLayout {
        sections: vec![FormSection::Booking {
            id: DETAILS,
            title: "Book a time".to_owned(),
            description: "Choose a time after screening".to_owned(),
            target: models_forms::BookingTarget {
                profile_id: models_forms::BookingProfileId::from_uuid(uuid!(
                    "0199a000-0000-7000-8000-000000000031"
                )),
                event_type_id: models_forms::BookingEventTypeId::from_uuid(uuid!(
                    "0199a000-0000-7000-8000-000000000032"
                )),
            },
        }],
    };
    let snapshot = seed_layout(&layout).unwrap();
    assert_eq!(read_layout(&snapshot).unwrap().layout, layout);

    let mut renamed = layout.clone();
    let FormSection::Booking { title, .. } = &mut renamed.sections[0] else {
        panic!("expected the booking step");
    };
    *title = "Meet the team".to_owned();
    let replacement = replace_layout(&snapshot, &renamed).unwrap();

    assert_eq!(merge(&snapshot, &[&replacement.update]), renamed);
}

#[test]
fn seeding_stores_the_shared_schema() {
    let snapshot = seed_layout(&fixture_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();

    assert_eq!(
        serde_json::to_value(document.get_map("metadata").get_deep_value()).unwrap(),
        serde_json::json!({ "format": 1 })
    );
    assert_eq!(
        serde_json::to_value(document.get_movable_list("sectionOrder").get_deep_value()).unwrap(),
        serde_json::json!([CONTACT, SCREENING, DETAILS])
    );
    assert_eq!(
        serde_json::to_value(document.get_map("questionOrders").get_deep_value()).unwrap(),
        serde_json::json!({ CONTACT.as_uuid().to_string(): [NAME, EMAIL], DETAILS.as_uuid().to_string(): [] })
    );
    let sections = document.get_map("sections");
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(gate))) =
        sections.get(&SCREENING.as_uuid().to_string())
    else {
        panic!("the gate is not a map");
    };
    assert!(matches!(
        gate.get("message"),
        Some(loro::ValueOrContainer::Container(loro::Container::Text(_)))
    ));
    let Some(loro::ValueOrContainer::Value(rules)) = gate.get("rules") else {
        panic!("the rules are not a value");
    };
    let rules: serde_json::Value =
        serde_json::from_str(rules.as_string().unwrap().as_str()).unwrap();
    assert_eq!(rules["conjunction"], "and");
    assert_eq!(
        serde_json::to_value(document.get_map("questions").get_deep_value()).unwrap()
            [NAME.as_uuid().to_string()],
        serde_json::json!({
            "sectionId": CONTACT,
            "column": NAME_COLUMN,
            "helpText": "Your full name",
            "required": true,
            "widget": "short",
        })
    );
}

#[test]
fn seeding_refuses_a_section_named_twice() {
    let layout = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact".to_owned(),
                description: String::new(),
                questions: vec![],
            },
            FormSection::Questions {
                id: CONTACT,
                title: "Again".to_owned(),
                description: String::new(),
                questions: vec![],
            },
        ],
    };

    let error = seed_layout(&layout).unwrap_err();

    assert!(matches!(error, LayoutDraftError::DuplicateSection(id) if id == CONTACT));
}

#[test]
fn seeding_refuses_a_question_named_twice() {
    let layout = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact".to_owned(),
                description: String::new(),
                questions: vec![QuestionLayout {
                    id: NAME,
                    column: NAME_COLUMN,
                    help_text: String::new(),
                    required: false,
                    widget: None,
                }],
            },
            FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![QuestionLayout {
                    id: NAME,
                    column: EMAIL_COLUMN,
                    help_text: String::new(),
                    required: false,
                    widget: None,
                }],
            },
        ],
    };

    let error = seed_layout(&layout).unwrap_err();

    assert!(matches!(error, LayoutDraftError::DuplicateQuestion(id) if id == NAME));
}

#[test]
fn replacing_writes_only_what_changed() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let before = read_layout(&snapshot).unwrap();
    let edited = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact details".to_owned(),
                description: String::new(),
                questions: vec![
                    QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your name".to_owned(),
                        required: true,
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
    };

    let replacement = replace_layout(&snapshot, &edited).unwrap();

    assert_eq!(replacement.expected_revision, before.revision);
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let changed_containers = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorder = changed_containers.clone();
    let _subscription = document.subscribe_root(std::sync::Arc::new(move |event| {
        for container in event.events {
            recorder.lock().unwrap().push(container.target.to_string());
        }
    }));
    document.import(&replacement.update).unwrap();
    assert_eq!(
        read_layout(&document.export(ExportMode::Snapshot).unwrap())
            .unwrap()
            .layout,
        edited
    );
    let changed_containers = changed_containers.lock().unwrap();
    assert_eq!(changed_containers.len(), 2, "{changed_containers:?}");
}

#[test]
fn replacing_with_the_same_layout_changes_nothing() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let before = read_layout(&snapshot).unwrap();

    let replacement = replace_layout(&snapshot, &shared_layout()).unwrap();

    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.import(&replacement.update).unwrap();
    let after = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap();
    assert_eq!(after, before);
}

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

#[test]
fn replacing_keeps_section_fields_the_layout_does_not_model() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(contact))) = document
        .get_map("sections")
        .get(&CONTACT.as_uuid().to_string())
    else {
        panic!("the contact section is not a map");
    };
    contact.insert("theme", r#"{"accent":"teal"}"#).unwrap();
    document.commit();
    let with_theme = document.export(ExportMode::Snapshot).unwrap();
    assert_eq!(read_layout(&with_theme).unwrap().layout, shared_layout());

    let renamed = replace_layout(
        &with_theme,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Renamed".to_owned(),
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
    document.import(&renamed.update).unwrap();

    assert_eq!(
        serde_json::to_value(contact.get_deep_value()).unwrap()["theme"],
        r#"{"accent":"teal"}"#
    );
    assert_eq!(
        serde_json::to_value(contact.get_deep_value()).unwrap()["title"],
        "Renamed"
    );
}

#[test]
fn reading_refuses_a_document_over_the_size_limit() {
    let oversized = vec![0_u8; MAXIMUM_DOCUMENT_BYTES + 1];

    let error = read_layout(&oversized).unwrap_err();

    assert!(matches!(
        error,
        LayoutDraftError::TooLarge { length, maximum }
            if length == MAXIMUM_DOCUMENT_BYTES + 1 && maximum == MAXIMUM_DOCUMENT_BYTES
    ));
}

#[test]
fn reading_refuses_bytes_that_are_not_loro() {
    assert!(matches!(
        read_layout(b"not a loro document").unwrap_err(),
        LayoutDraftError::Decode(_)
    ));
    assert!(matches!(
        read_layout(&[]).unwrap_err(),
        LayoutDraftError::Decode(_)
    ));
}

#[test]
fn reading_refuses_a_truncated_or_corrupted_snapshot() {
    let snapshot = seed_layout(&fixture_layout()).unwrap();

    let truncated = &snapshot[..snapshot.len() / 2];
    assert!(matches!(
        read_layout(truncated).unwrap_err(),
        LayoutDraftError::Decode(_)
    ));

    let mut corrupted = snapshot.clone();
    let middle = corrupted.len() / 2;
    corrupted[middle] ^= 0xff;
    assert!(matches!(
        read_layout(&corrupted).unwrap_err(),
        LayoutDraftError::Decode(_)
    ));
}

#[test]
fn reading_refuses_an_update_missing_its_history() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let replacement = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            }],
        },
    )
    .unwrap();

    let error = read_layout(&replacement.update).unwrap_err();

    assert!(matches!(error, LayoutDraftError::IncompleteHistory));
}

#[test]
fn reading_refuses_a_document_without_a_format() {
    let document = LoroDoc::new();
    document.get_movable_list("sectionOrder");
    document
        .get_map("sections")
        .insert("unrelated", true)
        .unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(matches!(error, LayoutDraftError::MissingFormat));
}

#[test]
fn reading_refuses_an_unknown_format() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.get_map("metadata").insert("format", 2).unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(matches!(error, LayoutDraftError::UnsupportedFormat(format) if format == "2"));
}

#[test]
fn reading_refuses_a_title_stored_as_a_plain_string() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(contact))) = document
        .get_map("sections")
        .get(&CONTACT.as_uuid().to_string())
    else {
        panic!("the contact section is not a map");
    };
    contact.insert("title", "plain").unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(matches!(
        error,
        LayoutDraftError::Malformed { location, expected: "text" }
            if location == format!("sections.{}.title", CONTACT.as_uuid())
    ));
}

#[test]
fn reading_refuses_rules_that_are_not_json() {
    let snapshot = seed_layout(&fixture_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(gate))) = document
        .get_map("sections")
        .get(&SCREENING.as_uuid().to_string())
    else {
        panic!("the gate is not a map");
    };
    gate.insert("rules", "{ not json").unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(matches!(
        error,
        LayoutDraftError::InvalidJson { location, .. }
            if location == format!("sections.{}.rules", SCREENING.as_uuid())
    ));
}

#[test]
fn reading_refuses_a_question_field_of_the_wrong_type() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(name))) = document
        .get_map("questions")
        .get(&NAME.as_uuid().to_string())
    else {
        panic!("the name question is not a map");
    };
    name.insert("required", "yes").unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(
        matches!(error, LayoutDraftError::InvalidSection { .. }),
        "{error:?}"
    );
}

#[test]
fn reading_refuses_an_unknown_section_kind() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(details))) = document
        .get_map("sections")
        .get(&DETAILS.as_uuid().to_string())
    else {
        panic!("the details section is not a map");
    };
    details.insert("kind", "survey").unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(matches!(
        error,
        LayoutDraftError::InvalidSection { section, .. } if section == DETAILS.as_uuid().to_string()
    ));
}

#[test]
fn reading_refuses_an_order_entry_that_is_not_an_id() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.get_movable_list("sectionOrder").push(7).unwrap();
    document.commit();

    let error = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap_err();

    assert!(matches!(
        error,
        LayoutDraftError::Malformed { location, expected: "a section id" } if location == "sectionOrder.2"
    ));
}

#[test]
fn reading_skips_repeated_and_dangling_order_entries() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let section_order = document.get_movable_list("sectionOrder");
    section_order
        .insert(0, DETAILS.as_uuid().to_string())
        .unwrap();
    section_order
        .push("0199a000-0000-7000-8000-0000000000ff")
        .unwrap();
    document.commit();

    let layout = read_layout(&document.export(ExportMode::Snapshot).unwrap())
        .unwrap()
        .layout;

    let order: Vec<FormSectionId> = layout.sections.iter().map(FormSection::id).collect();
    assert_eq!(order, [DETAILS, CONTACT]);
}

#[test]
fn a_newer_revision_includes_an_older_one() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let before = read_layout(&snapshot).unwrap();
    let replacement = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            }],
        },
    )
    .unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.import(&replacement.update).unwrap();
    let after = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap();

    assert!(revision_includes(&after.revision, &before.revision).unwrap());
    assert!(revision_includes(&after.revision, &after.revision).unwrap());
    assert!(!revision_includes(&before.revision, &after.revision).unwrap());
}

#[test]
fn concurrent_revisions_include_neither_other() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let only_details = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            }],
        },
    )
    .unwrap();
    let renamed_details = replace_layout(
        &snapshot,
        &FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
                FormSection::Questions {
                    id: DETAILS,
                    title: "More".to_owned(),
                    description: String::new(),
                    questions: vec![],
                },
            ],
        },
    )
    .unwrap();
    let first = LoroDoc::from_snapshot(&snapshot).unwrap();
    first.import(&only_details.update).unwrap();
    let first = read_layout(&first.export(ExportMode::Snapshot).unwrap()).unwrap();
    let second = LoroDoc::from_snapshot(&snapshot).unwrap();
    second.import(&renamed_details.update).unwrap();
    let second = read_layout(&second.export(ExportMode::Snapshot).unwrap()).unwrap();

    assert!(!revision_includes(&first.revision, &second.revision).unwrap());
    assert!(!revision_includes(&second.revision, &first.revision).unwrap());
}

#[test]
fn a_revision_that_is_not_a_version_is_refused() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let revision = read_layout(&snapshot).unwrap().revision;

    let error = revision_includes(&[0xff, 0xff, 0xff], &revision).unwrap_err();

    assert!(matches!(error, LayoutDraftError::Revision(_)));
}

#[test]
fn reading_the_typescript_seeded_fixture_returns_the_layout() {
    let snapshot = include_bytes!("../../../fixtures/collaboration/typescript-seeded.loro");

    let decoded = read_layout(snapshot).unwrap();

    assert_eq!(decoded.layout, fixture_layout());
}

#[test]
fn the_rust_seeded_fixture_is_current() {
    let snapshot = include_bytes!("../../../fixtures/collaboration/rust-seeded.loro");

    assert_eq!(read_layout(snapshot).unwrap().layout, fixture_layout());
}

/// Rewrites the Rust-seeded fixture the TypeScript codec reads. Run by hand:
/// `cargo test -p forms --features ports write_rust_seeded_fixture -- --ignored`.
#[test]
#[ignore = "rewrites a checked-in fixture"]
fn write_rust_seeded_fixture() {
    let snapshot = seed_layout(&fixture_layout()).unwrap();
    std::fs::write(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/collaboration/rust-seeded.loro"
        ),
        snapshot,
    )
    .unwrap();
}

#[test]
fn texts_and_movable_lists_are_the_container_types() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();

    let question_orders: LoroMap = document.get_map("questionOrders");
    assert!(matches!(
        question_orders.get(&DETAILS.as_uuid().to_string()),
        Some(loro::ValueOrContainer::Container(
            loro::Container::MovableList(_)
        ))
    ));
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(name))) = document
        .get_map("questions")
        .get(&NAME.as_uuid().to_string())
    else {
        panic!("the name question is not a map");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::Text(help_text))) =
        name.get("helpText")
    else {
        panic!("the help text is not text");
    };
    let _: (LoroText, LoroMovableList) = (help_text, document.get_movable_list("sectionOrder"));
}
