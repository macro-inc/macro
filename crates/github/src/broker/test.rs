use macro_event_broker::TopicEvent;
use macro_event_broker::exposure::{Audience, EntityRef, Exposure, PublicEntityType, Stage};
use serde_json::json;

use super::GithubWebhookTopicEvent;
use crate::domain::models::{GithubWebhookReceived, GithubWebhookRepository, GithubWebhookSender};

fn delivery() -> GithubWebhookReceived {
    GithubWebhookReceived {
        delivery_id: Some("delivery-1".to_owned()),
        event: "workflow_run".to_owned(),
        action: Some("completed".to_owned()),
        installation_id: 42,
        repository: Some(GithubWebhookRepository {
            id: 7,
            full_name: "octo-org/app".to_owned(),
        }),
        sender: Some(GithubWebhookSender {
            login: "octocat".to_owned(),
            bot: false,
        }),
        payload: Some(json!({ "workflow_run": { "head_commit": { "message": "secret" } } })),
    }
}

#[test]
fn deliveries_reach_the_installation_with_event_action_and_repository_only() {
    let event = GithubWebhookTopicEvent::Received(delivery());
    let Exposure::Public(public) = event.exposure().expect("valid exposure") else {
        panic!("github_webhook.received must be public");
    };

    assert_eq!(public.name, "github_webhook.received");
    assert_eq!(public.stage, Stage::Preview);
    assert_eq!(
        public.entity,
        EntityRef::new(PublicEntityType::GithubInstallation, "42")
    );
    assert_eq!(
        public.audience,
        Audience::GithubInstallation {
            installation_id: "42".to_owned()
        }
    );
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        json!({
            "event_type": "github_webhook.received",
            "metadata": {
                "event": "workflow_run",
                "action": "completed",
                "repository": { "id": 7, "full_name": "octo-org/app" }
            }
        })
    );
}

#[test]
fn deliveries_without_action_or_repository_keep_nulls() {
    let mut push = delivery();
    push.event = "push".to_owned();
    push.action = None;
    push.repository = None;
    let event = GithubWebhookTopicEvent::Received(push);
    let Exposure::Public(public) = event.exposure().unwrap() else {
        panic!("public");
    };
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap()["metadata"],
        json!({ "event": "push", "action": null, "repository": null })
    );
}
