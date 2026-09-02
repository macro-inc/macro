//! Reproduces the frontend's offline draft-save flow: a cached email thread
//! page, then a queued SaveEmailDraft optimistic write that fabricates the
//! draft entity and splices it into the page's message list. The page read
//! must show the draft while the mutation is still queued — this is what
//! makes an offline-composed reply visible after leaving and reopening the
//! thread.
//!
//! Also covers settlement: committing under the same id keeps the page
//! readable with the draft in place, while committing under a different
//! (server-alias) id skips the now record-less patch — the page stays
//! readable without the draft until the revalidation lands. The skip is
//! what makes the client-id-as-lookup-column design safe.

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::link_patch::{LinkOperation, LinkPathSegment, OptimisticLinkPatch};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::{Value as Json, json};

const PAGE_QUERY: &str = r#"
query EmailThreadPage($threadId: ID!, $offset: Int!, $limit: Int!) {
  user {
    id
    emailThread(input: { threadId: $threadId }) {
      ...EmailThreadPageFields
    }
  }
}

fragment EmailThreadPageFields on GraphqlSoupEmailThread {
  __typename
  id
  providerId
  linkId
  inboxVisible
  isRead
  projectId
  latestInboundMessageTs
  createdAt
  updatedAt
  viewerPermission {
    __typename
    ... on GraphqlAccessLevelPermission {
      accessLevel
    }
  }
  labels {
    __typename
    id
    linkId
    providerLabelId
    name
    createdAt
    messageListVisibility
    labelListVisibility
    type
  }
  messages(offset: $offset, limit: $limit) {
    ...EmailThreadMessageFields
  }
}

fragment EmailThreadMessageFields on GraphqlSoupEmailMessage {
  __typename
  id
  providerId
  threadId
  replyingToId
  linkId
  subject
  snippet
  internalDateTs
  sentAt
  isRead
  isStarred
  isSent
  isDraft
  hasAttachments
  scheduledSendTime
  from {
    email
    name
    photoUrl
  }
  to {
    email
    name
    photoUrl
  }
  cc {
    email
    name
    photoUrl
  }
  bcc {
    email
    name
    photoUrl
  }
  labels {
    providerLabelId
    name
  }
  bodyText
  bodyHtmlSanitized
  bodyMacro
  bodyReplyless
  attachments {
    __typename
    id
    providerId
    filename
    mimeType
    sizeBytes
    sfsId
    contentId
  }
  attachmentsDraft {
    __typename
    id
    draftId
    fileName
    contentType
    sha
    size
    s3Key
  }
  attachmentsForwarded {
    __typename
    attachmentId
    draftId
    providerAttachmentId
    messageProviderId
    filename
    mimeType
    sizeBytes
  }
  createdAt
  updatedAt
}
"#;

const MUTATION: &str = r#"
mutation SaveEmailDraft($input: SaveEmailDraftInput!) {
  saveEmailDraft(input: $input) {
    draftId
    draft {
      ...EmailThreadMessageFields
    }
    thread {
      __typename
      id
      updatedAt
    }
  }
}

fragment EmailThreadMessageFields on GraphqlSoupEmailMessage {
  __typename
  id
  providerId
  threadId
  replyingToId
  linkId
  subject
  snippet
  internalDateTs
  sentAt
  isRead
  isStarred
  isSent
  isDraft
  hasAttachments
  scheduledSendTime
  from {
    email
    name
    photoUrl
  }
  to {
    email
    name
    photoUrl
  }
  cc {
    email
    name
    photoUrl
  }
  bcc {
    email
    name
    photoUrl
  }
  labels {
    providerLabelId
    name
  }
  bodyText
  bodyHtmlSanitized
  bodyMacro
  bodyReplyless
  attachments {
    __typename
    id
    providerId
    filename
    mimeType
    sizeBytes
    sfsId
    contentId
  }
  attachmentsDraft {
    __typename
    id
    draftId
    fileName
    contentType
    sha
    size
    s3Key
  }
  attachmentsForwarded {
    __typename
    attachmentId
    draftId
    providerAttachmentId
    messageProviderId
    filename
    mimeType
    sizeBytes
  }
  createdAt
  updatedAt
}
"#;

fn page_variables() -> serde_json::Map<String, Json> {
    match json!({ "threadId": "thread-1", "offset": 0, "limit": 20 }) {
        Json::Object(map) => map,
        _ => unreachable!(),
    }
}

