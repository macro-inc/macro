use std::sync::{Arc, Mutex};

use ::attention_feed::{
    domain::{
        models::{
            CandidateKeying, DoneReceipt, FeedError, FeedKey, FeedPosition, FeedRevision,
            FeedTrigger, FeedViewer,
        },
        ports::FeedTriggers,
    },
    inbound::viewers::FeedViewerResolver,
};
use ::notification_inbox::domain::models::{
    ClearAction, ClearRun, ClearStatus, InboxActor, InboxChange, InboxClearRequest,
    InboxDoneOutcome, InboxEntry, InboxNotificationDoneOutcome, InboxPage, InboxQuery, InboxRow,
    InboxRowAction, InboxRowActionKind, InboxRowId, InboxRowTarget, InboxRowType, InboxScope,
    StartedClear,
};
use async_graphql::futures_util::{StreamExt as _, future::BoxFuture, pin_mut};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use model_notifications::NotifEvent;
use notification::domain::models::{NotificationState, UserNotificationRow};
use soup::domain::models::SoupProjectionHydration;

use super::*;
use crate::{NotificationInboxGraphqlContext, NotificationInboxGraphqlService};

const DOC_ID: Uuid = Uuid::from_u128(0xD0C);

fn at(minute: u32) -> chrono::DateTime<chrono::Utc> {
    use chrono::TimeZone;
    chrono::Utc
        .with_ymd_and_hms(2024, 6, 1, 10, minute, 0)
        .unwrap()
}

fn doc_group() -> FeedKey {
    FeedKey::new(ModelEntityType::Document.with_entity_string(DOC_ID.to_string()))
}

fn thread_row_id() -> InboxRowId {
    InboxRowId {
        group: doc_group(),
        slot: "thread:a".to_string(),
    }
}

