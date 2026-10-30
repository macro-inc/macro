use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::notification::NotificationEvent;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::ProduceNotification;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

struct FixedStanding(SessionStanding);

impl SessionStandings for FixedStanding {
    async fn standing(
        &self,
        _session_id: AgentSessionId,
    ) -> Result<SessionStanding, AgentSessionError> {
        Ok(self.0.clone())
    }
}

/// Connections as `(user, slug, display name)`.
struct Connections(Vec<(&'static str, &'static str, &'static str)>);

#[derive(Debug, thiserror::Error)]
#[error("unreachable")]
struct NeverFails;

impl ConnectedApps for Connections {
    type Err = NeverFails;

    async fn connected_app_name(
        &self,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<String>, NeverFails> {
        Ok(self
            .0
            .iter()
            .find(|(owner, slug, _)| *owner == user.as_ref() && *slug == app_slug)
            .map(|(_, _, name)| (*name).to_owned()))
    }
}

#[derive(Default)]
struct RecordedNotifications(Mutex<Vec<ProduceNotification>>);

impl SessionNotifications for RecordedNotifications {
    async fn produce(&self, notification: ProduceNotification) -> Result<(), AgentSessionError> {
        self.0.lock().unwrap().push(notification);
        Ok(())
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).expect("a valid user id")
}

#[tokio::test]
async fn the_owner_connecting_notion_wakes_the_session_with_an_app_connected_event() {
    let session_id = AgentSessionId::new();
    let report_id = AgentActionId::mint();
    let notifications = Arc::new(RecordedNotifications::default());
    let service = AppConnectedContinuation::new(
        Arc::new(FixedStanding(SessionStanding {
            owner: Some(user("owner@example.com")),
            archived: false,
        })),
        Arc::new(Connections(vec![(
            "macro|owner@example.com",
            "notion",
            "Notion",
        )])),
        Arc::clone(&notifications),
    );

    for _ in 0..2 {
        service
            .continue_session(
                session_id,
                &user("owner@example.com"),
                "notion",
                Some(report_id),
            )
            .await
            .unwrap();
    }

    let produced = notifications.0.lock().unwrap();
    assert_eq!(produced.len(), 2);
    let event = &produced[0];
    assert_eq!(event.session_id, session_id);
    assert_eq!(event.subject_id, "notion");
    assert!(event.wake);
    assert_eq!(
        event.event,
        NotificationEvent::AppConnected {
            app: "Notion".into()
        }
    );
    assert_eq!(
        event.dedupe_key, produced[1].dedupe_key,
        "a retried report produces the event once"
    );
}

#[tokio::test]
async fn someone_other_than_the_owner_cannot_continue_the_session() {
    let notifications = Arc::new(RecordedNotifications::default());
    let service = AppConnectedContinuation::new(
        Arc::new(FixedStanding(SessionStanding {
            owner: Some(user("owner@example.com")),
            archived: false,
        })),
        Arc::new(Connections(vec![(
            "macro|editor@example.com",
            "notion",
            "Notion",
        )])),
        Arc::clone(&notifications),
    );

    let result = service
        .continue_session(
            AgentSessionId::new(),
            &user("editor@example.com"),
            "notion",
            None,
        )
        .await;

    assert!(matches!(result, Err(AppConnectedError::NotOwner)));
    assert!(notifications.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_app_the_owner_has_not_connected_sends_nothing() {
    let notifications = Arc::new(RecordedNotifications::default());
    let service = AppConnectedContinuation::new(
        Arc::new(FixedStanding(SessionStanding {
            owner: Some(user("owner@example.com")),
            archived: false,
        })),
        Arc::new(Connections(vec![])),
        Arc::clone(&notifications),
    );

    let result = service
        .continue_session(
            AgentSessionId::new(),
            &user("owner@example.com"),
            "notion",
            None,
        )
        .await;

    assert!(matches!(result, Err(AppConnectedError::NotConnected(slug)) if slug == "notion"));
    assert!(notifications.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_archived_session_is_not_continued() {
    let notifications = Arc::new(RecordedNotifications::default());
    let service = AppConnectedContinuation::new(
        Arc::new(FixedStanding(SessionStanding {
            owner: Some(user("owner@example.com")),
            archived: true,
        })),
        Arc::new(Connections(vec![(
            "macro|owner@example.com",
            "notion",
            "Notion",
        )])),
        Arc::clone(&notifications),
    );

    let result = service
        .continue_session(
            AgentSessionId::new(),
            &user("owner@example.com"),
            "notion",
            None,
        )
        .await;

    assert!(matches!(result, Err(AppConnectedError::Archived)));
    assert!(notifications.0.lock().unwrap().is_empty());
}
