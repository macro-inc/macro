use std::collections::HashSet;
use std::sync::Mutex;

use bot_id::BotId;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::ManualNotificationAgent;
use notification::domain::models::{Notification, NotificationResult, SendNotificationRequest};
use notification::domain::service::{NotificationIngress, SendNotificationError};
use rootcause::Report;
use serde::Serialize;
use uuid::Uuid;

use super::{
    AgentProfiles, LinkAccess, ManualNotificationDraft, ManualNotificationError,
    ManualNotifications, ManualSender, SessionListing,
};

mod delivered;

/// Records every request as JSON, the way the SQS ingress would serialize it.
#[derive(Default)]
struct RecordingIngress {
    sent: Mutex<Vec<serde_json::Value>>,
}

impl NotificationIngress for RecordingIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        self.sent
            .lock()
            .unwrap()
            .push(serde_json::to_value(&req).unwrap());
        Ok(None)
    }
}

/// Grants view access to exactly the listed (user, entity id) pairs.
struct GrantedAccess(HashSet<(&'static str, &'static str)>);

impl LinkAccess for GrantedAccess {
    async fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<bool, Report> {
        Ok(self.0.iter().any(|(granted_user, granted_entity)| {
            user.as_ref() == *granted_user && entity.entity_id == *granted_entity
        }))
    }
}

/// Lists every session except `session-unlisted`.
struct ListedSessions;

impl SessionListing for ListedSessions {
    async fn is_listed(&self, session: &Entity<'_>) -> Result<bool, Report> {
        Ok(session.entity_id != "session-unlisted")
    }
}

/// Knows one agent, the one the sending code runs as.
struct OneAgent;

impl AgentProfiles for OneAgent {
    async fn profile(&self, agent_id: BotId) -> Result<Option<ManualNotificationAgent>, Report> {
        Ok(
            (agent_id.as_uuid() == Uuid::from_u128(0xB07)).then(|| ManualNotificationAgent {
                id: agent_id.as_uuid(),
                name: "Deploy bot".to_string(),
                avatar_url: None,
            }),
        )
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn service(
    grants: &[(&'static str, &'static str)],
) -> ManualNotifications<GrantedAccess, ListedSessions, OneAgent, RecordingIngress> {
    ManualNotifications {
        access: GrantedAccess(grants.iter().copied().collect()),
        sessions: ListedSessions,
        agents: OneAgent,
        ingress: RecordingIngress::default(),
    }
}

#[tokio::test]
async fn notifies_a_recipient_who_can_see_the_link_from_the_sender() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
    ]);

    notifications
        .send(
            ManualSender {
                user: user("macro|sender@macro.com"),
                agent_id: Some(BotId::new_from_uuid(Uuid::from_u128(0xB07))),
            },
            ManualNotificationDraft {
                recipient: Some(user("macro|teammate@macro.com")),
                title: "  Deploy finished ".to_string(),
                body: Some("All 3 services are live.".to_string()),
                link: EntityType::Document.with_entity_string("doc-1".to_string()),
            },
        )
        .await
        .unwrap();

    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    let request = &sent[0];
    assert_eq!(
        request["req"]["notification_entity"],
        serde_json::json!({ "entity_type": "document", "entity_id": "doc-1" })
    );
    assert_eq!(
        request["req"]["notification"],
        serde_json::json!({
            "tag": "manual",
            "content": {
                "title": "Deploy finished",
                "body": "All 3 services are live.",
                "agent": {
                    "id": "00000000-0000-0000-0000-000000000b07",
                    "name": "Deploy bot",
                },
            },
        })
    );
    assert_eq!(request["req"]["sender_id"], "macro|sender@macro.com");
    assert_eq!(
        request["req"]["recipient_ids"],
        serde_json::json!(["macro|teammate@macro.com"])
    );
    assert_eq!(
        request["build_apns"]["notif"]["aps"]["alert"],
        serde_json::json!({ "title": "Deploy finished", "body": "All 3 services are live." })
    );
    assert_eq!(request["send_conn_gateway"], true);
}

