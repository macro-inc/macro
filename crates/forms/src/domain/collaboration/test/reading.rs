use super::*;

#[test]
fn revision_equality_ignores_encoded_peer_order() {
    // Loro encodes a map: two byte orders can describe the same version.
    let first = [2, 1, 3, 2, 4];
    let reordered = [2, 2, 4, 1, 3];
    let advanced = [2, 1, 4, 2, 4];
    assert!(revision_matches(&first, &reordered).unwrap());
    assert!(!revision_matches(&first, &advanced).unwrap());
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
