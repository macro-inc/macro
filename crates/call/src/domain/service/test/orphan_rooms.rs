use super::*;

const ORPHAN_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5c001);
const PREPARED_ROOM_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5c002);
const YOUNG_ORPHAN_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5c003);
const ORPHAN_CHANNEL_ID: Uuid = Uuid::from_u128(0x3f6f8b0a_6f9f_4a3f_9c3a_2b1e5d4c7c01);
const ORPHAN_GUEST_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5c004);
const STALE_JOINER: &str = "stale-joiner@example.com";

/// The archived record of a call whose room is named after its id.
fn archived_record(call_id: Uuid) -> CallRecord {
    let mut record = call_record_for_mutation();
    record.call_id = call_id;
    record.channel_id = Some(ORPHAN_CHANNEL_ID);
    record.room_name = Some(call_id.to_string());
    record
}

fn joined_webhook(
    room_name: &str,
    participant_identity: Option<&'static str>,
    guest_identity: Option<GuestId>,
) -> MockCallRtcClient {
    let event = CallWebhookEvent {
        guest_identity,
        event: "participant_joined".to_string(),
        id: "participant-joined-event-id".to_string(),
        room_name: Some(room_name.to_string()),
        participant_identity: participant_identity.map(|email| user(email).into_owned()),
        egress_id: None,
        file_url: None,
        created_at: 1_775_000_000,
    };
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_receive_webhook()
        .times(1)
        .return_once(move |_, _| Ok(event));
    rtc_client
}

/// No active call owns the room; the record lookup by its id answers `record`.
fn untracked_room_repo(record: Option<CallRecord>) -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_get_call_record_by_call_id()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(record) }));
    repo
}

async fn process_join(repo: MockCallRepository, rtc_client: MockCallRtcClient) {
    build_webhook_service(repo, rtc_client, RecordingEventBroker::default())
        .process_webhook_event("webhook-body", "webhook-token")
        .await
        .expect("participant-joined webhook succeeds");
}

#[tokio::test]
async fn user_joining_an_archived_call_room_is_removed_and_the_room_deleted() {
    let room_name = ORPHAN_CALL_ID.to_string();
    let mut rtc_client = joined_webhook(&room_name, Some(STALE_JOINER), None);
    rtc_client
        .expect_remove_participant()
        .withf(|room_name, identity| {
            room_name == ORPHAN_CALL_ID.to_string()
                && identity.as_ref() == user(STALE_JOINER).as_ref()
        })
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    rtc_client
        .expect_delete_room()
        .withf(|room_name| room_name == ORPHAN_CALL_ID.to_string())
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));

    let mut repo = untracked_room_repo(Some(archived_record(ORPHAN_CALL_ID)));
    // The stale joiner never becomes a participant of the archived call.
    repo.expect_add_participant().never();

    process_join(repo, rtc_client).await;
}

#[tokio::test]
async fn guest_joining_an_archived_call_room_is_removed_and_the_room_deleted() {
    let room_name = ORPHAN_CALL_ID.to_string();
    let guest_id = GuestId::from_uuid(ORPHAN_GUEST_ID);
    let mut rtc_client = joined_webhook(&room_name, None, Some(guest_id));
    rtc_client
        .expect_remove_guest()
        .withf(move |room_name, guest| {
            room_name == ORPHAN_CALL_ID.to_string() && *guest == guest_id
        })
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    rtc_client
        .expect_delete_room()
        .withf(|room_name| room_name == ORPHAN_CALL_ID.to_string())
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));

    let mut repo = untracked_room_repo(Some(archived_record(ORPHAN_CALL_ID)));
    repo.expect_reconcile_guest().never();

    process_join(repo, rtc_client).await;
}

#[tokio::test]
async fn joins_to_rooms_without_an_archived_call_are_left_alone() {
    let mut active = archived_record(ORPHAN_CALL_ID);
    active.is_active = true;
    let mut renamed_room = archived_record(ORPHAN_CALL_ID);
    renamed_room.room_name = Some(ORPHAN_CHANNEL_ID.to_string());
    // A meeting preparation or the get-or-create race's candidate room has no
    // record; an active record or one bound to a different room is not orphaned.
    for record in [None, Some(active), Some(renamed_room)] {
        let mut rtc_client = joined_webhook(&ORPHAN_CALL_ID.to_string(), Some(STALE_JOINER), None);
        rtc_client.expect_remove_participant().never();
        rtc_client.expect_delete_room().never();

        process_join(untracked_room_repo(record), rtc_client).await;
    }
}

#[tokio::test]
async fn joins_to_rooms_not_named_after_a_call_are_left_alone() {
    let mut rtc_client = joined_webhook("not-a-call-room", Some(STALE_JOINER), None);
    rtc_client.expect_remove_participant().never();
    rtc_client.expect_delete_room().never();
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_get_call_record_by_call_id().never();

    process_join(repo, rtc_client).await;
}

#[tokio::test]
async fn service_agents_joining_an_untracked_room_are_left_alone() {
    // Agent and egress identities parse to neither a user nor a guest.
    let mut rtc_client = joined_webhook(&ORPHAN_CALL_ID.to_string(), None, None);
    rtc_client.expect_remove_participant().never();
    rtc_client.expect_delete_room().never();
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_room_name().never();
    repo.expect_get_call_record_by_call_id().never();

    process_join(repo, rtc_client).await;
}

const SWEPT_ACTIVE_CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5c005);

fn rtc_room(name: String, minutes_old: i64) -> RtcRoom {
    RtcRoom {
        name,
        created_at: minutes_ago(minutes_old),
    }
}

