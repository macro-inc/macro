//! Message-specific sender names must not become shared contact records.

use cache_core::denormalize::{ReadOutcome, denormalize};
use cache_core::document::Document;
use cache_core::normalize::normalize;
use cache_core::value::{EntityKey, Record};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const QUERY: &str = r#"
query EmailParticipants($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
      items {
        __typename
        id
        ... on GraphqlSoupEmailThread {
          participants: senders { contactId linkId name email sfsPhotoUrl }
        }
      }
      nextCursor
    }
  }
}
"#;

fn participant(name: &str) -> Value {
    json!({
        "contactId": "github-notifications",
        "linkId": "inbox-1",
        "name": name,
        "email": "notifications@github.com",
        "sfsPhotoUrl": null
    })
}

fn page(thread_id: &str, names: &[&str]) -> Value {
    json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "__typename": "GraphqlSoupEmailThread",
                    "id": thread_id,
                    "participants": names.iter().map(|name| participant(name)).collect::<Vec<_>>()
                }],
                "nextCursor": null
            }
        }
    })
}

#[test]
fn sender_names_survive_other_messages_and_pages_with_the_same_contact() {
    let document = Document::parse(QUERY).unwrap();
    let operation = document.operation(Some("EmailParticipants")).unwrap();
    let schema = cache_core::meta::bundled_schema_ref();
    let variables = json!({"input": {"limit": 1}}).as_object().unwrap().clone();
    let next_variables = json!({"input": {"limit": 1, "cursor": "next"}})
        .as_object()
        .unwrap()
        .clone();
    let original = page(
        "thread-1",
        &["Sean Aye", "coderabbitai[bot]", "cursor[bot]"],
    );
    let mut records: BTreeMap<EntityKey<'static>, Record> = BTreeMap::new();

    for (variables, data) in [
        (&variables, &original),
        (&next_variables, &page("thread-2", &["Wolf Mermelstein"])),
        (&next_variables, &page("thread-2", &["github-actions[bot]"])),
    ] {
        for (key, record) in normalize(schema, operation, variables, data).unwrap() {
            records.entry(key).or_default().merge(record);
        }
    }

    let outcome = denormalize(
        schema,
        operation,
        &variables,
        &records,
        &mut BTreeSet::new(),
    )
    .unwrap();
    let ReadOutcome::Complete(data) = outcome else {
        panic!("expected the first page to remain readable");
    };
    assert_eq!(data, original);
    assert!(
        records
            .keys()
            .all(|key| !key.0.starts_with("GraphqlSoupEmailSender:")),
        "sender display names belong to the thread, not a globally shared contact record"
    );
}
