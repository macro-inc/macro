use super::super::test_support::*;
use super::*;
use serde_json::json;

#[tokio::test]
async fn pages_all_candidates_and_redelivery_deduplicates_using_owner_not_actor() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations = (0..5).map(|_| configuration()).collect();
    let access = Arc::new(Access::default());
    let service = EventAdmissionService::new(repo.clone(), access.clone(), 2.try_into().unwrap());
    let event = incoming();
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 5 }
    );
    assert_eq!(repo.0.lock().unwrap().pages.len(), 4);
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    assert_eq!(repo.0.lock().unwrap().pending.len(), 5);
    assert!(
        access
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|owner| owner == &user())
    );
}

#[tokio::test]
async fn partial_fanout_failure_is_not_acknowledged_and_replay_is_safe() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations = vec![configuration(), configuration()];
    repo.0.lock().unwrap().fail_page = Some(2);
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        1.try_into().unwrap(),
    );
    let event = incoming();
    assert!(service.ingest(&event).await.is_err());
    assert_eq!(repo.0.lock().unwrap().pending.len(), 1);
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 1 }
    );
    assert_eq!(repo.0.lock().unwrap().pending.len(), 2);
}

#[tokio::test]
async fn coarse_candidates_are_rechecked_before_access_or_admission() {
    let repo = Arc::new(Repo::default());
    let mut configs: Vec<_> = (0..5).map(|_| configuration()).collect();
    configs[0].enabled = false;
    configs[1].activated_at = Utc::now() + chrono::Duration::days(1);
    configs[2].filters =
        serde_json::from_value(json!([{"events":["document.updated"],"ids":[]}])).unwrap();
    configs[3].owner = Owner::Team(generate_uuid_v7());
    configs[4].owner =
        Owner::from_principal_str("bot|01900000-0000-7000-8000-000000000004").unwrap();
    repo.0.lock().unwrap().configurations = configs;
    let access = Arc::new(Access::default());
    let service = EventAdmissionService::new(repo, access.clone(), 100.try_into().unwrap());
    assert_eq!(
        service.ingest(&incoming()).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    assert!(access.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn permanent_rejections_do_not_query_candidates() {
    let repo = Arc::new(Repo::default());
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );
    let mut event = incoming();
    event.schema_version = 2;
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Rejected(EventRejection::UnsupportedSchema)
    );
    event.schema_version = 1;
    let super::super::super::event_trigger::EventPayload::Document(ref mut payload) = event.payload
    else {
        unreachable!()
    };
    *payload = serde_json::from_value(json!({"event_type":"document.updated", "metadata": {
        "document_id":generate_uuid_v7(),"share_permission_updated":false,
        "actor":"bot|01900000-0000-7000-8000-000000000004",
        "actor_user_id":"macro|event-actor@macro.com", "owner":"macro|event-actor@macro.com"
    }}))
    .unwrap();
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Rejected(EventRejection::UnsafeAttribution)
    );
    assert!(repo.0.lock().unwrap().pages.is_empty());
}