fn message(id: &str, is_draft: bool, body: &str) -> Json {
    json!({
        "__typename": "GraphqlSoupEmailMessage",
        "id": id,
        "providerId": null,
        "threadId": "thread-1",
        "replyingToId": if is_draft { json!("msg-1") } else { Json::Null },
        "linkId": "link-1",
        "subject": "Subject",
        "snippet": null,
        "internalDateTs": null,
        "sentAt": null,
        "isRead": true,
        "isStarred": false,
        "isSent": !is_draft,
        "isDraft": is_draft,
        "hasAttachments": false,
        "scheduledSendTime": null,
        "from": { "email": "sender@test.com", "name": null, "photoUrl": null },
        "to": [{ "email": "to@test.com", "name": null, "photoUrl": null }],
        "cc": [],
        "bcc": [],
        "labels": [],
        "bodyText": null,
        "bodyHtmlSanitized": body,
        "bodyMacro": null,
        "bodyReplyless": null,
        "attachments": [],
        "attachmentsDraft": [],
        "attachmentsForwarded": [],
        "createdAt": "2026-08-27T00:00:00Z",
        "updatedAt": "2026-08-27T00:00:00Z"
    })
}

fn thread_page() -> Json {
    json!({
        "user": {
            "id": "user-1",
            "emailThread": {
                "__typename": "GraphqlSoupEmailThread",
                "id": "thread-1",
                "providerId": null,
                "linkId": "link-1",
                "inboxVisible": true,
                "isRead": true,
                "projectId": null,
                "latestInboundMessageTs": null,
                "createdAt": "2026-08-26T00:00:00Z",
                "updatedAt": "2026-08-27T00:00:00Z",
                "viewerPermission": {
                    "__typename": "GraphqlAccessLevelPermission",
                    "accessLevel": "OWNER"
                },
                "labels": [],
                "messages": [message("msg-1", false, "<p>original</p>")]
            }
        }
    })
}

fn mutation_variables() -> serde_json::Map<String, Json> {
    let value = json!({
        "input": {
            "draftId": "draft-1",
            "threadDbId": "thread-1",
            "replyingToId": "msg-1",
            "subject": "Subject",
            "to": [{ "email": "to@test.com" }],
            "bodyHtml": "PHA-b2ZmbGluZTwvcD4"
        }
    });
    match value {
        Json::Object(map) => map,
        _ => unreachable!(),
    }
}

fn mutation_response() -> Json {
    json!({
        "saveEmailDraft": {
            "draftId": "draft-1",
            "draft": message("draft-1", true, "<p>offline</p>"),
            "thread": {
                "__typename": "GraphqlSoupEmailThread",
                "id": "thread-1",
                "updatedAt": "2026-08-27T01:00:00Z"
            }
        }
    })
}

fn messages_patch() -> OptimisticLinkPatch {
    messages_patch_with(LinkOperation::PrependUnique {
        entity_key: EntityKey("GraphqlSoupEmailMessage:draft-1".into()),
    })
}

fn messages_patch_with(operation: LinkOperation) -> OptimisticLinkPatch {
    OptimisticLinkPatch {
        query: PAGE_QUERY.into(),
        operation_name: Some("EmailThreadPage".into()),
        variables_json: serde_json::to_string(&page_variables()).unwrap(),
        path: vec![
            LinkPathSegment::Field {
                field: "user".into(),
            },
            LinkPathSegment::Field {
                field: "emailThread".into(),
            },
            LinkPathSegment::Field {
                field: "messages".into(),
            },
        ],
        operation,
    }
}

const DELETE_MUTATION: &str = r#"
mutation DeleteEmailDraft($input: DeleteEmailDraftInput!) {
  deleteEmailDraft(input: $input) {
    draftId
    deleted
    threadDeleted
  }
}
"#;

fn delete_variables() -> serde_json::Map<String, Json> {
    match json!({ "input": { "draftId": "draft-1" } }) {
        Json::Object(map) => map,
        _ => unreachable!(),
    }
}

fn delete_response() -> Json {
    json!({
        "deleteEmailDraft": {
            "draftId": "draft-1",
            "deleted": true,
            "threadDeleted": false
        }
    })
}

