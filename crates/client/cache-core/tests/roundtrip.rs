//! Normalize → denormalize round-trip tests against a realistic (trimmed)
//! Soup query, mirroring
//! `apps/web/packages/service-clients/service-storage/graphql/soup.graphql`.

use cache_core::denormalize::{ReadOutcome, denormalize};
use cache_core::document::Document;
use cache_core::normalize::normalize;
use cache_core::value::{CacheValue, EntityKey, Record};
use serde_json::{Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};

const SOUP_QUERY: &str = r#"
query Soup($input: SoupInput!) {
  user {
    id
    soup(input: $input) {
    items {
      id
      entityType
      frecencyScore
      entity {
        __typename
        ... on GraphqlSoupDocument {
          id
          documentName: name
          ownerId
          updatedAt
          properties {
            ...SoupPropertyFields
          }
        }
        ... on GraphqlSoupChannel {
          id
          channelName: name
          channelType
          latestMessage {
            ...SoupChannelMessageFields
          }
          participants {
            channelId
            userId
            role
          }
        }
      }
    }
      nextCursor
      hasMore
    }
  }
}

fragment SoupPropertyFields on GraphqlSoupProperty {
  propertyDefinitionId
  displayName
  dataType
  isMultiSelect
  isSystem
  isMetadata
  value {
    kind
    boolValue
    selectOptionIds
    entityReferences {
      entityId
      entityType
    }
    links
  }
}

fragment SoupChannelMessageFields on GraphqlSoupChannelMessage {
  id
  threadId
  senderId
  content
  mentions
}
"#;

fn variables() -> serde_json::Map<String, Json> {
    let Json::Object(map) = json!({
        "input": { "limit": 2, "sortMethod": "UPDATED_AT", "cursor": null }
    }) else {
        unreachable!()
    };
    map
}

fn response_data() -> Json {
    json!({
        "user": {
            "id": "user-1",
            "soup": {
            "items": [
                {
                    "id": "doc-1",
                    "entityType": "DOCUMENT",
                    "frecencyScore": 0.5,
                    "entity": {
                        "__typename": "GraphqlSoupDocument",
                        "id": "doc-1",
                        "documentName": "Design doc",
                        "ownerId": "user-1",
                        "updatedAt": "2026-07-01T00:00:00Z",
                        "properties": [
                            {
                                "propertyDefinitionId": "prop-1",
                                "displayName": "Status",
                                "dataType": "select",
                                "isMultiSelect": false,
                                "isSystem": true,
                                "isMetadata": false,
                                "value": {
                                    "kind": "SelectOption",
                                    "boolValue": null,
                                    "selectOptionIds": ["opt-1"],
                                    "entityReferences": [
                                        { "entityId": "proj-9", "entityType": "PROJECT" }
                                    ],
                                    "links": []
                                }
                            }
                        ]
                    }
                },
                {
                    "id": "ch-1",
                    "entityType": "CHANNEL",
                    "frecencyScore": 0.25,
                    "entity": {
                        "__typename": "GraphqlSoupChannel",
                        "id": "ch-1",
                        "channelName": "general",
                        "channelType": "PUBLIC",
                        "latestMessage": {
                            "id": "msg-1",
                            "threadId": null,
                            "senderId": "user-2",
                            "content": "hello",
                            "mentions": ["user-1"]
                        },
                        "participants": [
                            { "channelId": "ch-1", "userId": "user-1", "role": "member" }
                        ]
                    }
                }
            ],
                "nextCursor": "cursor-2",
                "hasMore": true
            }
        }
    })
}

fn write(records: &mut BTreeMap<EntityKey, Record>, doc: &Document, data: &Json) {
    let op = doc.operation(Some("Soup")).unwrap();
    let updates = normalize(op, &variables(), data).unwrap();
    for (key, record) in updates {
        records.entry(key).or_default().merge(record);
    }
}

#[test]
fn normalizes_expected_records() {
    let doc = Document::parse(SOUP_QUERY).unwrap();
    let mut records = BTreeMap::new();
    write(&mut records, &doc, &response_data());

    let keys: Vec<&str> = records.keys().map(|k| k.0.as_str()).collect();
    assert_eq!(
        keys,
        vec![
            "GraphqlSoupChannel:ch-1",
            "GraphqlSoupChannelMessage:msg-1",
            "GraphqlSoupDocument:doc-1",
            "GraphqlSoupItem:ch-1",
            "GraphqlSoupItem:doc-1",
            "GraphqlUser:user-1",
            "ROOT_QUERY",
        ]
    );

    // Aliased field stored under its schema name.
    let doc_record = &records[&EntityKey("GraphqlSoupDocument:doc-1".into())];
    assert!(matches!(
        doc_record.fields.get("name"),
        Some(CacheValue::String(s)) if s == "Design doc"
    ));
    assert!(!doc_record.fields.contains_key("documentName"));

    // Properties embedded (not their own records), message keyed by messageId.
    assert!(matches!(
        doc_record.fields.get("properties"),
        Some(CacheValue::List(items)) if matches!(&items[0], CacheValue::Object(_))
    ));
    let channel = &records[&EntityKey("GraphqlSoupChannel:ch-1".into())];
    assert!(matches!(
        channel.fields.get("latestMessage"),
        Some(CacheValue::Ref(k)) if k.0 == "GraphqlSoupChannelMessage:msg-1"
    ));

    // The root links to the viewer; the args-keyed soup page lives on it.
    let root = &records[&EntityKey::root()];
    assert!(matches!(
        root.fields.get("user"),
        Some(CacheValue::Ref(k)) if k.0 == "GraphqlUser:user-1"
    ));
    let user = &records[&EntityKey("GraphqlUser:user-1".into())];
    let soup_field = user.fields.keys().find(|k| k.starts_with("soup(")).unwrap();
    assert_eq!(
        soup_field,
        r#"soup({"input":{"cursor":null,"limit":2,"sortMethod":"UPDATED_AT"}})"#
    );
}

