use std::sync::{Arc, Mutex};

use ::work_feed::domain::{
    models::{
        WorkFeedChange, WorkFeedDoneOutcome, WorkFeedDoneReceipt, WorkFeedDoneTarget,
        WorkFeedEntry, WorkFeedError, WorkFeedItem, WorkFeedItemKey, WorkFeedItemState,
        WorkFeedItemType, WorkFeedMode, WorkFeedPage, WorkFeedPosition, WorkFeedPrimaryReason,
        WorkFeedQuery, WorkFeedRevision, WorkFeedScope, WorkFeedStack, WorkFeedStackKind,
        WorkFeedTrigger, WorkFeedViewer,
    },
    ports::WorkFeedTriggers,
};
use async_graphql::futures_util::{StreamExt as _, future::BoxFuture, pin_mut};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use model_notifications::NotifEvent;
use notification::domain::models::{NotificationState, UserNotificationRow};
use soup::domain::models::SoupProjectionHydration;

use super::*;
use crate::{WorkFeedGraphqlContext, WorkFeedGraphqlService, WorkFeedViewerResolver};

const DOC_ID: Uuid = Uuid::from_u128(0xD0C);

fn at(minute: u32) -> chrono::DateTime<chrono::Utc> {
    use chrono::TimeZone;
    chrono::Utc
        .with_ymd_and_hms(2024, 6, 1, 10, minute, 0)
        .unwrap()
}

fn doc_key() -> WorkFeedItemKey {
    WorkFeedItemKey::new(ModelEntityType::Document.with_entity_string(DOC_ID.to_string()))
}

fn comment(id: u128, minute: u32) -> Arc<UserNotificationRow<NotifEvent>> {
    let metadata: NotifEvent = serde_json::from_value(serde_json::json!({
        "tag": "commented_on_document",
        "content": {
            "documentName": "Doc",
            "owner": VALID_USER_ID,
            "commentId": Uuid::from_u128(id),
            "threadId": Uuid::from_u128(id),
            "text": "looks good",
        },
    }))
    .unwrap();
    Arc::new(UserNotificationRow {
        owner_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        notification_id: Uuid::from_u128(id),
        notification_event_type: "commented_on_document".to_string(),
        entity: doc_key().entity().clone(),
        sent: true,
        state: NotificationState::Unseen,
        created_at: at(minute),
        viewed_at: None,
        updated_at: at(minute),
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: None,
    })
}

fn doc_entry() -> WorkFeedEntry<SoupProjectionHydration> {
    let notifications = vec![comment(2, 7), comment(1, 5)];
    WorkFeedEntry {
        sort_at: at(9),
        item: WorkFeedItem {
            key: doc_key(),
            entity: SoupProjectionHydration {
                item: soup_document(DOC_ID),
                document_server_facts: None,
            },
            state: WorkFeedItemState::Unseen,
            attention_at: Some(at(7)),
            touched_at: Some(at(9)),
            stacks: vec![WorkFeedStack {
                kind: WorkFeedStackKind::Comments,
                thread_id: None,
                notifications: notifications.clone(),
            }],
            notifications,
            primary: WorkFeedPrimaryReason::OwnWork,
        },
    }
}

#[derive(Default)]
struct RecordingWorkFeedService {
    pages: Mutex<Vec<(WorkFeedViewer, WorkFeedQuery)>>,
    recomputes: Mutex<Vec<(WorkFeedScope, Vec<WorkFeedItemKey>)>>,
    dones: Mutex<Vec<Vec<WorkFeedDoneTarget>>>,
    undos: Mutex<Vec<(WorkFeedScope, WorkFeedDoneReceipt)>>,
}

/// Shares the recording service between the schema and the assertions.
struct Recording(Arc<RecordingWorkFeedService>);

