use models_forms::{BookingEventTypeId, BookingProfileId, BookingTarget};

use super::*;

const BOOKING: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000004"));
const PROFILE: BookingProfileId =
    BookingProfileId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000031"));
const INTRO_CALL: BookingEventTypeId =
    BookingEventTypeId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000032"));

fn section_map(document: &LoroDoc, id: FormSectionId) -> LoroMap {
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) =
        document.get_map(SECTIONS).get(&id.as_uuid().to_string())
    else {
        panic!("section {id:?} is not a map");
    };
    map
}

/// The repaired layout, with `NAME` required and `DETAILS` retitled.
fn repaired_layout() -> FormLayout {
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
                title: "More details".to_owned(),
                description: String::new(),
                questions: vec![],
            },
        ],
    }
}

#[test]
fn replacing_repairs_a_question_field_of_the_wrong_type_in_the_same_history() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(name))) =
        document.get_map(QUESTIONS).get(&NAME.as_uuid().to_string())
    else {
        panic!("the name question is not a map");
    };
    name.insert("required", "yes").unwrap();
    document.commit();
    let broken = document.export(ExportMode::Snapshot).unwrap();
    assert!(read_layout(&broken).is_err());

    let repair = replace_layout(&broken, &repaired_layout()).unwrap();

    assert_eq!(
        VersionVector::decode(&repair.expected_revision).unwrap(),
        document.oplog_vv()
    );
    assert_eq!(merge(&broken, &[&repair.update]), repaired_layout());
}

#[test]
fn replacing_repairs_an_unknown_section_kind_kept_or_dropped() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    section_map(&document, DETAILS)
        .insert(KIND, "survey")
        .unwrap();
    document.commit();
    let broken = document.export(ExportMode::Snapshot).unwrap();
    assert!(read_layout(&broken).is_err());

    let kept = replace_layout(&broken, &repaired_layout()).unwrap();
    let mut without_details = repaired_layout();
    without_details.sections.truncate(1);
    let dropped = replace_layout(&broken, &without_details).unwrap();

    assert_eq!(merge(&broken, &[&kept.update]), repaired_layout());
    assert_eq!(merge(&broken, &[&dropped.update]), without_details);
}

#[test]
fn replacing_repairs_a_malformed_booking_target() {
    let booking = FormSection::Booking {
        id: BOOKING,
        title: "Book a call".to_owned(),
        description: String::new(),
        target: BookingTarget {
            profile_id: PROFILE,
            event_type_id: INTRO_CALL,
        },
    };
    let mut with_booking = shared_layout();
    with_booking.sections.push(booking.clone());
    let snapshot = seed_layout(&with_booking).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    section_map(&document, BOOKING)
        .insert("target", r#"{"profileId":5}"#)
        .unwrap();
    document.commit();
    let broken = document.export(ExportMode::Snapshot).unwrap();
    assert!(read_layout(&broken).is_err());

    let mut requested = repaired_layout();
    requested.sections.push(booking);
    let repair = replace_layout(&broken, &requested).unwrap();

    assert_eq!(merge(&broken, &[&repair.update]), requested);
}

#[test]
fn replacing_repairs_an_unknown_format() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.get_map(METADATA).insert(FORMAT_KEY, 2).unwrap();
    document.commit();
    let broken = document.export(ExportMode::Snapshot).unwrap();
    assert!(matches!(
        read_layout(&broken),
        Err(LayoutDraftError::UnsupportedFormat(format)) if format == "2"
    ));

    let repair = replace_layout(&broken, &repaired_layout()).unwrap();

    assert_eq!(
        VersionVector::decode(&repair.expected_revision).unwrap(),
        document.oplog_vv()
    );
    assert_eq!(merge(&broken, &[&repair.update]), repaired_layout());
}

#[test]
fn replacing_repairs_an_order_entry_that_is_not_an_id() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document
        .get_movable_list(SECTION_ORDER)
        .insert(0, 7)
        .unwrap();
    document.commit();
    let broken = document.export(ExportMode::Snapshot).unwrap();
    assert!(read_layout(&broken).is_err());

    let repair = replace_layout(&broken, &repaired_layout()).unwrap();

    assert_eq!(merge(&broken, &[&repair.update]), repaired_layout());
}

#[test]
fn a_repair_keeps_a_concurrent_edit_to_a_readable_section() {
    let snapshot = seed_layout(&shared_layout()).unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    section_map(&document, DETAILS)
        .insert(KIND, "survey")
        .unwrap();
    document.commit();
    let broken = document.export(ExportMode::Snapshot).unwrap();
    let peer = LoroDoc::from_snapshot(&broken).unwrap();
    let Some(loro::ValueOrContainer::Container(loro::Container::Text(title))) =
        section_map(&peer, CONTACT).get("title")
    else {
        panic!("the contact title is not text");
    };
    title.insert(7, " us").unwrap();
    peer.commit();
    let peer_edit = peer
        .export(ExportMode::updates(&document.oplog_vv()))
        .unwrap();

    let repair = replace_layout(&broken, &repaired_layout()).unwrap();

    let mut expected = repaired_layout();
    let FormSection::Questions { title, .. } = &mut expected.sections[0] else {
        panic!("the contact section holds questions");
    };
    "Contact us".clone_into(title);
    assert_eq!(merge(&broken, &[&repair.update, &peer_edit]), expected);
    assert_eq!(merge(&broken, &[&peer_edit, &repair.update]), expected);
}

#[test]
fn replacing_still_refuses_bytes_that_are_not_loro() {
    let error = replace_layout(b"not a loro document", &repaired_layout()).unwrap_err();

    assert!(matches!(error, LayoutDraftError::Decode(_)), "{error:?}");
}
