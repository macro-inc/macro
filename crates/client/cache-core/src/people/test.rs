#[test]
fn missing_contact_names_fall_back_to_the_email_local_part() {
    use super::{PeopleMode, PeopleSearch, PeopleSearchResult, ranking::PeopleRanker};
    use crate::{
        engine::HydrationScope,
        value::{CacheValue, Record},
    };
    use uuid::Uuid;

    let request = PeopleSearch {
        scope: HydrationScope {
            storage_generation: Uuid::from_u128(1),
            identity: "macro|viewer@example.com".into(),
            contact_fence: None,
        },
        mode: PeopleMode::Recipient,
        query: "person".into(),
        excluded: Vec::new(),
        sender_domain: None,
        limit: 1,
        now_ms: 0,
        cursor: None,
    };
    let mut ranker = PeopleRanker::new(&request, Uuid::from_u128(2)).unwrap();
    let record = Record {
        fields: [
            (
                "userId".into(),
                CacheValue::String("macro|person@example.com".into()),
            ),
            (
                "email".into(),
                CacheValue::String("person@example.com".into()),
            ),
        ]
        .into(),
    };
    ranker.push(
        &super::contact_key("macro|viewer@example.com", "macro|person@example.com"),
        &record,
    );
    let PeopleSearchResult::Page { people, .. } = ranker.finish().unwrap() else {
        panic!("expected a ranked page")
    };
    assert_eq!(people.len(), 1);
    assert_eq!(people[0].name, "person");
}

#[test]
fn checked_in_transport_schema_matches_rust() {
    assert_eq!(
        super::schema::schemas(),
        serde_json::from_str::<serde_json::Value>(include_str!("schema.json")).unwrap(),
        "regenerate with bun run gen-cache-people-schema --rust in apps/web"
    );
}