fn comment(id: u128, minute: u32) -> Arc<UserNotificationRow<NotifEvent>> {
    let metadata: NotifEvent = serde_json::from_value(serde_json::json!({
        "tag": "replied_to_document_comment_thread",
        "content": {
            "documentName": "Doc",
            "owner": VALID_USER_ID,
            "commentId": Uuid::from_u128(id),
            "threadId": Uuid::from_u128(0xA),
            "text": "looks good",
        },
    }))
    .unwrap();
    Arc::new(UserNotificationRow {
        owner_id: MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
        notification_id: Uuid::from_u128(id),
        notification_event_type: "replied_to_document_comment_thread".to_string(),
        entity: doc_group().entity().clone(),
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

fn doc_entry() -> InboxEntry<SoupProjectionHydration> {
    InboxEntry {
        group: doc_group(),
        entity: SoupProjectionHydration {
            item: soup_document(DOC_ID),
            document_server_facts: None,
            sort_key: None,
        },
        sort_at: at(7),
        rows: vec![InboxRow {
            id: thread_row_id(),
            row_type: InboxRowType::DiscussionThread,
            thread_id: Some("a".to_string()),
            actor: Some(InboxActor::User(
                MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
            )),
            actions: vec![InboxRowAction {
                kind: InboxRowActionKind::Open,
                target_id: None,
                url: None,
            }],
            notifications: vec![comment(2, 7), comment(1, 5)],
            hidden: vec![comment(3, 6)],
            unseen: true,
        }],
    }
}

#[derive(Default)]
struct RecordingInboxService {
    pages: Mutex<Vec<InboxQuery>>,
    recomputes: Mutex<Vec<(InboxScope, Vec<FeedKey>)>>,
    dones: Mutex<Vec<Vec<InboxRowTarget>>>,
    notification_dones: Mutex<Vec<(InboxScope, InboxRowId, Uuid)>>,
    clears: Mutex<Vec<(InboxClearRequest, Uuid)>>,
    clear_undos: Mutex<Vec<Uuid>>,
    clear_reads: Mutex<Vec<Option<Uuid>>>,
    undos: Mutex<Vec<(InboxScope, DoneReceipt)>>,
    seens: Mutex<Vec<(InboxScope, Vec<InboxRowId>)>>,
}

/// Shares the recording service between the schema and the assertions.
struct Recording(Arc<RecordingInboxService>);

type Changes = Vec<InboxChange<SoupProjectionHydration>>;

impl NotificationInboxGraphqlService for Recording {
    fn page(
        &self,
        _viewer: FeedViewer,
        query: InboxQuery,
    ) -> BoxFuture<'_, Result<InboxPage<SoupProjectionHydration>, FeedError>> {
        self.0.pages.lock().unwrap().push(query);
        Box::pin(async {
            Ok(InboxPage {
                entries: vec![doc_entry()],
                next: Some(FeedPosition {
                    sort_at: at(7),
                    entity_id: DOC_ID.to_string(),
                }),
            })
        })
    }

    fn recompute(
        &self,
        _viewer: FeedViewer,
        scope: InboxScope,
        groups: Vec<FeedKey>,
    ) -> BoxFuture<'_, Result<Changes, FeedError>> {
        self.0
            .recomputes
            .lock()
            .unwrap()
            .push((scope, groups.clone()));
        Box::pin(async move {
            Ok(groups
                .into_iter()
                .map(|group| {
                    if group == doc_group() {
                        InboxChange::Upserted(doc_entry())
                    } else {
                        InboxChange::Removed(group)
                    }
                })
                .collect())
        })
    }

    fn mark_done(
        &self,
        _viewer: FeedViewer,
        targets: Vec<InboxRowTarget>,
    ) -> BoxFuture<'_, Result<InboxDoneOutcome, FeedError>> {
        let rows: Vec<_> = targets.iter().map(|target| target.id.clone()).collect();
        self.0.dones.lock().unwrap().push(targets);
        Box::pin(async move {
            Ok(InboxDoneOutcome {
                receipt: DoneReceipt {
                    keys: vec![doc_group().id()],
                    notification_ids: vec![Uuid::from_u128(1)],
                    ..Default::default()
                },
                rows,
            })
        })
    }

    fn mark_notification_done(
        &self,
        _viewer: FeedViewer,
        scope: InboxScope,
        row: InboxRowId,
        notification: Uuid,
    ) -> BoxFuture<'_, Result<InboxNotificationDoneOutcome<SoupProjectionHydration>, FeedError>>
    {
        self.0
            .notification_dones
            .lock()
            .unwrap()
            .push((scope, row, notification));
        Box::pin(async move {
            Ok(InboxNotificationDoneOutcome {
                changes: vec![InboxChange::Upserted(doc_entry())],
                receipt: DoneReceipt {
                    keys: vec![doc_group().id()],
                    notification_ids: vec![notification],
                    ..Default::default()
                },
            })
        })
    }

    fn start_clear(
        &self,
        _viewer: FeedViewer,
        request: InboxClearRequest,
        id: Uuid,
    ) -> BoxFuture<'_, Result<StartedClear, FeedError>> {
        let action = clear_action(id, ClearStatus::Done, &request);
        self.0.clears.lock().unwrap().push((request, id));
        // No run: the clear is reported as it stands.
        Box::pin(async { Ok(StartedClear { action, run: None }) })
    }

    fn undo_clear(
        &self,
        _viewer: FeedViewer,
        id: Uuid,
    ) -> BoxFuture<'_, Result<Option<StartedClear>, FeedError>> {
        self.0.clear_undos.lock().unwrap().push(id);
        let action = clear_action(id, ClearStatus::Undone, &email_clear());
        Box::pin(async { Ok(Some(StartedClear { action, run: None })) })
    }

    fn run_clear(
        &self,
        _viewer: FeedViewer,
        run: ClearRun,
        _stop: tokio_util::sync::CancellationToken,
    ) -> BoxFuture<'_, Result<ClearAction, FeedError>> {
        Box::pin(async move { Ok(run.action().clone()) })
    }

    fn clear_action(
        &self,
        _viewer: FeedViewer,
        id: Uuid,
    ) -> BoxFuture<'_, Result<Option<ClearAction>, FeedError>> {
        self.0.clear_reads.lock().unwrap().push(Some(id));
        Box::pin(async move { Ok(Some(clear_action(id, ClearStatus::Done, &email_clear()))) })
    }

    fn running_clears(
        &self,
        _viewer: FeedViewer,
    ) -> BoxFuture<'_, Result<Vec<ClearAction>, FeedError>> {
        self.0.clear_reads.lock().unwrap().push(None);
        Box::pin(async {
            Ok(vec![clear_action(
                Uuid::from_u128(0xC1EA),
                ClearStatus::Applying,
                &email_clear(),
            )])
        })
    }

    fn claim_stalled_clears(&self) -> BoxFuture<'_, Result<Vec<ClearRun>, FeedError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn undo_done(
        &self,
        _viewer: FeedViewer,
        scope: InboxScope,
        receipt: DoneReceipt,
    ) -> BoxFuture<'_, Result<Changes, FeedError>> {
        self.0.undos.lock().unwrap().push((scope, receipt));
        Box::pin(async { Ok(vec![InboxChange::Upserted(doc_entry())]) })
    }

    fn mark_seen(
        &self,
        _viewer: FeedViewer,
        scope: InboxScope,
        rows: Vec<InboxRowId>,
    ) -> BoxFuture<'_, Result<Changes, FeedError>> {
        self.0.seens.lock().unwrap().push((scope, rows));
        Box::pin(async { Ok(vec![InboxChange::Upserted(doc_entry())]) })
    }
}