impl WorkFeedGraphqlService for Recording {
    fn page(
        &self,
        viewer: WorkFeedViewer,
        query: WorkFeedQuery,
    ) -> BoxFuture<'_, Result<WorkFeedPage<SoupProjectionHydration>, WorkFeedError>> {
        self.0.pages.lock().unwrap().push((viewer, query));
        Box::pin(async {
            Ok(WorkFeedPage {
                entries: vec![doc_entry()],
                next: Some(WorkFeedPosition {
                    sort_at: at(9),
                    entity_id: DOC_ID.to_string(),
                }),
            })
        })
    }

    fn recompute(
        &self,
        _viewer: WorkFeedViewer,
        scope: WorkFeedScope,
        keys: Vec<WorkFeedItemKey>,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, WorkFeedError>> {
        self.0
            .recomputes
            .lock()
            .unwrap()
            .push((scope, keys.clone()));
        Box::pin(async move {
            Ok(keys
                .into_iter()
                .map(|key| {
                    if key == doc_key() {
                        WorkFeedChange::Upserted(doc_entry())
                    } else {
                        WorkFeedChange::Removed(key)
                    }
                })
                .collect())
        })
    }

    fn mark_done(
        &self,
        _viewer: WorkFeedViewer,
        targets: Vec<WorkFeedDoneTarget>,
    ) -> BoxFuture<'_, Result<WorkFeedDoneOutcome, WorkFeedError>> {
        let items = targets
            .iter()
            .map(|target| target.key.clone())
            .collect::<Vec<_>>();
        self.0.dones.lock().unwrap().push(targets);
        Box::pin(async move {
            Ok(WorkFeedDoneOutcome {
                receipt: WorkFeedDoneReceipt {
                    items: items.iter().map(WorkFeedItemKey::id).collect(),
                    notification_ids: vec![Uuid::from_u128(1)],
                    ..Default::default()
                },
                items,
            })
        })
    }

    fn undo_done(
        &self,
        _viewer: WorkFeedViewer,
        scope: WorkFeedScope,
        receipt: WorkFeedDoneReceipt,
    ) -> BoxFuture<'_, Result<Vec<WorkFeedChange<SoupProjectionHydration>>, WorkFeedError>> {
        self.0.undos.lock().unwrap().push((scope, receipt));
        Box::pin(async { Ok(vec![WorkFeedChange::Upserted(doc_entry())]) })
    }
}