#[tokio::test]
async fn denied_and_mismatched_receipts_skip_but_unavailable_access_defers_intake() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations.push(configuration());
    let access = Arc::new(Access::default());
    let service = EventAdmissionService::new(repo.clone(), access.clone(), 10.try_into().unwrap());
    *access.denied.lock().unwrap() = true;
    assert_eq!(
        service.ingest(&incoming()).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    *access.denied.lock().unwrap() = false;
    *access.override_receipt.lock().unwrap() =
        Some(capability(user(), &incoming().normalize().unwrap()));
    assert_eq!(
        service.ingest(&incoming()).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    *access.unavailable.lock().unwrap() = true;
    assert!(service.ingest(&incoming()).await.is_err());
    assert!(repo.0.lock().unwrap().pending.is_empty());
}

#[tokio::test]
async fn mentions_mail_and_calls_only_admit_their_recipient_even_when_others_have_access() {
    use crate::domain::event_trigger::{EventPayload, MessageFact};
    for name in [
        "channel.mentioned",
        "email.message_received",
        "call.started",
        "call.ended",
    ] {
        let owner = user();
        let mut subscribed = configuration();
        subscribed.filters = serde_json::from_value(json!([{"events":[name]}])).unwrap();
        let mut other = subscribed.clone();
        other.action_id = generate_uuid_v7();
        other.owner = Owner::User(MacroUserIdStr::parse_from_str("macro|other@macro.com").unwrap());
        let action_id = subscribed.action_id;
        let repo = Arc::new(Repo::default());
        repo.0.lock().unwrap().configurations = vec![subscribed, other];
        repo.0
            .lock()
            .unwrap()
            .configurations
            .sort_by_key(|c| c.action_id);
        let access = Arc::new(Access::default());
        let service =
            EventAdmissionService::new(repo.clone(), access.clone(), 10.try_into().unwrap());
        let id = generate_uuid_v7();
        let payload = match name {
            "email.message_received" => EventPayload::Email(serde_json::from_value(json!({
                "event_type":"email.message_received", "metadata": {
                    "link_id": id, "owner": owner, "message_id": id, "thread_id": id,
                    "provider_message_id": "message", "provider_thread_id": "thread",
                    "is_new_thread": true, "to_emails": [], "attachment_count": 0, "is_spam_or_trash": false
                }
            })).unwrap()),
            "call.started" => EventPayload::Call(serde_json::from_value(json!({
                "event_type":"call.started", "metadata": {
                    "call_id": id, "channel_id": null, "created_by": owner,
                    "created_at": Utc::now(), "recording_enabled": false
                }
            })).unwrap()),
            "call.ended" => EventPayload::Call(serde_json::from_value(json!({
                "event_type":"call.record_archived", "metadata": {
                    "call_id": id, "channel_id": null, "created_by": "macro|host@macro.com",
                    "started_at": Utc::now(), "ended_at": Utc::now(), "duration_ms": 1_000,
                    "participant_count": 2, "participants": ["macro|host@macro.com", owner],
                    "has_recording": false, "archive_reason": "last_participant_left"
                }
            })).unwrap()),
            _ => EventPayload::Message(MessageFact::Mentioned(
                serde_json::from_value(json!({
                    "parent": {"type":"channel", "id": id}, "message_id": id, "root_id": id,
                    "sender": "macro|sender@macro.com", "content":"", "created_at": Utc::now(),
                    "mentioned": {"entity_type":"user", "entity_id": owner}
                }))
                .unwrap(),
            )),
        };
        let event = IncomingEvent {
            event_id: generate_uuid_v7(),
            schema_version: 1,
            routine_id: None,
            payload,
        };
        assert_eq!(
            service.ingest(&event).await.unwrap(),
            EventIngestionResult::Admitted { inserted: 1 }
        );
        assert_eq!(repo.0.lock().unwrap().pending[0].action_id, action_id);
        assert_eq!(*access.calls.lock().unwrap(), vec![owner]);
        assert_eq!(
            service.ingest(&event).await.unwrap(),
            EventIngestionResult::Admitted { inserted: 0 }
        );
    }
}

fn github_delivery(conclusion: &str, sender_type: &str) -> IncomingEvent {
    let body = json!({
        "action": "completed",
        "installation": { "id": 77 },
        "repository": { "id": 42, "full_name": "macro-inc/macro", "url": "https://api.github.com/x" },
        "sender": { "login": "octocat", "type": sender_type },
        "workflow_run": { "name": "CI", "conclusion": conclusion },
    });
    let delivery = github::domain::models::GithubWebhookReceived::from_delivery(
        Some("delivery".to_owned()),
        "workflow_run".to_owned(),
        &body,
    )
    .unwrap();
    IncomingEvent {
        event_id: generate_uuid_v7(),
        schema_version: 1,
        routine_id: None,
        payload: crate::domain::event_trigger::EventPayload::Github(
            github::broker::GithubWebhookTopicEvent::Received(delivery),
        ),
    }
}

fn failed_ci_routine() -> EventActionConfiguration {
    EventActionConfiguration {
        filters: serde_json::from_value(json!([{
            "events": ["github"],
            "github": {
                "events": ["workflow_run"],
                "actions": ["completed"],
                "repositories": ["Macro-Inc/macro"],
            },
            "match": [
                { "path": ["workflow_run", "name"], "equals": "CI" },
                { "path": ["workflow_run", "conclusion"], "equals": "failure" },
            ],
        }]))
        .unwrap(),
        ..configuration()
    }
}

#[tokio::test]
async fn github_deliveries_run_routines_whose_selector_and_payload_match() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations = vec![failed_ci_routine()];
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );

    for (event, inserted) in [
        (github_delivery("success", "User"), 0),
        (github_delivery("failure", "Bot"), 0),
        (github_delivery("failure", "User"), 1),
    ] {
        assert_eq!(
            service.ingest(&event).await.unwrap(),
            EventIngestionResult::Admitted { inserted }
        );
    }
    let pending = &repo.0.lock().unwrap().pending;
    assert!(matches!(
        pending[0].event.source(),
        EventSource::Github(delivery) if delivery.installation_id == 77
    ));
}

#[tokio::test]
async fn github_deliveries_need_a_claim_to_the_installation() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations = vec![failed_ci_routine()];
    let access = Arc::new(Access::default());
    *access.denied.lock().unwrap() = true;
    let service = EventAdmissionService::new(repo.clone(), access, 10.try_into().unwrap());

    assert_eq!(
        service
            .ingest(&github_delivery("failure", "User"))
            .await
            .unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
}

fn webhook_configuration(filters: serde_json::Value) -> EventActionConfiguration {
    EventActionConfiguration {
        filters: serde_json::from_value(filters).unwrap(),
        ..configuration()
    }
}

fn webhook(routine_id: Uuid, body: &str) -> EventReference {
    EventReference::webhook(
        crate::domain::event_trigger::WebhookDelivery::new(routine_id, body.as_bytes(), None)
            .unwrap(),
    )
}