/// Triggers a test drives by hand.
#[derive(Default, Clone)]
struct ManualTriggers {
    sender: Arc<Mutex<Option<tokio::sync::mpsc::Sender<FeedTrigger>>>>,
    subscribed: Arc<Mutex<Vec<(CandidateKeying, bool)>>>,
}

impl FeedTriggers for ManualTriggers {
    fn subscribe(
        &self,
        _user: MacroUserIdStr<'static>,
        keying: CandidateKeying,
        own_work: bool,
    ) -> tokio::sync::mpsc::Receiver<FeedTrigger> {
        let (sender, receiver) = tokio::sync::mpsc::channel(8);
        *self.sender.lock().unwrap() = Some(sender);
        self.subscribed.lock().unwrap().push((keying, own_work));
        receiver
    }
}

struct NoTeam;

impl FeedViewerResolver for NoTeam {
    fn team(
        &self,
        _user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>> {
        Box::pin(async { Ok(None) })
    }
}

/// A clear of unread email rows.
fn email_clear() -> InboxClearRequest {
    InboxClearRequest {
        scope: InboxScope {
            row_types: vec![InboxRowType::Email],
            unread_only: true,
        },
        since: None,
    }
}

/// Clear `id` of `request`'s rows, three rows in.
fn clear_action(id: Uuid, status: ClearStatus, request: &InboxClearRequest) -> ClearAction {
    ClearAction {
        id,
        status,
        scope: request.scope.clone(),
        since: request.since,
        as_of: at(30),
        rows: 3,
        notifications: 7,
        restored: if status == ClearStatus::Undone { 7 } else { 0 },
        revision: 4,
    }
}

fn context(
    service: &Arc<RecordingInboxService>,
    triggers: &ManualTriggers,
) -> NotificationInboxGraphqlContext {
    NotificationInboxGraphqlContext::new(
        Recording(Arc::clone(service)),
        Arc::new(triggers.clone()),
        Arc::new(NoTeam),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    )
}

fn viewer_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap()
}

#[tokio::test]
async fn notification_inbox_pages_groups_with_their_rows() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"{ user { notificationInbox(input: {
                        scope: { rowTypes: [DISCUSSION_THREAD, AGENT], unreadOnly: true },
                        limit: 10
                    }) {
                        nextCursor
                        nextPosition { sortAt entityId }
                        entries {
                            groupId sortAt
                            entity { __typename id }
                            rows {
                                id rowType threadId latestAt unseen count revision
                                actor { kind principalId name }
                                actions { kind targetId url }
                                notifications(limit: 1) { id eventType }
                            }
                        }
                    } } }"#,
                    authenticated_parts(),
                )
                .data(context(&service, &ManualTriggers::default())),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let page = &data["user"]["notificationInbox"];
    let entry = &page["entries"][0];

    assert_eq!(entry["groupId"], format!("document:{DOC_ID}"));
    assert_eq!(entry["sortAt"], at(7).to_rfc3339());
    assert_eq!(entry["entity"]["__typename"], "GraphqlSoupDocument");
    let row = &entry["rows"][0];
    assert_eq!(row["id"], format!("document:{DOC_ID}#thread:a"));
    assert_eq!(row["rowType"], "DISCUSSION_THREAD");
    assert_eq!(row["threadId"], "a");
    assert_eq!(row["latestAt"], at(7).to_rfc3339());
    assert_eq!(row["unseen"], true);
    assert_eq!(row["count"], 2);
    assert_eq!(
        row["actor"],
        serde_json::json!({ "kind": "USER", "principalId": VALID_USER_ID, "name": null })
    );
    assert_eq!(
        row["actions"],
        serde_json::json!([{ "kind": "OPEN", "targetId": null, "url": null }])
    );
    // The revision covers hidden notifications too.
    let revision = FeedRevision::decode(row["revision"].as_str().unwrap()).unwrap();
    assert_eq!(revision.attention_through, Some(at(7)));
    assert_eq!(row["notifications"].as_array().unwrap().len(), 1);
    assert!(page["nextCursor"].is_string());
    assert_eq!(page["nextPosition"]["entityId"], DOC_ID.to_string());
    assert_eq!(page["nextPosition"]["sortAt"], at(7).to_rfc3339());

    let pages = service.pages.lock().unwrap();
    assert_eq!(
        pages[0].scope.row_types,
        vec![InboxRowType::DiscussionThread, InboxRowType::Agent]
    );
    assert!(pages[0].scope.unread_only);
    assert_eq!(pages[0].limit, 10);
}

