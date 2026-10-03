use super::*;

fn service(
    repo: MockCallRepository,
    rtc: MockCallRtcClient,
) -> BaseWebhookCallService<StubConnectionService> {
    CallServiceImpl::new(
        repo,
        rtc,
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://example.com",
    )
}

#[tokio::test]
async fn preparation_creates_only_a_room_and_removes_failed_reservations() {
    for fails in [false, true] {
        let mut repo = MockCallRepository::new();
        repo.expect_insert_meeting_preparation()
            .times(1)
            .returning(|actor, preparation| {
                assert_eq!(actor, user(ARCHIVED_EVENT_CREATOR).as_ref());
                assert!(preparation.expires_at > Utc::now());
                Box::pin(async { Ok(()) })
            });
        repo.expect_cancel_meeting_preparation()
            .times(usize::from(fails))
            .returning(|_, _| Box::pin(async { Ok(true) }));
        repo.expect_create_meeting().never();
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_prepare_room().times(1).returning(move |_| {
            Box::pin(async move {
                if fails {
                    Err(anyhow::anyhow!("RTC unavailable"))
                } else {
                    Ok(())
                }
            })
        });
        rtc.expect_start_room_composite_egress().never();
        rtc.expect_dispatch_transcription_agent().never();
        assert_eq!(
            service(repo, rtc)
                .prepare_meeting(user(ARCHIVED_EVENT_CREATOR))
                .await
                .is_err(),
            fails
        );
    }
}

#[tokio::test]
async fn previous_nonempty_call_waits_for_identity_removal() {
    let active = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, None);
    let mut repo = MockCallRepository::new();
    repo.expect_find_active_call_for_user()
        .returning(|_| Box::pin(async { Ok(Some((ARCHIVED_EVENT_CALL_ID, None))) }));
    repo.expect_get_call_by_id()
        .return_once(move |_| Box::pin(async move { Ok(Some(active)) }));
    repo.expect_remove_participant()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    repo.expect_get_participant_count()
        .returning(|_| Box::pin(async { Ok(1) }));
    repo.expect_archive_call_if_empty().never();
    let (release, blocked) = tokio::sync::oneshot::channel();
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_remove_participant()
        .times(1)
        .return_once(move |_, _| {
            Box::pin(async move {
                blocked.await.unwrap();
                Ok(())
            })
        });
    rtc.expect_delete_room().never();
    let service = service(repo, rtc);
    let leaving = service.leave_other_active_call(user(ARCHIVED_EVENT_CREATOR), Uuid::now_v7());
    tokio::pin!(leaving);
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut leaving)
            .await
            .is_err()
    );
    release.send(()).unwrap();
    leaving.await.unwrap();
}

#[tokio::test]
async fn prepared_room_skips_external_creation_and_a_concurrent_join_does_not_delete_it() {
    let mut meeting = invitation_for_test();
    meeting.call_id = None;
    let call = started_event_call(user(ARCHIVED_EVENT_CREATOR).as_ref());
    let call_id = call.id;
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting_preparation()
        .times(1)
        .returning(move |_| {
            Box::pin(async move {
                Ok(Some(crate::domain::meetings::MeetingPreparation {
                    id: call_id,
                    expires_at: Utc::now() + chrono::Duration::minutes(5),
                }))
            })
        });
    repo.expect_get_or_create_meeting_call()
        .times(1)
        .return_once(move |_, candidate| {
            assert_eq!(*candidate, call_id);
            // Another first join has already won allocation of this same room.
            Box::pin(async move { Ok((call, false)) })
        });
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_create_room().never();
    rtc.expect_delete_room().never();
    assert_eq!(
        service(repo, rtc)
            .prepare_meeting_call(&meeting)
            .await
            .unwrap()
            .id,
        call_id
    );
}