#[test]
fn queued_draft_save_is_visible_in_the_thread_page_read() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                PAGE_QUERY,
                Some("EmailThreadPage"),
                &page_variables(),
                &thread_page(),
                None,
            )
            .await
            .unwrap();

        let patches = [messages_patch()];
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "11111111-1111-4111-8111-111111111101",
                    query: MUTATION,
                    operation_name: Some("SaveEmailDraft"),
                    variables: &mutation_variables(),
                    data: &mutation_response(),
                    link_patches: &patches,
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .expect("optimistic draft write must enqueue with its link patch");

        let data = match engine
            .read_query(None, PAGE_QUERY, Some("EmailThreadPage"), &page_variables())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => data,
            ReadResult::Miss => panic!("thread page must stay a cache hit"),
        };

        let messages = data["user"]["emailThread"]["messages"].as_array().unwrap();
        let ids: Vec<&str> = messages.iter().map(|m| m["id"].as_str().unwrap()).collect();
        assert!(
            ids.contains(&"draft-1"),
            "queued draft must appear in the thread page read, got {ids:?}"
        );
        assert_eq!(
            data["user"]["emailThread"]["messages"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["id"] == "draft-1")
                .unwrap()["bodyHtmlSanitized"],
            json!("<p>offline</p>")
        );
    });
}

// The discard flow layered on the save flow: a queued DeleteEmailDraft with
// a Remove link patch must compose with the still-queued save, so an
// offline save-then-discard reads back as a thread without the draft.
#[test]
fn queued_draft_delete_removes_the_draft_from_the_thread_page_read() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                PAGE_QUERY,
                Some("EmailThreadPage"),
                &page_variables(),
                &thread_page(),
                None,
            )
            .await
            .unwrap();

        let save_patches = [messages_patch()];
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "11111111-1111-4111-8111-111111111102",
                    query: MUTATION,
                    operation_name: Some("SaveEmailDraft"),
                    variables: &mutation_variables(),
                    data: &mutation_response(),
                    link_patches: &save_patches,
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .expect("optimistic draft write must enqueue with its link patch");

        let delete_patches = [messages_patch_with(LinkOperation::Remove {
            entity_key: EntityKey("GraphqlSoupEmailMessage:draft-1".into()),
        })];
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "11111111-1111-4111-8111-111111111103",
                    query: DELETE_MUTATION,
                    operation_name: Some("DeleteEmailDraft"),
                    variables: &delete_variables(),
                    data: &delete_response(),
                    link_patches: &delete_patches,
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .expect("optimistic draft delete must enqueue with its link patch");

        let data = match engine
            .read_query(None, PAGE_QUERY, Some("EmailThreadPage"), &page_variables())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => data,
            ReadResult::Miss => panic!("thread page must stay a cache hit"),
        };

        let messages = data["user"]["emailThread"]["messages"].as_array().unwrap();
        let ids: Vec<&str> = messages.iter().map(|m| m["id"].as_str().unwrap()).collect();
        assert_eq!(
            ids,
            vec!["msg-1"],
            "discarded draft must not appear in the thread page read"
        );
    });
}

fn save_response_with(draft_id: &str, body: &str) -> Json {
    json!({
        "saveEmailDraft": {
            "draftId": draft_id,
            "draft": message(draft_id, true, body),
            "thread": {
                "__typename": "GraphqlSoupEmailThread",
                "id": "thread-1",
                "updatedAt": "2026-08-27T01:00:00Z"
            }
        }
    })
}

async fn claim_head(engine: &mut Engine<InMemoryStorage>) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 10,
            lease_expires_at_ms: 1_010,
        })
        .await
        .unwrap()
        .expect("queue head");
    MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    }
}

fn message_ids(data: &Json) -> Vec<&str> {
    data["user"]["emailThread"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect()
}

// Settlement path of the shipped client-real-id design: the server response
// carries the SAME id the enqueued link patch references, so the reapplied
// patch points at an entity the response just wrote. The page must stay a
// hit with the draft present, now carrying server truth.
#[test]
fn committed_draft_save_with_the_same_id_keeps_the_draft_visible() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                PAGE_QUERY,
                Some("EmailThreadPage"),
                &page_variables(),
                &thread_page(),
                None,
            )
            .await
            .unwrap();

        let patches = [messages_patch()];
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "11111111-1111-4111-8111-111111111104",
                    query: MUTATION,
                    operation_name: Some("SaveEmailDraft"),
                    variables: &mutation_variables(),
                    data: &mutation_response(),
                    link_patches: &patches,
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();

        let claim = claim_head(&mut engine).await;
        engine
            .commit_optimistic_write(
                transaction,
                claim,
                MUTATION,
                Some("SaveEmailDraft"),
                &mutation_variables(),
                &save_response_with("draft-1", "<p>server copy</p>"),
            )
            .await
            .unwrap();

        let data = match engine
            .read_query(None, PAGE_QUERY, Some("EmailThreadPage"), &page_variables())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => data,
            ReadResult::Miss => panic!("thread page must stay a hit after commit"),
        };
        assert_eq!(message_ids(&data), vec!["draft-1", "msg-1"]);
        assert_eq!(
            data["user"]["emailThread"]["messages"][0]["bodyHtmlSanitized"],
            json!("<p>server copy</p>"),
            "the committed read must serve the server's copy, not the optimistic one"
        );
    });
}

