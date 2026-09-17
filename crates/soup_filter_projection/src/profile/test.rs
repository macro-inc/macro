use super::*;
use crate::{DirectProjectionInput, SoupFlatEntityKind, compose_soup_flat_v3};
use predicate_index::{ExactValue, RecordKey};

fn notification(attribute: Token, id: u128) -> ExactFact {
    ExactFact {
        attribute,
        value: ExactValue::new(uuid::Uuid::from_u128(id).as_bytes()).unwrap(),
    }
}

fn project() -> IndexDocument {
    let timestamp = chrono::DateTime::from_timestamp(0, 0).unwrap();
    let mut document = compose_soup_flat_v3(
        DirectProjectionInput {
            record_key: RecordKey::new("GraphqlSoupProject:00000000-0000-0000-0000-000000000001")
                .unwrap(),
            kind: SoupFlatEntityKind::Project,
            id: uuid::Uuid::from_u128(1),
            owner: "macro|viewer@example.com".into(),
            project_id: None,
            file_type: None,
            created_at: timestamp,
            updated_at: timestamp,
        },
        None,
        None,
    )
    .unwrap();
    document.profile = vocabulary::profile_v4();
    document
}

#[test]
fn large_notification_sets_validate_but_conflicting_states_do_not() {
    let mut document = project();
    document
        .exact_facts
        .extend((1..=10_000).map(|id| notification(vocabulary::notification_unseen(), id)));
    document
        .exact_facts
        .push(notification(vocabulary::notification_seen(), 10_001));
    // Duplicate same-state membership is safe and canonicalization removes it.
    document
        .exact_facts
        .push(notification(vocabulary::notification_unseen(), 1));
    validate_soup_flat_v4(&document).unwrap();
    document
        .exact_facts
        .push(notification(vocabulary::notification_seen(), 1));
    assert_eq!(
        validate_soup_flat_v4(&document),
        Err(ProfileValidationError::InvalidValue("notification-state")),
    );
    // Conflict detection must not depend on which state is visited first.
    document.exact_facts.reverse();
    assert_eq!(
        validate_soup_flat_v4(&document),
        Err(ProfileValidationError::InvalidValue("notification-state")),
    );
}

#[test]
fn notification_value_shape_is_still_validated() {
    let mut document = project();
    document.exact_facts.push(ExactFact {
        attribute: vocabulary::notification_seen(),
        value: ExactValue::utf8("not-a-uuid").unwrap(),
    });
    assert_eq!(
        validate_soup_flat_v4(&document),
        Err(ProfileValidationError::InvalidValue("notification-id")),
    );
}
