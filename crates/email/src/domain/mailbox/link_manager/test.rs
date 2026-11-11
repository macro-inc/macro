use super::super::lifecycle::InboxLifecycleError;
use super::*;
use fakes::*;
use models_email::service::pubsub::DeletionReason;

mod events;
mod fakes;

fn failure(outcome: LinkManagerDisposition) -> anyhow::Error {
    match outcome {
        LinkManagerDisposition::LeaveForRedelivery(error) => error,
        LinkManagerDisposition::DoneDelete => panic!("expected redelivery"),
    }
}

#[tokio::test]
async fn malformed_delivery_is_retained_without_effects() {
    let (service, fake) = service();
    let error = failure(service.process(Err(anyhow!("original decode error"))).await);
    assert_eq!(error.to_string(), "original decode error");
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn refresh_and_health_check_keep_their_distinct_probe_inputs() {
    for (message, refresh) in [
        (LinkManagerMessage::Refresh { link_id: LINK }, true),
        (LinkManagerMessage::HealthCheck { link_id: LINK }, false),
    ] {
        let (service, fake) = service();
        assert!(matches!(
            service.process(Ok(message)).await,
            LinkManagerDisposition::DoneDelete
        ));
        assert_eq!(fake.calls(), [Call::Probe(LINK, refresh)]);
    }
}

#[tokio::test(start_paused = true)]
async fn failed_and_stalled_probes_retain_their_original_errors() {
    for refresh in [false, true] {
        let (service, fake) = service();
        fake.0.lock().unwrap().fail = Some("probe");
        let message = if refresh {
            LinkManagerMessage::Refresh { link_id: LINK }
        } else {
            LinkManagerMessage::HealthCheck { link_id: LINK }
        };
        let error = failure(service.process(Ok(message)).await);
        assert!(matches!(
            error.downcast_ref(),
            Some(MailboxError::Persistence)
        ));
        assert_eq!(fake.calls(), [Call::Probe(LINK, refresh)]);
    }
    let (service, fake) = service();
    fake.0.lock().unwrap().stall_probe = true;
    let before = tokio::time::Instant::now();
    let error = failure(
        service
            .process(Ok(LinkManagerMessage::HealthCheck { link_id: LINK }))
            .await,
    );
    assert_eq!(error.to_string(), "inbox health probe timed out");
    assert_eq!(tokio::time::Instant::now() - before, PROBE_TIMEOUT);
    assert_eq!(fake.calls(), [Call::Probe(LINK, false)]);
}

#[tokio::test]
async fn absent_links_are_acknowledged_and_lookup_failures_are_retained() {
    for notify in [false, true] {
        for fail in [false, true] {
            let (service, fake) = service();
            {
                let mut state = fake.0.lock().unwrap();
                state.link = None;
                state.fail = fail.then_some("link");
            }
            let message = if notify {
                LinkManagerMessage::NotifyReauthRequired { link_id: LINK }
            } else {
                LinkManagerMessage::DeleteLink {
                    link_id: LINK,
                    deletion_reason: DeletionReason::Unused,
                }
            };
            let result = service.process(Ok(message)).await;
            if fail {
                assert_eq!(failure(result).to_string(), "link");
            } else {
                assert!(matches!(result, LinkManagerDisposition::DoneDelete));
            }
            assert_eq!(fake.calls(), [Call::Link(LINK)]);
        }
    }
}

#[tokio::test]
async fn reauthentication_notifies_selected_recipients_then_publishes_the_event() {
    let (service, fake) = service();
    fake.0.lock().unwrap().primaries = vec![
        "macro|delegate@example.com".into(),
        "malformed".into(),
        "macro|owner@example.com".into(),
        "macro|delegate@example.com".into(),
    ];
    assert!(matches!(
        service
            .process(Ok(LinkManagerMessage::NotifyReauthRequired {
                link_id: LINK
            }))
            .await,
        LinkManagerDisposition::DoneDelete
    ));
    let calls = fake.calls();
    assert_eq!(
        calls[0..2],
        [
            Call::Link(LINK),
            Call::Primaries("macro|owner@example.com".into(), LINK)
        ]
    );
    assert_eq!(
        calls[2],
        Call::Notify {
            owner: "macro|owner@example.com".into(),
            email: "owner@example.com".into(),
            recipients: vec![
                "macro|delegate@example.com".into(),
                "macro|owner@example.com".into()
            ],
        }
    );
    let Call::Event(value) = &calls[3] else {
        panic!("missing event")
    };
    assert_eq!(value["metadata"]["link_id"], LINK.to_string());
    assert_eq!(value["metadata"]["observed_at"], "2026-01-02T03:04:05Z");
    assert_eq!(calls.len(), 4);
}

#[tokio::test]
async fn reauthentication_stops_at_the_failed_effect_except_best_effort_event_publication() {
    for (point, count, expected) in [
        (
            "primaries",
            2,
            "Failed to fetch delegated primaries for reauth notification",
        ),
        ("notify", 3, "failed to send reauth notification: notify"),
        ("event", 4, ""),
    ] {
        let (service, fake) = service();
        fake.0.lock().unwrap().fail = Some(point);
        let result = service
            .process(Ok(LinkManagerMessage::NotifyReauthRequired {
                link_id: LINK,
            }))
            .await;
        if point == "event" {
            assert!(matches!(result, LinkManagerDisposition::DoneDelete));
        } else {
            let error = failure(result);
            assert_eq!(error.to_string(), expected);
            if point == "primaries" {
                assert_eq!(format!("{error:#}"), format!("{expected}: primaries"));
            }
        }
        assert_eq!(fake.calls().len(), count);
    }
}

#[tokio::test]
async fn missing_observation_time_is_sampled_after_notification_delivery() {
    let (service, fake) = service();
    fake.0
        .lock()
        .unwrap()
        .link
        .as_mut()
        .unwrap()
        .last_sync_error_at = None;
    assert!(matches!(
        service
            .process(Ok(LinkManagerMessage::NotifyReauthRequired {
                link_id: LINK
            }))
            .await,
        LinkManagerDisposition::DoneDelete
    ));
    let calls = fake.calls();
    let Call::Event(value) = &calls[3] else {
        panic!("missing event")
    };
    let observed: chrono::DateTime<chrono::Utc> =
        serde_json::from_value(value["metadata"]["observed_at"].clone()).unwrap();
    let notified = fake.0.lock().unwrap().notified_at.unwrap();
    assert!(observed >= notified);
    assert!(observed <= chrono::Utc::now());
}

#[tokio::test]
async fn deletion_preparation_controls_physical_deletion_for_every_reason() {
    for reason in [
        DeletionReason::Unused,
        DeletionReason::Inactive,
        DeletionReason::ManuallyDisabled,
        DeletionReason::UserDeleted,
        DeletionReason::AccessRevoked,
    ] {
        for ready in [false, true] {
            let (service, fake) = service();
            fake.0.lock().unwrap().ready = ready;
            assert!(matches!(
                service
                    .process(Ok(LinkManagerMessage::DeleteLink {
                        link_id: LINK,
                        deletion_reason: reason
                    }))
                    .await,
                LinkManagerDisposition::DoneDelete
            ));
            let mut expected = vec![
                Call::Link(LINK),
                Call::Prepare(LINK, reason.as_str().into()),
            ];
            if ready {
                expected.push(Call::Delete(LINK, reason.as_str().into()));
            }
            assert_eq!(fake.calls(), expected);
        }
    }
}

#[tokio::test]
async fn preparation_and_physical_deletion_errors_keep_the_delivery() {
    for (point, count) in [("prepare", 2), ("delete", 3)] {
        let (service, fake) = service();
        fake.0.lock().unwrap().fail = Some(point);
        let error = failure(
            service
                .process(Ok(LinkManagerMessage::DeleteLink {
                    link_id: LINK,
                    deletion_reason: DeletionReason::Unused,
                }))
                .await,
        );
        if point == "prepare" {
            assert!(matches!(
                error.downcast_ref(),
                Some(InboxLifecycleError::Unavailable)
            ));
        } else {
            assert_eq!(error.to_string(), "delete");
        }
        assert_eq!(fake.calls().len(), count);
    }
}

#[tokio::test]
async fn deleted_user_is_delegated_once_and_preserves_lifecycle_failures() {
    for fail in [false, true] {
        let (service, fake) = service();
        fake.0.lock().unwrap().fail = fail.then_some("deleted_user");
        let result = service
            .process(Ok(LinkManagerMessage::DeleteUser {
                fusionauth_user_id: "credential-owner".into(),
            }))
            .await;
        if fail {
            assert!(matches!(
                failure(result).downcast_ref(),
                Some(InboxLifecycleError::Unavailable)
            ));
        } else {
            assert!(matches!(result, LinkManagerDisposition::DoneDelete));
        }
        assert_eq!(fake.calls(), [Call::DeletedUser("credential-owner".into())]);
    }
}