// The alias-id flow (client handle as a lookup key, server-minted PK): the
// enqueued link patch references the CLIENT handle, but the settlement
// response carries the entity under the SERVER id, so at commit the patch
// points at an entity with no record. The engine must treat that inserted
// reference as not-applicable — dropped in skip mode rather than reapplied
// as a dangling ref that would turn every read of the page into a miss —
// leaving the page readable (briefly without the draft) until the
// mutation's revalidation delivers the server's list. This settlement skip
// is what makes client-handle identity safe; a regression here reads as
// the Miss branch below.
#[test]
fn committed_alias_id_response_skips_the_patch_and_stays_readable() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        engine
            .write_query(
                None,
                PAGE_QUERY,
                Some("EmailThreadPage"),
                &page_variables(),
                &thread_page(),
                None,
            )
            .await
            .unwrap();

        // The optimistic layer fabricates the draft under the client id, as
        // the alias design would: the client cannot know the server id yet.
        let patches = [messages_patch_with(LinkOperation::PrependUnique {
            entity_key: EntityKey("GraphqlSoupEmailMessage:client-1".into()),
        })];
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    uuid: "11111111-1111-4111-8111-111111111105",
                    query: MUTATION,
                    operation_name: Some("SaveEmailDraft"),
                    variables: &mutation_variables(),
                    data: &save_response_with("client-1", "<p>offline</p>"),
                    link_patches: &patches,
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();

        // Queued, the page read hits: the alias entity exists optimistically.
        match engine
            .read_query(None, PAGE_QUERY, Some("EmailThreadPage"), &page_variables())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => {
                assert_eq!(message_ids(&data), vec!["client-1", "msg-1"]);
            }
            ReadResult::Miss => panic!("queued alias draft must be readable"),
        }

        // Settle with the server's response: the draft entity arrives under
        // the server-minted id; nothing ever writes a `client-1` record.
        let claim = claim_head(&mut engine).await;
        engine
            .commit_optimistic_write(
                transaction,
                claim,
                MUTATION,
                Some("SaveEmailDraft"),
                &mutation_variables(),
                &save_response_with("srv-1", "<p>server copy</p>"),
            )
            .await
            .unwrap();

        // Settlement must skip the alias patch (its entity has no record):
        // the page stays a hit, listing only the server's known messages.
        match engine
            .read_query(None, PAGE_QUERY, Some("EmailThreadPage"), &page_variables())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => {
                assert_eq!(
                    message_ids(&data),
                    vec!["msg-1"],
                    "the skipped alias patch must leave the durable list untouched"
                );
            }
            ReadResult::Miss => panic!(
                "a record-less inserted reference must be skipped at settlement, \
                 never planted as a dangling ref that misses the whole page"
            ),
        }

        // The draft's brief absence ends when the mutation's persisted
        // revalidation delivers the server's fresh list.
        let mut revalidated = thread_page();
        revalidated["user"]["emailThread"]["messages"] = json!([
            message("srv-1", true, "<p>server copy</p>"),
            message("msg-1", false, "<p>original</p>"),
        ]);
        engine
            .write_query(
                None,
                PAGE_QUERY,
                Some("EmailThreadPage"),
                &page_variables(),
                &revalidated,
                None,
            )
            .await
            .unwrap();
        match engine
            .read_query(None, PAGE_QUERY, Some("EmailThreadPage"), &page_variables())
            .await
            .unwrap()
        {
            ReadResult::Hit { data } => {
                assert_eq!(message_ids(&data), vec!["srv-1", "msg-1"]);
            }
            ReadResult::Miss => panic!("the revalidation write must repair the page"),
        }
    });
}
