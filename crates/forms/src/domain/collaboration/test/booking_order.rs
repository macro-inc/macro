use models_forms::{BookingEventTypeId, BookingProfileId, BookingTarget};

use super::*;

const BOOKING: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000004"));
const SECOND_BOOKING: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000005"));
const TRAVEL: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000006"));
const PROFILE: BookingProfileId =
    BookingProfileId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000031"));
const INTRO_CALL: BookingEventTypeId =
    BookingEventTypeId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000032"));
const REVIEW_CALL: BookingEventTypeId =
    BookingEventTypeId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000033"));

fn contact() -> FormSection {
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
    }
}

fn details() -> FormSection {
    FormSection::Questions {
        id: DETAILS,
        title: "Details".to_owned(),
        description: String::new(),
        questions: vec![],
    }
}

fn travel() -> FormSection {
    FormSection::Questions {
        id: TRAVEL,
        title: "Travel".to_owned(),
        description: String::new(),
        questions: vec![],
    }
}

fn intro_booking() -> FormSection {
    FormSection::Booking {
        id: BOOKING,
        title: "Book a call".to_owned(),
        description: String::new(),
        target: BookingTarget {
            profile_id: PROFILE,
            event_type_id: INTRO_CALL,
        },
    }
}

fn review_booking() -> FormSection {
    FormSection::Booking {
        id: SECOND_BOOKING,
        title: "Book a review".to_owned(),
        description: String::new(),
        target: BookingTarget {
            profile_id: PROFILE,
            event_type_id: REVIEW_CALL,
        },
    }
}

/// The edit `replace_layout` makes, as the Loro peer `peer`, so concurrent
/// inserts merge in an order the test chooses.
fn replace_as(peer: u64, snapshot: &[u8], layout: &FormLayout) -> Vec<u8> {
    let document = load(snapshot).unwrap();
    document.set_peer_id(peer).unwrap();
    replace_in(document, layout).unwrap().update
}

fn stored_section_order(snapshot: &[u8], updates: &[&[u8]]) -> Vec<String> {
    let document = LoroDoc::from_snapshot(snapshot).unwrap();
    for update in updates {
        document.import(update).unwrap();
    }
    let order = document.get_movable_list(SECTION_ORDER);
    (0..order.len())
        .map(|index| match order.get(index) {
            Some(loro::ValueOrContainer::Value(loro::LoroValue::String(id))) => id.to_string(),
            other => panic!("order entry {index} is {other:?}"),
        })
        .collect()
}

#[test]
fn reading_puts_a_booking_step_stored_before_a_section_last() {
    let snapshot = seed_layout(&FormLayout {
        sections: vec![contact(), details(), intro_booking()],
    })
    .unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.get_movable_list(SECTION_ORDER).mov(2, 0).unwrap();
    document.commit();

    let decoded = read_layout(&document.export(ExportMode::Snapshot).unwrap()).unwrap();

    assert_eq!(
        decoded.layout,
        FormLayout {
            sections: vec![contact(), details(), intro_booking()],
        }
    );
}

#[test]
fn a_booking_step_added_beside_a_concurrent_section_stays_last() {
    let snapshot = seed_layout(&FormLayout {
        sections: vec![contact(), details()],
    })
    .unwrap();
    let mut booking_stored_before_travel = false;
    for (booking_peer, travel_peer) in [(1, 2), (2, 1)] {
        let booked = replace_as(
            booking_peer,
            &snapshot,
            &FormLayout {
                sections: vec![contact(), details(), intro_booking()],
            },
        );
        let travelled = replace_as(
            travel_peer,
            &snapshot,
            &FormLayout {
                sections: vec![contact(), details(), travel()],
            },
        );

        let stored = stored_section_order(&snapshot, &[&booked, &travelled]);
        booking_stored_before_travel |= stored
            == [
                CONTACT.as_uuid().to_string(),
                DETAILS.as_uuid().to_string(),
                BOOKING.as_uuid().to_string(),
                TRAVEL.as_uuid().to_string(),
            ];
        let expected = FormLayout {
            sections: vec![contact(), details(), travel(), intro_booking()],
        };
        assert_eq!(merge(&snapshot, &[&booked, &travelled]), expected);
        assert_eq!(merge(&snapshot, &[&travelled, &booked]), expected);
    }
    assert!(
        booking_stored_before_travel,
        "neither peer order stored the booking step before the section"
    );
}

#[test]
fn concurrent_booking_steps_both_read_last_and_stay_repairable() {
    let snapshot = seed_layout(&FormLayout {
        sections: vec![contact(), details()],
    })
    .unwrap();
    let intro = replace_as(
        1,
        &snapshot,
        &FormLayout {
            sections: vec![contact(), details(), intro_booking()],
        },
    );
    let review = replace_as(
        2,
        &snapshot,
        &FormLayout {
            sections: vec![contact(), details(), review_booking()],
        },
    );
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.import(&intro).unwrap();
    document.import(&review).unwrap();
    let merged = document.export(ExportMode::Snapshot).unwrap();

    let both = read_layout(&merged).unwrap().layout;
    assert_eq!(both.sections[..2], [contact(), details()]);
    assert_eq!(both.sections.len(), 4);
    assert!(both.sections[2..].contains(&intro_booking()));
    assert!(both.sections[2..].contains(&review_booking()));

    let mut renamed = both.clone();
    renamed.sections[0] = FormSection::Questions {
        id: CONTACT,
        title: "Contact us".to_owned(),
        description: String::new(),
        questions: vec![QuestionLayout {
            id: NAME,
            column: NAME_COLUMN,
            help_text: String::new(),
            required: false,
            widget: None,
        }],
    };
    let rename = replace_layout(&merged, &renamed).unwrap();
    assert_eq!(merge(&merged, &[&rename.update]), renamed);

    let removal = replace_layout(
        &merged,
        &FormLayout {
            sections: vec![contact(), details(), intro_booking()],
        },
    )
    .unwrap();
    assert_eq!(
        merge(&merged, &[&rename.update, &removal.update]),
        FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: CONTACT,
                    title: "Contact us".to_owned(),
                    description: String::new(),
                    questions: vec![QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    }],
                },
                details(),
                intro_booking(),
            ],
        }
    );
}

#[test]
fn a_section_reorder_over_a_booking_step_stored_mid_order_lands_where_asked() {
    let snapshot = seed_layout(&FormLayout {
        sections: vec![contact(), details(), intro_booking()],
    })
    .unwrap();
    let document = LoroDoc::from_snapshot(&snapshot).unwrap();
    document.get_movable_list(SECTION_ORDER).mov(2, 1).unwrap();
    document.commit();
    let stored = document.export(ExportMode::Snapshot).unwrap();

    let reorder = replace_layout(
        &stored,
        &FormLayout {
            sections: vec![details(), contact(), intro_booking()],
        },
    )
    .unwrap();

    assert_eq!(
        merge(&stored, &[&reorder.update]),
        FormLayout {
            sections: vec![details(), contact(), intro_booking()],
        }
    );
}