#[tokio::test]
async fn a_note_to_oneself_has_no_sender_so_the_ingress_keeps_it() {
    let notifications = service(&[("macro|sender@macro.com", "session-1")]);

    notifications
        .send(
            ManualSender {
                user: user("macro|sender@macro.com"),
                agent_id: None,
            },
            ManualNotificationDraft {
                recipient: None,
                title: "3 new leads".to_string(),
                body: Some("   ".to_string()),
                link: EntityType::AgentSession.with_entity_string("session-1".to_string()),
            },
        )
        .await
        .unwrap();

    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent[0]["req"]["sender_id"], serde_json::Value::Null);
    assert_eq!(
        sent[0]["req"]["recipient_ids"],
        serde_json::json!(["macro|sender@macro.com"])
    );
    assert_eq!(
        sent[0]["req"]["notification"],
        serde_json::json!({ "tag": "manual", "content": { "title": "3 new leads" } })
    );
}

#[tokio::test]
async fn never_tells_a_recipient_about_something_they_cannot_see() {
    let notifications = service(&[("macro|sender@macro.com", "doc-1")]);

    let error = notifications
        .send(
            ManualSender {
                user: user("macro|sender@macro.com"),
                agent_id: None,
            },
            ManualNotificationDraft {
                recipient: Some(user("macro|outsider@macro.com")),
                title: "Look at this".to_string(),
                body: None,
                link: EntityType::Document.with_entity_string("doc-1".to_string()),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ManualNotificationError::RecipientCannotSeeLink
    ));
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_a_link_the_sender_cannot_see() {
    let notifications = service(&[("macro|teammate@macro.com", "doc-1")]);

    let error = notifications
        .send(
            ManualSender {
                user: user("macro|sender@macro.com"),
                agent_id: None,
            },
            ManualNotificationDraft {
                recipient: Some(user("macro|teammate@macro.com")),
                title: "Look at this".to_string(),
                body: None,
                link: EntityType::Document.with_entity_string("doc-1".to_string()),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ManualNotificationError::LinkNotFound));
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_blank_or_oversized_text_and_unlinkable_entities() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|sender@macro.com", "user-1"),
    ]);
    let sender = || ManualSender {
        user: user("macro|sender@macro.com"),
        agent_id: None,
    };

    let blank = notifications
        .send(
            sender(),
            ManualNotificationDraft {
                recipient: None,
                title: " \n ".to_string(),
                body: None,
                link: EntityType::Document.with_entity_string("doc-1".to_string()),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(blank, ManualNotificationError::EmptyTitle));

    let long_title = notifications
        .send(
            sender(),
            ManualNotificationDraft {
                recipient: None,
                title: "a".repeat(121),
                body: None,
                link: EntityType::Document.with_entity_string("doc-1".to_string()),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(long_title, ManualNotificationError::TitleTooLong));

    let long_body = notifications
        .send(
            sender(),
            ManualNotificationDraft {
                recipient: None,
                title: "Done".to_string(),
                body: Some("é".repeat(1001)),
                link: EntityType::Document.with_entity_string("doc-1".to_string()),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(long_body, ManualNotificationError::BodyTooLong));

    let user_link = notifications
        .send(
            sender(),
            ManualNotificationDraft {
                recipient: None,
                title: "Done".to_string(),
                body: None,
                link: EntityType::User.with_entity_string("user-1".to_string()),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(
        user_link,
        ManualNotificationError::UnlinkableEntity(EntityType::User)
    ));

    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_links_the_inbox_and_home_never_list() {
    let notifications = service(&[
        ("macro|sender@macro.com", "routine-1"),
        ("macro|sender@macro.com", "database-1"),
        ("macro|sender@macro.com", "form-1"),
    ]);

    for (entity_type, id) in [
        (EntityType::ScheduledAction, "routine-1"),
        (EntityType::Database, "database-1"),
        (EntityType::Form, "form-1"),
    ] {
        let error = notifications
            .send(
                ManualSender {
                    user: user("macro|sender@macro.com"),
                    agent_id: None,
                },
                ManualNotificationDraft {
                    recipient: None,
                    title: "Done".to_string(),
                    body: None,
                    link: entity_type.with_entity_string(id.to_string()),
                },
            )
            .await
            .unwrap_err();
        assert!(
            matches!(error, ManualNotificationError::NotShownInInbox(refused) if refused == entity_type),
            "{entity_type}: {error:?}"
        );
    }

    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_an_agent_session_the_inbox_leaves_out() {
    let notifications = service(&[("macro|sender@macro.com", "session-unlisted")]);

    let error = notifications
        .send(
            ManualSender {
                user: user("macro|sender@macro.com"),
                agent_id: None,
            },
            ManualNotificationDraft {
                recipient: None,
                title: "Run finished".to_string(),
                body: None,
                link: EntityType::AgentSession.with_entity_string("session-unlisted".to_string()),
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        ManualNotificationError::UnlistedAgentSession
    ));
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}