/// Triggers a test drives by hand.
#[derive(Default, Clone)]
struct ManualTriggers {
    sender: Arc<Mutex<Option<tokio::sync::mpsc::Sender<WorkFeedTrigger>>>>,
    subscribed: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl WorkFeedTriggers for ManualTriggers {
    fn subscribe(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<WorkFeedTrigger> {
        let (sender, receiver) = tokio::sync::mpsc::channel(8);
        *self.sender.lock().unwrap() = Some(sender);
        self.subscribed.lock().unwrap().push(user);
        receiver
    }
}

struct NoTeam;

impl WorkFeedViewerResolver for NoTeam {
    fn team(
        &self,
        _user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>> {
        Box::pin(async { Ok(None) })
    }
}

fn context(
    service: &Arc<RecordingWorkFeedService>,
    triggers: &ManualTriggers,
) -> WorkFeedGraphqlContext {
    WorkFeedGraphqlContext::new(Recording(Arc::clone(service)), triggers.clone(), NoTeam)
}

fn viewer_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap()
}

#[tokio::test]
async fn work_feed_pages_hydrated_stacked_entries_for_the_viewer() {
    let harness = harness();
    let service = Arc::new(RecordingWorkFeedService::default());
    let triggers = ManualTriggers::default();

    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"{ user { workFeed(input: {
                        scope: { mode: ATTENTION, types: [DOCUMENT, CHANNEL_THREAD] },
                        limit: 10
                    }) {
                        nextCursor
                        entries {
                            sortAt touchedAt revision primaryReason primaryStackIndex
                            item {
                                id state attentionAt unseenCount
                                entity { __typename id }
                                stacks {
                                    kind threadId latestAt unseen count
                                    notifications(limit: 1) { id eventType state }
                                }
                            }
                        }
                    } } }"#,
                    authenticated_parts(),
                )
                .data(context(&service, &triggers)),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let page = &data["user"]["workFeed"];
    let entry = &page["entries"][0];

    assert_eq!(entry["sortAt"], at(9).to_rfc3339());
    assert_eq!(entry["touchedAt"], at(9).to_rfc3339());
    assert_eq!(entry["primaryReason"], "OWN_WORK");
    assert!(entry["primaryStackIndex"].is_null());
    let revision = WorkFeedRevision::decode(entry["revision"].as_str().unwrap()).unwrap();
    assert_eq!(revision.attention_through, Some(at(7)));

    let item = &entry["item"];
    assert_eq!(item["id"], format!("document:{DOC_ID}"));
    assert_eq!(item["state"], "UNSEEN");
    assert_eq!(item["unseenCount"], 2);
    assert_eq!(item["entity"]["__typename"], "GraphqlSoupDocument");
    assert_eq!(item["entity"]["id"], DOC_ID.to_string());
    let stack = &item["stacks"][0];
    assert_eq!(stack["kind"], "COMMENTS");
    assert_eq!(stack["count"], 2);
    assert_eq!(stack["unseen"], true);
    assert_eq!(stack["latestAt"], at(7).to_rfc3339());
    assert_eq!(stack["notifications"].as_array().unwrap().len(), 1);
    assert_eq!(
        stack["notifications"][0]["id"],
        Uuid::from_u128(2).to_string()
    );

    let position = WorkFeedPosition::decode(page["nextCursor"].as_str().unwrap()).unwrap();
    assert_eq!(position.entity_id, DOC_ID.to_string());

    let pages = service.pages.lock().unwrap();
    let (viewer, query) = &pages[0];
    assert_eq!(viewer.user.as_ref(), VALID_USER_ID);
    assert_eq!(query.scope.mode, WorkFeedMode::Attention);
    assert_eq!(
        query.scope.types,
        vec![WorkFeedItemType::Document, WorkFeedItemType::ChannelThread]
    );
    assert_eq!(query.limit, 10);
}

#[tokio::test]
async fn work_feed_rejects_a_bad_cursor_before_reading() {
    let harness = harness();
    let service = Arc::new(RecordingWorkFeedService::default());
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"{ user { workFeed(input: { cursor: "nope" }) { nextCursor } } }"#,
                    authenticated_parts(),
                )
                .data(context(&service, &ManualTriggers::default())),
        )
        .await;
    assert_eq!(response.errors[0].message, "invalid work feed cursor");
    assert!(service.pages.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mark_done_completes_the_observed_revision_and_undo_restores_it() {
    let harness = harness();
    let service = Arc::new(RecordingWorkFeedService::default());
    let triggers = ManualTriggers::default();
    let revision = WorkFeedRevision {
        attention_through: Some(at(7)),
    }
    .encode();

    let done = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ markWorkFeedItemsDone(input: {{ items: [
                            {{ id: "document:{DOC_ID}", revision: "{revision}" }}
                        ] }}) {{ itemIds undoToken }} }}"#
                    ),
                    authenticated_parts(),
                )
                .data(viewer_id())
                .data(context(&service, &triggers)),
        )
        .await;
    assert!(done.errors.is_empty(), "{:?}", done.errors);
    let done = done.data.into_json().unwrap();
    assert_eq!(
        done["markWorkFeedItemsDone"]["itemIds"],
        serde_json::json!([format!("document:{DOC_ID}")])
    );
    let targets = service.dones.lock().unwrap()[0].clone();
    assert_eq!(targets[0].key, doc_key());
    assert_eq!(targets[0].revision.unwrap().attention_through, Some(at(7)));

    let undo_token = done["markWorkFeedItemsDone"]["undoToken"].as_str().unwrap();
    let undo = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ undoWorkFeedItemsDone(input: {{
                            undoToken: "{undo_token}", scope: {{ mode: WORK }}
                        }}) {{ patches {{ __typename
                            ... on WorkFeedEntryUpserted {{ entry {{ item {{ id }} }} }}
                        }} }} }}"#
                    ),
                    authenticated_parts(),
                )
                .data(viewer_id())
                .data(context(&service, &triggers)),
        )
        .await;
    assert!(undo.errors.is_empty(), "{:?}", undo.errors);
    let undo = undo.data.into_json().unwrap();
    assert_eq!(
        undo["undoWorkFeedItemsDone"]["patches"][0]["entry"]["item"]["id"],
        format!("document:{DOC_ID}")
    );
    let undos = service.undos.lock().unwrap();
    assert_eq!(undos[0].1.notification_ids, vec![Uuid::from_u128(1)]);
}

