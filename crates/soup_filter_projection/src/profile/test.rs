use super::*;
use crate::{
    DirectProjectionInput, DirectProjectionPatchInput, SoupCacheProjectionSupplement,
    SoupFlatEntityKind, compose_soup_flat_v3, patch_direct_fields, project_direct_fields,
};
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

fn document_input(file_type: Option<&str>) -> DirectProjectionInput {
    DirectProjectionInput {
        kind: SoupFlatEntityKind::Document,
        record_key: RecordKey::new("GraphqlSoupDocument:00000000-0000-0000-0000-000000000001")
            .unwrap(),
        id: uuid::Uuid::from_u128(1),
        owner: "macro|viewer@example.com".into(),
        project_id: None,
        file_type: file_type.map(str::to_owned),
        created_at: chrono::DateTime::from_timestamp(0, 0).unwrap(),
        updated_at: chrono::DateTime::from_timestamp(0, 0).unwrap(),
    }
}

#[test]
fn raw_file_types_survive_snapshots_and_patches() {
    for file_type in [
        None,
        Some(""),
        Some("doc"),
        Some("custom.ext"),
        Some("pdf"),
        Some("PDF"),
        Some(".pdf"),
        Some("日本語"),
    ] {
        let input = document_input(file_type);
        let supplement =
            SoupCacheProjectionSupplement::document(input.record_key.clone(), false, false, vec![]);
        let mut document = compose_soup_flat_v3(input, None, Some(&supplement)).unwrap();
        let values = document
            .exact_facts
            .iter()
            .filter(|fact| fact.attribute == vocabulary::file_type())
            .map(|fact| fact.value.clone())
            .collect::<Vec<_>>();
        let expected = file_type
            .map(|value| ExactValue::utf8(value).unwrap())
            .into_iter()
            .collect::<Vec<_>>();
        assert_eq!(values, expected);
        document.profile = vocabulary::profile_v4();
        validate_soup_flat_v4(&document).unwrap();
        let patch = patch_direct_fields(DirectProjectionPatchInput {
            record_key: document.record_key,
            kind: SoupFlatEntityKind::Document,
            owner: None,
            project_id: None,
            file_type: Some(file_type.map(str::to_owned)),
            created_at: None,
            updated_at: None,
        })
        .unwrap();
        let predicate_index::OptimisticProjectionMutation::Patch { exact, .. } = patch else {
            panic!("direct fields produce a patch");
        };
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].attribute, vocabulary::file_type());
        assert_eq!(exact[0].values, expected);
    }
}

#[test]
fn file_type_size_utf8_and_cardinality_are_still_validated() {
    let oversized = "a".repeat(predicate_index::MAX_EXACT_VALUE_BYTES + 1);
    assert!(project_direct_fields(document_input(Some(&oversized))).is_err());
    let input = document_input(Some("doc"));
    let supplement =
        SoupCacheProjectionSupplement::document(input.record_key.clone(), false, false, vec![]);
    let mut document = compose_soup_flat_v3(input, None, Some(&supplement)).unwrap();
    document.profile = vocabulary::profile_v4();
    document.exact_facts.push(ExactFact {
        attribute: vocabulary::file_type(),
        value: ExactValue::new([0xff]).unwrap(),
    });
    assert_eq!(
        validate_soup_flat_v4(&document),
        Err(ProfileValidationError::InvalidValue("file-type"))
    );
    document.exact_facts.last_mut().unwrap().value = ExactValue::utf8("other").unwrap();
    assert_eq!(
        validate_soup_flat_v4(&document),
        Err(ProfileValidationError::Duplicate("file-type"))
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