#[tokio::test]
async fn cancelling_an_unowned_or_claimed_preparation_never_deletes_media() {
    for cancellable in [false, true] {
        let id = Uuid::now_v7();
        let mut repo = MockCallRepository::new();
        repo.expect_cancel_meeting_preparation()
            .times(1)
            .return_once(move |room, actor| {
                assert_eq!(*room, id);
                assert_eq!(actor, user(ARCHIVED_EVENT_CREATOR).as_ref());
                Box::pin(async move { Ok(cancellable) })
            });
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_delete_room()
            .times(usize::from(cancellable))
            .returning(|_| Box::pin(async { Ok(()) }));
        service(repo, rtc)
            .cancel_meeting_preparation(user(ARCHIVED_EVENT_CREATOR), id)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn previous_empty_call_cleanup_does_not_wait_for_media_teardown() {
    let active = active_call_for_archived_event(ARCHIVED_EVENT_CREATOR, Some("recording"));
    let mut archived = archived_call_for_event(ARCHIVED_EVENT_CREATOR, 1, true);
    archived.channel_id = None;
    let mut repo = MockCallRepository::new();
    repo.expect_find_active_call_for_user()
        .returning(|_| Box::pin(async { Ok(Some((ARCHIVED_EVENT_CALL_ID, None))) }));
    repo.expect_get_call_by_id()
        .return_once(move |_| Box::pin(async move { Ok(Some(active)) }));
    repo.expect_remove_participant()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    repo.expect_get_participant_count()
        .returning(|_| Box::pin(async { Ok(0) }));
    repo.expect_archive_call_if_empty()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(archived)) }));
    let (release, blocked) = tokio::sync::oneshot::channel();
    let (deleted, deletion) = tokio::sync::oneshot::channel();
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_remove_participant().never();
    rtc.expect_stop_egress().times(1).return_once(move |_| {
        Box::pin(async move {
            blocked.await.unwrap();
            Ok(())
        })
    });
    rtc.expect_delete_room().times(1).return_once(move |_| {
        Box::pin(async move {
            deleted.send(()).unwrap();
            Ok(())
        })
    });
    let service = service(repo, rtc);
    tokio::time::timeout(
        Duration::from_millis(200),
        service.leave_other_active_call(user(ARCHIVED_EVENT_CREATOR), Uuid::now_v7()),
    )
    .await
    .expect("archived media cleanup must not block a new join")
    .unwrap();
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), deletion)
        .await
        .unwrap()
        .unwrap();
}

/// Blocking external media startup must not hold the call/credentials path.
#[tokio::test]
async fn meeting_allocation_does_not_wait_for_recording_or_transcription() {
    let mut meeting = invitation_for_test();
    meeting.call_id = None;
    let call = started_event_call(user(ARCHIVED_EVENT_CREATOR).as_ref());
    let call_id = call.id;
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting_preparation()
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_get_or_create_meeting_call()
        .times(1)
        .return_once(move |_, _| Box::pin(async move { Ok((call, true)) }));
    let (release_agent, agent_wait) = tokio::sync::oneshot::channel();
    let (release_recorder, recorder_wait) = tokio::sync::oneshot::channel();
    let (attached, attachment) = tokio::sync::oneshot::channel();
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_create_room()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    rtc.expect_dispatch_transcription_agent()
        .times(1)
        .return_once(move |_| {
            Box::pin(async move {
                agent_wait.await.unwrap();
                Ok(())
            })
        });
    rtc.expect_start_room_composite_egress()
        .times(1)
        .return_once(move |_, _| {
            Box::pin(async move {
                recorder_wait.await.unwrap();
                Ok("egress".to_string())
            })
        });
    let mut background_repo = MockCallRepository::new();
    background_repo
        .expect_attach_meeting_recording()
        .times(1)
        .return_once(move |id, egress| {
            assert_eq!(*id, call_id);
            assert_eq!(egress, "egress");
            Box::pin(async move { Ok(true) })
        });
    background_repo
        .expect_get_call_by_id()
        .times(1)
        .return_once(move |_| {
            Box::pin(async move {
                attached.send(()).unwrap();
                Ok(Some(started_event_call(
                    user(ARCHIVED_EVENT_CREATOR).as_ref(),
                )))
            })
        });
    let service: BaseWebhookCallService<StubConnectionService> = CallServiceImpl::new(
        repo,
        rtc,
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://example.com",
    );
    let service = service.with_egress(test_egress_config());
    configure_repository_clone(&service.repo, background_repo);
    let prepared = tokio::time::timeout(
        Duration::from_millis(200),
        service.prepare_meeting_call(&meeting),
    )
    .await
    .expect("room allocation must not wait for media services")
    .unwrap();
    assert_eq!(prepared.id, call_id);
    // The recording progresses even though transcription is still blocked.
    release_recorder.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), attachment)
        .await
        .unwrap()
        .unwrap();
    release_agent.send(()).unwrap();
    tokio::task::yield_now().await;
}

