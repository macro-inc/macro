use super::*;

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
fn reading_the_typescript_seeded_fixture_returns_the_layout() {
    let snapshot = include_bytes!("../../../../fixtures/collaboration/typescript-seeded.loro");

    let decoded = read_layout(snapshot).unwrap();

    assert_eq!(decoded.layout, fixture_layout());
}

#[test]
fn the_rust_seeded_fixture_is_current() {
    let snapshot = include_bytes!("../../../../fixtures/collaboration/rust-seeded.loro");

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