#[tokio::test]
async fn rows_are_marked_done_undone_and_seen() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let triggers = ManualTriggers::default();
    let row_id = thread_row_id().id();
    let revision = FeedRevision {
        attention_through: Some(at(6)),
    }
    .encode();

    let done = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ markNotificationInboxRowsDone(input: {{ rows: [
                            {{ id: "{row_id}", revision: "{revision}" }}
                        ] }}) {{ rowIds undoToken }} }}"#
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
        done["markNotificationInboxRowsDone"]["rowIds"],
        serde_json::json!([row_id])
    );
    let targets = service.dones.lock().unwrap()[0].clone();
    assert_eq!(targets[0].id, thread_row_id());
    assert_eq!(targets[0].revision.unwrap().attention_through, Some(at(6)));

    let undo_token = done["markNotificationInboxRowsDone"]["undoToken"]
        .as_str()
        .unwrap();
    let undo = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ undoNotificationInboxRowsDone(input: {{
                            undoToken: "{undo_token}", scope: {{ rowTypes: [DISCUSSION_THREAD] }}
                        }}) {{ patches {{ __typename
                            ... on NotificationInboxEntryUpserted {{ entry {{ groupId rows {{ id }} }} }}
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
        undo["undoNotificationInboxRowsDone"]["patches"][0]["entry"]["rows"][0]["id"],
        row_id
    );
    {
        let undos = service.undos.lock().unwrap();
        assert_eq!(undos[0].0.row_types, vec![InboxRowType::DiscussionThread]);
        assert_eq!(undos[0].1.notification_ids, vec![Uuid::from_u128(1)]);
    }

    let seen = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ markNotificationInboxRowsSeen(input: {{ rowIds: ["{row_id}"] }}) {{
                            patches {{ __typename }}
                        }} }}"#
                    ),
                    authenticated_parts(),
                )
                .data(viewer_id())
                .data(context(&service, &triggers)),
        )
        .await;
    assert!(seen.errors.is_empty(), "{:?}", seen.errors);
    assert_eq!(service.seens.lock().unwrap()[0].1, vec![thread_row_id()]);
}

#[tokio::test]
async fn one_notification_of_a_row_is_marked_done() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let triggers = ManualTriggers::default();
    let row_id = thread_row_id().id();
    let notification = Uuid::from_u128(7);

    let done = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ markNotificationInboxNotificationDone(input: {{
                            rowId: "{row_id}", notificationId: "{notification}",
                            scope: {{ rowTypes: [DISCUSSION_THREAD] }}
                        }}) {{ undoToken patches {{ __typename
                            ... on NotificationInboxEntryUpserted {{ entry {{ groupId }} }}
                        }} }} }}"#
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
        done["markNotificationInboxNotificationDone"]["patches"][0]["entry"]["groupId"],
        doc_group().id()
    );
    let token = done["markNotificationInboxNotificationDone"]["undoToken"]
        .as_str()
        .unwrap();
    assert_eq!(
        DoneReceipt::decode(token).unwrap().notification_ids,
        vec![notification]
    );
    let dones = service.notification_dones.lock().unwrap();
    assert_eq!(dones[0].0.row_types, vec![InboxRowType::DiscussionThread]);
    assert_eq!(dones[0].1, thread_row_id());
    assert_eq!(dones[0].2, notification);
}