#[tokio::test]
async fn a_webhook_delivery_is_admitted_to_its_routine_alone() {
    let repo = Arc::new(Repo::default());
    let addressed = webhook_configuration(json!([{ "events": ["webhook"] }]));
    let other = webhook_configuration(json!([{ "events": ["webhook"] }]));
    repo.0.lock().unwrap().configurations = vec![addressed.clone(), other];
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );

    let event = webhook(addressed.action_id, "Deploy finished");
    assert!(service.admit_webhook(&event).await.unwrap());

    let state = repo.0.lock().unwrap();
    assert_eq!(state.pending.len(), 1);
    assert_eq!(state.pending[0].action_id, addressed.action_id);
    assert_eq!(state.pending[0].event, event);
    // Nothing scanned for other routines.
    assert!(state.pages.is_empty());
}

#[tokio::test]
async fn a_webhook_delivery_is_refused_by_a_routine_not_taking_it() {
    let paused = EventActionConfiguration {
        enabled: false,
        ..webhook_configuration(json!([{ "events": ["webhook"] }]))
    };
    let not_watching = webhook_configuration(json!([{ "events": ["document.updated"] }]));
    let tested = webhook_configuration(json!([{
        "events": ["webhook"],
        "match": [{ "path": ["status"], "equals": "failed" }],
    }]));
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations =
        vec![paused.clone(), not_watching.clone(), tested.clone()];
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );

    for routine in [&paused, &not_watching] {
        assert!(
            !service
                .admit_webhook(&webhook(routine.action_id, "{}"))
                .await
                .unwrap()
        );
    }
    // A routine that was deleted has no configuration.
    assert!(
        !service
            .admit_webhook(&webhook(generate_uuid_v7(), "{}"))
            .await
            .unwrap()
    );
    // Payload tests read a JSON body; text never passes them.
    for body in [r#"{"status":"passed"}"#, "status: failed"] {
        assert!(
            !service
                .admit_webhook(&webhook(tested.action_id, body))
                .await
                .unwrap()
        );
    }
    assert!(
        service
            .admit_webhook(&webhook(tested.action_id, r#"{"status":"failed"}"#))
            .await
            .unwrap()
    );
    assert_eq!(repo.0.lock().unwrap().pending.len(), 1);
}

#[tokio::test]
async fn only_webhook_deliveries_are_admitted_by_address() {
    let service = EventAdmissionService::new(
        Arc::new(Repo::default()),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );

    assert!(
        service
            .admit_webhook(&incoming().normalize().unwrap())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn subscribed_github_events_admit_once_and_keep_the_payload_for_the_agent() {
    let registration: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../github/app-webhooks.json")).unwrap();
    for name in registration["default_events"].as_array().unwrap() {
        let name = name.as_str().unwrap();
        let repo = Arc::new(Repo::default());
        repo.0.lock().unwrap().configurations = vec![EventActionConfiguration {
            filters: serde_json::from_value(json!([{
                "events": ["github"],
                "github": { "events": [name], "repositories": ["example/repository"] },
                "match": [{ "path": ["ref"], "equals": "refs/heads/main" }],
            }]))
            .unwrap(),
            ..configuration()
        }];
        let access = Arc::new(Access::default());
        let service =
            EventAdmissionService::new(repo.clone(), access.clone(), 10.try_into().unwrap());
        let delivery = github::domain::models::GithubWebhookReceived::from_delivery(
            Some(format!("delivery-{name}")),
            name.to_owned(),
            &json!({
                "installation": { "id": 77 },
                "repository": { "id": 42, "full_name": "example/repository" },
                "ref": "refs/heads/main",
            }),
        )
        .unwrap();
        let event = IncomingEvent {
            event_id: generate_uuid_v7(),
            schema_version: 1,
            routine_id: None,
            payload: crate::domain::event_trigger::EventPayload::Github(
                github::broker::GithubWebhookTopicEvent::Received(delivery),
            ),
        };

        *access.denied.lock().unwrap() = true;
        assert_eq!(
            service.ingest(&event).await.unwrap(),
            EventIngestionResult::Admitted { inserted: 0 },
            "{name} must require an installation claim",
        );
        *access.denied.lock().unwrap() = false;
        assert_eq!(
            service.ingest(&event).await.unwrap(),
            EventIngestionResult::Admitted { inserted: 1 },
            "{name} must reach its matching routine",
        );
        // Replaying the same Kafka record must not run the routine twice.
        assert_eq!(
            service.ingest(&event).await.unwrap(),
            EventIngestionResult::Admitted { inserted: 0 },
        );
        let pending = &repo.0.lock().unwrap().pending;
        assert_eq!(pending.len(), 1);
        assert!(matches!(
            pending[0].event.source(),
            EventSource::Github(delivery)
                if delivery.installation_id == 77
                    && delivery.event == name
                    && delivery.payload.as_ref().unwrap()["ref"] == "refs/heads/main"
        ));
    }
}