#[tokio::test]
async fn late_meeting_recording_is_attached_before_it_is_stopped() {
    for attach_fails in [false, true] {
        let mut repo = MockCallRepository::new();
        let mut rtc = MockCallRtcClient::new();
        let mut sequence = mockall::Sequence::new();
        rtc.expect_start_room_composite_egress()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(|_, _| Box::pin(async { Ok("late-egress".to_string()) }));
        repo.expect_attach_meeting_recording()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(move |_, _| {
                Box::pin(async move {
                    if attach_fails {
                        Err(anyhow::anyhow!("database unavailable"))
                    } else {
                        Ok(false)
                    }
                })
            });
        rtc.expect_stop_egress()
            .with(mockall::predicate::eq("late-egress"))
            .times(1)
            .in_sequence(&mut sequence)
            .returning(|_| Box::pin(async { Ok(()) }));
        super::super::meetings::start_meeting_recording(
            &repo,
            &rtc,
            Uuid::now_v7(),
            "room",
            Some(&test_egress_config()),
        )
        .await;
    }
}

#[tokio::test]
async fn meeting_recording_stops_if_call_ends_just_after_attachment() {
    let mut repo = MockCallRepository::new();
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_start_room_composite_egress()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok("egress".to_string()) }));
    repo.expect_attach_meeting_recording()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(true) }));
    repo.expect_get_call_by_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    rtc.expect_stop_egress()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    super::super::meetings::start_meeting_recording(
        &repo,
        &rtc,
        Uuid::now_v7(),
        "room",
        Some(&test_egress_config()),
    )
    .await;
}

fn test_egress_config() -> EgressS3Config {
    EgressS3Config {
        bucket: "test".into(),
        region: "test".into(),
        access_key: "test".into(),
        secret: "test".into(),
    }
}

#[tokio::test]
async fn recording_webhook_can_link_before_the_startup_response() {
    for correct_room in [false, true] {
        let mut record = standalone_record(false);
        let call_id = record.call_id;
        let room_name = call_id.to_string();
        record.room_name = if correct_room {
            room_name.clone()
        } else {
            "different-room".to_string()
        };
        let mut repo = MockCallRepository::new();
        repo.expect_get_call_record_by_call_id()
            .times(1)
            .return_once(move |_| Box::pin(async move { Ok(Some(record)) }));
        repo.expect_attach_meeting_recording()
            .times(usize::from(correct_room))
            .returning(|_, _| Box::pin(async { Ok(false) }));
        let service: BaseWebhookCallService<StubConnectionService> = CallServiceImpl::new(
            repo,
            MockCallRtcClient::new(),
            StubConnectionService,
            NoOpEntityAccessService,
            StubNotificationIngress,
            StubRecordingStorage,
            "wss://example.com",
        );
        service
            .link_meeting_recording_webhook(Some(&room_name), Some("early-webhook-egress"))
            .await
            .unwrap();
    }
}