#[tokio::test]
async fn the_inbox_is_cleared_in_one_call_and_undone_by_its_id() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let triggers = ManualTriggers::default();
    let run = |query: String| {
        harness.schema.execute(
            harness
                .request(&query, authenticated_parts())
                .data(viewer_id())
                .data(context(&service, &triggers)),
        )
    };
    let id = Uuid::from_u128(0xC1EA2);

    let cleared = run(format!(
        r#"mutation {{ clearNotificationInbox(input: {{
            clearId: "{id}",
            scope: {{ rowTypes: [EMAIL], unreadOnly: true }},
            since: "2024-06-01T00:00:00+02:00"
        }}) {{ rowCount undoToken complete nextCursor
              clear {{ clearId status rowTypes unreadOnly since asOf rowCount restoredCount revision }} }} }}"#
    ))
    .await;

    assert!(cleared.errors.is_empty(), "{:?}", cleared.errors);
    let cleared = cleared.data.into_json().unwrap();
    let payload = &cleared["clearNotificationInbox"];
    assert_eq!(payload["rowCount"], 3);
    assert_eq!(payload["complete"], true);
    assert!(payload["nextCursor"].is_null());
    assert_eq!(payload["undoToken"], format!("clear:{id}"));
    assert_eq!(
        payload["clear"],
        serde_json::json!({
            "clearId": id.to_string(),
            "status": "DONE",
            "rowTypes": ["EMAIL"],
            "unreadOnly": true,
            "since": "2024-05-31T22:00:00+00:00",
            "asOf": "2024-06-01T10:30:00+00:00",
            "rowCount": 3,
            "restoredCount": 0,
            "revision": 4,
        })
    );
    {
        let clears = service.clears.lock().unwrap();
        let (request, started) = &clears[0];
        assert_eq!(*started, id, "the caller's id names the clear");
        assert_eq!(request.scope.row_types, vec![InboxRowType::Email]);
        assert!(request.scope.unread_only);
    }

    let undone = run(format!(
        r#"mutation {{ undoNotificationInboxClear(input: {{ clearId: "{id}" }}) {{
            clear {{ clearId status restoredCount }} }} }}"#
    ))
    .await;
    assert!(undone.errors.is_empty(), "{:?}", undone.errors);
    assert_eq!(
        undone.data.into_json().unwrap()["undoNotificationInboxClear"]["clear"],
        serde_json::json!({ "clearId": id.to_string(), "status": "UNDONE", "restoredCount": 7 })
    );
    assert_eq!(*service.clear_undos.lock().unwrap(), vec![id]);
}