#[tokio::test]
async fn sweep_deletes_only_archived_call_rooms_past_the_grace_period() {
    let active_room = SWEPT_ACTIVE_CALL_ID.to_string();
    let mut repo = MockCallRepository::new();
    repo.expect_list_active_calls().times(1).returning(|| {
        let call = Call {
            id: SWEPT_ACTIVE_CALL_ID,
            channel_id: None,
            room_name: SWEPT_ACTIVE_CALL_ID.to_string(),
            created_by: STARTED_EVENT_CREATOR.to_string(),
            created_at: minutes_ago(30),
            egress_id: None,
        };
        Box::pin(async move { Ok(vec![call]) })
    });
    // The active call is still occupied, so reconciliation keeps it.
    repo.expect_get_participants()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_get_active_guests()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_get_participant_count()
        .times(1)
        .returning(|_| Box::pin(async { Ok(1) }));
    repo.expect_get_call_record_by_call_id()
        .withf(|call_id| *call_id == ORPHAN_CALL_ID)
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(archived_record(ORPHAN_CALL_ID))) }));
    // An expired meeting preparation has no call record yet.
    repo.expect_get_call_record_by_call_id()
        .withf(|call_id| *call_id == PREPARED_ROOM_ID)
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));

    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_list_participant_identities()
        .withf(|room_name| room_name == SWEPT_ACTIVE_CALL_ID.to_string())
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(vec!["agent-transcriber".to_string()])) }));
    rtc_client
        .expect_list_rooms()
        .times(1)
        .return_once(move || {
            let rooms = vec![
                rtc_room(active_room, 30),
                rtc_room(ORPHAN_CALL_ID.to_string(), 10),
                // Too new: the join webhook or the archival teardown may still act.
                rtc_room(YOUNG_ORPHAN_CALL_ID.to_string(), 0),
                rtc_room(PREPARED_ROOM_ID.to_string(), 10),
                rtc_room("not-a-call-room".to_string(), 10),
            ];
            Box::pin(async move { Ok(rooms) })
        });
    rtc_client
        .expect_delete_room()
        .withf(|room_name| room_name == ORPHAN_CALL_ID.to_string())
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));

    build_webhook_service(repo, rtc_client, RecordingEventBroker::default())
        .reconcile_stale_calls()
        .await
        .expect("reconciliation succeeds");
}

#[tokio::test]
async fn failed_room_listing_does_not_fail_reconciliation() {
    let mut repo = MockCallRepository::new();
    repo.expect_list_active_calls()
        .times(1)
        .returning(|| Box::pin(async { Ok(Vec::new()) }));
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_list_rooms()
        .times(1)
        .returning(|| Box::pin(async { Err(anyhow::anyhow!("RTC unavailable")) }));
    rtc_client.expect_delete_room().never();

    build_webhook_service(repo, rtc_client, RecordingEventBroker::default())
        .reconcile_stale_calls()
        .await
        .expect("a failed room sweep does not fail call reconciliation");
}

/// No active call in the channel; its latest call is `latest`.
fn leave_repo(latest: CallRecord) -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_channel_id()
        .withf(|channel_id| *channel_id == ORPHAN_CHANNEL_ID)
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_get_call_records_by_user()
        .withf(|user_id, limit, filter, page| {
            user_id.as_ref() == user(STALE_JOINER).as_ref()
                && *limit == 1
                && matches!(
                    filter.as_deref(),
                    Some(filter_ast::Expr::Literal(
                        item_filters::ast::call::CallLiteral::ChannelId(channel_id)
                    )) if *channel_id == ORPHAN_CHANNEL_ID
                )
                && page.by_start
                && page.after.is_none()
        })
        .times(1)
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(vec![latest]) }));
    repo.expect_remove_participant().never();
    repo
}

async fn leave(repo: MockCallRepository, rtc_client: MockCallRtcClient) {
    let result = build_webhook_service(repo, rtc_client, RecordingEventBroker::default())
        .leave_or_end_call(&ORPHAN_CHANNEL_ID, user(STALE_JOINER))
        .await;
    assert!(matches!(result, Err(CallError::NotFound(_))));
}

#[tokio::test]
async fn leave_without_an_active_call_removes_the_user_from_the_archived_room() {
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_list_participant_identities()
        .withf(|room_name| room_name == ORPHAN_CALL_ID.to_string())
        .times(1)
        .returning(|_| Box::pin(async { Ok(Some(vec![user(STALE_JOINER).as_ref().to_string()])) }));
    rtc_client
        .expect_remove_participant()
        .withf(|room_name, identity| {
            room_name == ORPHAN_CALL_ID.to_string()
                && identity.as_ref() == user(STALE_JOINER).as_ref()
        })
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));

    leave(leave_repo(archived_record(ORPHAN_CALL_ID)), rtc_client).await;
}

#[tokio::test]
async fn leave_without_an_active_call_leaves_rooms_the_user_is_not_in() {
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client
        .expect_list_participant_identities()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    rtc_client.expect_remove_participant().never();

    leave(leave_repo(archived_record(ORPHAN_CALL_ID)), rtc_client).await;
}

#[tokio::test]
async fn leave_without_an_active_call_ignores_a_still_active_latest_call() {
    let mut latest = archived_record(ORPHAN_CALL_ID);
    latest.is_active = true;
    let mut rtc_client = MockCallRtcClient::new();
    rtc_client.expect_list_participant_identities().never();
    rtc_client.expect_remove_participant().never();

    leave(leave_repo(latest), rtc_client).await;
}