#[test]
fn round_trip_reproduces_response() {
    let doc = Document::parse(SOUP_QUERY).unwrap();
    let mut records = BTreeMap::new();
    write(&mut records, &doc, &response_data());

    let op = doc.operation(Some("Soup")).unwrap();
    let mut deps = BTreeSet::new();
    let outcome = denormalize(op, &variables(), &records, &mut deps).unwrap();
    let ReadOutcome::Complete(data) = outcome else {
        panic!("expected complete read, got {outcome:?}");
    };
    assert_eq!(data, response_data());

    // Dependencies include every entity visited.
    let dep_keys: Vec<&str> = deps.iter().map(|k| k.0.as_str()).collect();
    assert_eq!(
        dep_keys,
        vec![
            "GraphqlSoupChannel:ch-1",
            "GraphqlSoupChannelMessage:msg-1",
            "GraphqlSoupDocument:doc-1",
            "GraphqlSoupItem:ch-1",
            "GraphqlSoupItem:doc-1",
            "GraphqlUser:user-1",
            "ROOT_QUERY",
        ]
    );
}

#[test]
fn entity_update_visible_through_other_query() {
    let doc = Document::parse(SOUP_QUERY).unwrap();
    let mut records = BTreeMap::new();
    write(&mut records, &doc, &response_data());

    // A different document writes just the entity with a new name.
    let rename_doc = Document::parse(
        r#"query Doc($input: SoupInput!) {
             user {
               id
               soup(input: $input) {
                 items { id entity { __typename ... on GraphqlSoupDocument { id documentName: name } } }
                 nextCursor
                 hasMore
               }
             }
           }"#,
    )
    .unwrap();
    let rename_data = json!({
        "user": {
            "id": "user-1",
            "soup": {
            "items": [{
                "id": "doc-1",
                "entity": {
                    "__typename": "GraphqlSoupDocument",
                    "id": "doc-1",
                    "documentName": "Renamed"
                }
            }],
            "nextCursor": null,
            "hasMore": false
            }
        }
    });
    let op = rename_doc.operation(Some("Doc")).unwrap();
    let updates = normalize(op, &variables(), &rename_data).unwrap();
    let mut changed = Vec::new();
    for (key, record) in updates {
        let entry = records.entry(key.clone()).or_default();
        if entry.merge(record) {
            changed.push(key.0);
        }
    }
    // The document record changed; the soup page (same args) also rewritten.
    assert!(changed.contains(&"GraphqlSoupDocument:doc-1".to_string()));

    // Original query now sees the new name everywhere.
    let op = doc.operation(Some("Soup")).unwrap();
    let mut deps = BTreeSet::new();
    let ReadOutcome::Complete(data) = denormalize(op, &variables(), &records, &mut deps).unwrap()
    else {
        panic!("expected complete read");
    };
    assert_eq!(
        data["user"]["soup"]["items"][0]["entity"]["documentName"],
        json!("Renamed")
    );
}

#[test]
fn different_args_are_a_miss() {
    let doc = Document::parse(SOUP_QUERY).unwrap();
    let mut records = BTreeMap::new();
    write(&mut records, &doc, &response_data());

    let op = doc.operation(Some("Soup")).unwrap();
    let Json::Object(other_vars) = json!({ "input": { "limit": 50 } }) else {
        unreachable!()
    };
    let mut deps = BTreeSet::new();
    let outcome = denormalize(op, &other_vars, &records, &mut deps).unwrap();
    assert!(
        matches!(&outcome, ReadOutcome::Miss { entity, field }
            if entity.0 == "GraphqlUser:user-1" && field == r#"soup({"input":{"limit":50}})"#),
        "got {outcome:?}"
    );
}

#[test]
fn missing_records_reported_for_batch_fetch() {
    let doc = Document::parse(SOUP_QUERY).unwrap();
    let mut records = BTreeMap::new();
    write(&mut records, &doc, &response_data());

    // Simulate the channel record being evicted from the available source.
    records.remove(&EntityKey("GraphqlSoupChannel:ch-1".into()));

    let op = doc.operation(Some("Soup")).unwrap();
    let mut deps = BTreeSet::new();
    let outcome = denormalize(op, &variables(), &records, &mut deps).unwrap();
    let ReadOutcome::NeedRecords(missing) = outcome else {
        panic!("expected NeedRecords, got {outcome:?}");
    };
    assert_eq!(
        missing.iter().map(|k| k.0.as_str()).collect::<Vec<_>>(),
        vec!["GraphqlSoupChannel:ch-1"]
    );
}