#[tokio::test]
async fn mark_done_requires_an_authenticated_user() {
    let harness = harness();
    let service = Arc::new(RecordingWorkFeedService::default());
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"mutation { markWorkFeedItemsDone(input: { items: [] }) { itemIds } }"#,
                    authenticated_parts(),
                )
                .data(context(&service, &ManualTriggers::default())),
        )
        .await;
    assert_eq!(response.errors[0].message, "authentication required");
    assert!(service.dones.lock().unwrap().is_empty());
}

#[tokio::test]
async fn work_feed_updates_batch_recomputed_patches() {
    let harness = harness();
    let service = Arc::new(RecordingWorkFeedService::default());
    let triggers = ManualTriggers::default();
    let other = WorkFeedItemKey::new(
        ModelEntityType::Chat.with_entity_string(Uuid::from_u128(0xC4A7).to_string()),
    );

    let request = async_graphql::Request::new(
        r#"subscription { workFeedUpdates(scope: { mode: WORK }) {
            __typename
            ... on WorkFeedEntryUpserted { entry { sortAt item { id state } } }
            ... on WorkFeedEntryRemoved { itemId }
            ... on WorkFeedInvalidated { refresh }
        } }"#,
    )
    .data(viewer_id())
    .data(context(&service, &triggers));
    let responses = harness.schema.execute_stream(request);
    pin_mut!(responses);

    // The subscription opens its triggers lazily, on first poll.
    let first = tokio::spawn({
        let triggers = triggers.clone();
        let other = other.clone();
        async move {
            let sender = loop {
                if let Some(sender) = triggers.sender.lock().unwrap().clone() {
                    break sender;
                }
                tokio::task::yield_now().await;
            };
            // A burst inside one window becomes one recompute.
            sender
                .send(WorkFeedTrigger::Changed(vec![doc_key().into_entity()]))
                .await
                .unwrap();
            sender
                .send(WorkFeedTrigger::Changed(vec![
                    other.into_entity(),
                    doc_key().into_entity(),
                ]))
                .await
                .unwrap();
            sender
        }
    });
    let response = responses.next().await.expect("patch batch");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let patches = data["workFeedUpdates"].as_array().unwrap();
    assert_eq!(patches.len(), 2);
    assert_eq!(patches[0]["__typename"], "WorkFeedEntryUpserted");
    assert_eq!(
        patches[0]["entry"]["item"]["id"],
        format!("document:{DOC_ID}")
    );
    assert_eq!(patches[1]["__typename"], "WorkFeedEntryRemoved");
    assert_eq!(patches[1]["itemId"], other.id());
    {
        let recomputes = service.recomputes.lock().unwrap();
        assert_eq!(recomputes.len(), 1);
        assert_eq!(recomputes[0].0.mode, WorkFeedMode::Work);
        assert_eq!(recomputes[0].1, vec![doc_key(), other.clone()]);
    }

    let sender = first.await.unwrap();
    sender.send(WorkFeedTrigger::Invalidated).await.unwrap();
    let response = responses.next().await.expect("invalidation");
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["workFeedUpdates"][0]["__typename"],
        "WorkFeedInvalidated"
    );

    // When the sources end, the stream ends with an error to resubscribe.
    drop(sender);
    *triggers.sender.lock().unwrap() = None;
    let response = responses.next().await.expect("closing error");
    assert!(!response.errors.is_empty());
    assert_eq!(
        triggers.subscribed.lock().unwrap().as_slice(),
        &[viewer_id()]
    );
}