#[tokio::test]
async fn a_clears_undo_token_still_undoes_it_for_deployed_clients() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let triggers = ManualTriggers::default();
    let run = |query: String| {
        harness.schema.execute(
            harness
                .request(&query, authenticated_parts())
                .data(viewer_id())
                .data(context(&service, &triggers)),
        )
    };
    // A client from before clears had ids sends none and undoes by token.
    let cleared = run(
        r#"mutation { clearNotificationInbox(input: { scope: { rowTypes: [EMAIL] } }) { undoToken } }"#
            .to_string(),
    )
    .await;
    assert!(cleared.errors.is_empty(), "{:?}", cleared.errors);
    let token = cleared.data.into_json().unwrap()["clearNotificationInbox"]["undoToken"]
        .as_str()
        .unwrap()
        .to_string();
    let id = service.clears.lock().unwrap()[0].1;
    assert_eq!(token, format!("clear:{id}"));

    let undone = run(format!(
        r#"mutation {{ undoNotificationInboxRowsDone(input: {{
            undoToken: "{token}", scope: {{ rowTypes: [EMAIL] }}
        }}) {{ patches {{ __typename }} }} }}"#
    ))
    .await;
    assert!(undone.errors.is_empty(), "{:?}", undone.errors);
    assert_eq!(*service.clear_undos.lock().unwrap(), vec![id]);
    assert!(service.undos.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_clear_naming_no_row_types_is_rejected() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    // An empty list is what an inbox with every kind hidden sent; a missing
    // one names nothing either.
    for scope in ["scope: { rowTypes: [] }", "scope: { unreadOnly: true }", ""] {
        let response = harness
            .schema
            .execute(
                harness
                    .request(
                        &format!(
                            "mutation {{ clearNotificationInbox(input: {{ {scope} }}) {{ rowCount }} }}"
                        ),
                        authenticated_parts(),
                    )
                    .data(viewer_id())
                    .data(context(&service, &ManualTriggers::default())),
            )
            .await;
        assert!(!response.errors.is_empty(), "{scope}");
    }
    assert!(service.clears.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_viewer_reads_one_clear_or_those_still_running() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let triggers = ManualTriggers::default();
    let id = Uuid::from_u128(0xC1EA3);
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"query {{ user {{
                            one: notificationInboxClears(clearId: "{id}") {{ clearId status }}
                            running: notificationInboxClears {{ clearId status }}
                        }} }}"#
                    ),
                    authenticated_parts(),
                )
                .data(viewer_id())
                .data(context(&service, &triggers)),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["user"]["one"],
        serde_json::json!([{ "clearId": id.to_string(), "status": "DONE" }])
    );
    assert_eq!(data["user"]["running"][0]["status"], "APPLYING");
    let mut reads = service.clear_reads.lock().unwrap().clone();
    reads.sort();
    assert_eq!(reads, vec![None, Some(id)]);
}

#[tokio::test]
async fn done_rejects_a_row_id_that_names_no_row() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"mutation { markNotificationInboxRowsDone(input: { rows: [{ id: "document:x" }] }) { rowIds } }"#,
                    authenticated_parts(),
                )
                .data(viewer_id())
                .data(context(&service, &ManualTriggers::default())),
        )
        .await;
    assert_eq!(
        response.errors[0].message,
        "invalid notification inbox row id"
    );
    assert!(service.dones.lock().unwrap().is_empty());
}

#[tokio::test]
async fn notification_inbox_updates_batch_recomputed_patches() {
    let harness = harness();
    let service = Arc::new(RecordingInboxService::default());
    let triggers = ManualTriggers::default();
    let other =
        FeedKey::new(ModelEntityType::Chat.with_entity_string(Uuid::from_u128(0xC4A7).to_string()));

    let request = async_graphql::Request::new(
        r#"subscription { notificationInboxUpdates(scope: { rowTypes: [DISCUSSION_THREAD], unreadOnly: true }) {
            __typename
            ... on NotificationInboxEntryUpserted { entry { groupId rows { id } } }
            ... on NotificationInboxEntryRemoved { groupId }
            ... on NotificationInboxInvalidated { refresh }
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
            sender
                .send(FeedTrigger::Changed(vec![doc_group().into_entity()]))
                .await
                .unwrap();
            sender
                .send(FeedTrigger::Changed(vec![
                    other.into_entity(),
                    doc_group().into_entity(),
                ]))
                .await
                .unwrap();
            sender
        }
    });
    let response = responses.next().await.expect("patch batch");
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let patches = data["notificationInboxUpdates"].as_array().unwrap();
    assert_eq!(patches.len(), 2);
    assert_eq!(patches[0]["__typename"], "NotificationInboxEntryUpserted");
    assert_eq!(patches[1]["__typename"], "NotificationInboxEntryRemoved");
    assert_eq!(patches[1]["groupId"], other.id());
    {
        let recomputes = service.recomputes.lock().unwrap();
        assert_eq!(recomputes.len(), 1);
        assert!(recomputes[0].0.unread_only);
        assert_eq!(recomputes[0].1, vec![doc_group(), other.clone()]);
    }
    assert_eq!(
        triggers.subscribed.lock().unwrap().as_slice(),
        &[(CandidateKeying::FiledEntity, false)]
    );

    let sender = first.await.unwrap();
    sender.send(FeedTrigger::Invalidated).await.unwrap();
    let response = responses.next().await.expect("invalidation");
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["notificationInboxUpdates"][0]["__typename"],
        "NotificationInboxInvalidated"
    );

    drop(sender);
    *triggers.sender.lock().unwrap() = None;
    let response = responses.next().await.expect("closing error");
    assert!(!response.errors.is_empty());
}
