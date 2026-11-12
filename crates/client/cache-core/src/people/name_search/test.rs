use super::*;
use crate::{
    people::{CONTEXT_FIELD, contact_key},
    predicate::ProjectionState,
    value::{CacheValue, Record},
};

#[test]
fn complete_addresses_and_identities_never_match_another_persons_name() {
    let target = MacroUserIdStr::parse_from_str("macro|person@example.com").unwrap();
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    for input in ["person@example.com", "macro|PERSON@example.com"] {
        let query = NameSearch::new(input).unwrap();
        assert_eq!(
            query.classify("another label", &target),
            Some(NameStage::Identity)
        );
        assert_eq!(query.classify(input, &other), None);
    }
    let extension = MacroUserIdStr::parse_from_str("macro|person@example.com.example.com").unwrap();
    assert_eq!(
        NameSearch::new("person@example.com")
            .unwrap()
            .classify("person@example.com", &extension),
        None
    );
    assert!(NameSearch::new("MACRO|person@example.com").is_err());
    assert!(NameSearch::new("macro|not-an-address").is_err());
    assert_eq!(
        NameSearch::new("person@")
            .unwrap()
            .classify("ignored", &target),
        Some(NameStage::EmailPrefix)
    );
    assert_eq!(
        NameSearch::new("person@")
            .unwrap()
            .classify("person@", &other),
        None
    );
}

#[test]
fn recent_keys_sort_signed_times_then_identity_without_index_row_ids() {
    let users = ["macro|a@example.com", "macro|b@example.com"];
    let mut entries = vec![];
    for time in [i64::MIN, -1, 0, 1, i64::MAX] {
        for id in users {
            let user = MacroUserIdStr::parse_from_str(id).unwrap();
            entries.push((RecentKey::new(Some(time), &user), time, id));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let actual = entries
        .iter()
        .map(|(_, time, id)| (*time, *id))
        .collect::<Vec<_>>();
    let mut expected = actual.clone();
    expected.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
    assert_eq!(actual, expected);
    let user = MacroUserIdStr::parse_from_str(users[0]).unwrap();
    assert_eq!(RecentKey::new(None, &user), RecentKey::new(Some(0), &user));
    for epoch in [Uuid::nil(), Uuid::from_u128(9), Uuid::from_u128(u128::MAX)] {
        let key = RecentKey::new(None, &user).in_epoch(epoch);
        assert!(key.starts_with(epoch.as_bytes()));
        if let Some(end) = prefix_end(epoch.as_bytes()) {
            assert!(key < end);
        }
    }
    assert_eq!(prefix_end(&[1, 255]), Some(vec![2]));
    assert_eq!(prefix_end(&[255, 255]), None);
    assert_eq!(prefix_end(&[]), None);
}

#[test]
fn byte_prefix_bounds_preserve_unicode_and_literal_characters() {
    for prefix in ["jo", "é", "山田", "%", "_"] {
        let upper = prefix_end(prefix.as_bytes()).unwrap();
        for value in [
            prefix.to_owned(),
            format!("{prefix}suffix"),
            "other".into(),
            format!("x{prefix}"),
        ] {
            let in_range =
                value.as_bytes() >= prefix.as_bytes() && value.as_bytes() < upper.as_slice();
            assert_eq!(in_range, value.starts_with(prefix), "{prefix} {value}");
        }
    }
}

#[test]
fn indexed_words_are_bounded_with_explicit_overflow_and_sparse_scoped_ranks() {
    let viewer = "macro|viewer@example.com";
    let user = MacroUserIdStr::parse_from_str("macro|person@example.com").unwrap();
    let epoch = Uuid::from_u128(7);
    let dm = Uuid::from_u128(8);
    let name = (0..=projection::MAX_NAME_WORDS)
        .map(|i| format!("word{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    let mut record = Record { fields: [
        ("userId".into(), CacheValue::String(user.to_string())),
        ("email".into(), CacheValue::String(user.email_str().into())),
        ("name".into(), CacheValue::String(name.clone())),
        (CONTEXT_FIELD.into(), CacheValue::opaque(&serde_json::json!({"epoch":epoch,"facts":{"lastInteractionMs":10,"secondaryInbox":true,"directMessage":{"id":dm,"name":"Conversation","timestampMs":20}}}))),
    ].into() };
    let projected = crate::people::sql::projection::project(
        viewer,
        &contact_key(viewer, user.as_ref()),
        &record,
    )
    .unwrap();
    let Some(ProjectionState::Complete(document)) = projected else {
        panic!("complete membership");
    };
    let values = |attribute| {
        document
            .exact_facts
            .iter()
            .filter(move |fact| fact.attribute.as_str() == attribute)
            .map(|fact| fact.value.as_bytes())
            .collect::<Vec<_>>()
    };
    assert_eq!(values(projection::WORD).len(), projection::MAX_NAME_WORDS);
    assert_eq!(values(projection::WORD_OVERFLOW), [b"1".as_slice()]);
    assert_eq!(values(projection::NAME), [name.as_bytes()]);
    assert_eq!(
        values(projection::USER_RANK),
        [RecentKey::new(Some(10), &user).in_epoch(epoch)]
    );
    assert_eq!(
        values(projection::COMMAND_RANK),
        [RecentKey::new(Some(20), &user).in_epoch(epoch)]
    );
    assert_eq!(values(projection::SECONDARY), [epoch.as_bytes().as_slice()]);
    assert!(
        crate::people::sql::projection::project(
            viewer,
            &contact_key("macro|other@example.com", user.as_ref()),
            &record
        )
        .unwrap()
        .is_none()
    );
    record
        .fields
        .insert(CONTEXT_FIELD.into(), CacheValue::String("invalid".into()));
    let facts = projection::derive(&user, &name, &record).unwrap();
    assert!(
        facts
            .iter()
            .any(|f| f.attribute.as_str() == projection::INVALID_CONTEXT)
    );
    assert!(
        !facts
            .iter()
            .any(|f| f.attribute.as_str() == projection::USER_RANK)
    );
}
