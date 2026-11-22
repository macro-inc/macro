use super::*;
use connectors::fake::{FakeConnection, FakeConnectors};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

async fn name(fake: &FakeConnectors, app_slug: &str) -> Option<String> {
    ConnectorsConnectedApps::new(Arc::new(fake.build()))
        .connected_app_name(&user(), app_slug)
        .await
        .expect("read")
}

/// A usable connection answers with its display name, through whichever
/// source counts for the app: the hosted catalog, the vendor's own server
/// for an overlaid app, or Macro Connect for a user on it.
#[tokio::test]
async fn a_usable_connection_answers_with_its_name() {
    let fake = FakeConnectors::new()
        .with_overlay("sentry", "https://mcp.sentry.dev/mcp")
        .with_connect_app("asana", false)
        .with_flag_on(&user())
        .with_connection(&user(), FakeConnection::app("stripe").named("Stripe"))
        .with_connection(&user(), FakeConnection::app("sentry").named("Sentry"))
        .with_connection(&user(), FakeConnection::app("asana").named("Asana"));

    assert_eq!(name(&fake, "stripe").await.as_deref(), Some("Stripe"));
    assert_eq!(name(&fake, "sentry").await.as_deref(), Some("Sentry"));
    assert_eq!(name(&fake, "asana").await.as_deref(), Some("Asana"));
}

/// A session waiting on an app is not continued until it can be used: a
/// connection turned off, or one needing authorization again, is not
/// connected, and neither is an app never connected.
#[tokio::test]
async fn an_unusable_app_is_not_connected() {
    let fake = FakeConnectors::new()
        .with_connection(&user(), FakeConnection::app("stripe").disabled())
        .with_connection(&user(), FakeConnection::app("github").needs_reauth());

    assert_eq!(name(&fake, "stripe").await, None);
    assert_eq!(name(&fake, "github").await, None);
    assert_eq!(name(&fake, "notion").await, None);
}

/// `slack_v2` and `slack` are one app.
#[tokio::test]
async fn an_aliased_slug_answers_for_the_app() {
    let fake =
        FakeConnectors::new().with_connection(&user(), FakeConnection::app("slack").named("Slack"));

    assert_eq!(name(&fake, "slack_v2").await.as_deref(), Some("Slack"));
}

/// A string that is not an app slug names nothing anyone connected.
#[tokio::test]
async fn a_string_that_is_not_a_slug_is_not_connected() {
    assert_eq!(name(&FakeConnectors::new(), "Not A Slug!").await, None);
}

// "Continue after connecting" end to end over the real connection services.

mod continuation {
    use super::*;
    use crate::domain::app_connections::{
        AppConnectedContinuation, AppConnectedError, SessionNotifications, SessionStanding,
        SessionStandings,
    };
    use agent_runtime_protocol::domain::notification::NotificationEvent;
    use agent_session::domain::error::AgentSessionError;
    use agent_session::domain::model::AgentSessionId;
    use agent_session::domain::notifications::ProduceNotification;
    use std::sync::Mutex;

    struct OwnedBy(MacroUserIdStr<'static>);

    impl SessionStandings for OwnedBy {
        async fn standing(
            &self,
            _session_id: AgentSessionId,
        ) -> Result<SessionStanding, AgentSessionError> {
            Ok(SessionStanding {
                owner: Some(self.0.clone()),
                archived: false,
            })
        }
    }

    #[derive(Default)]
    struct Recorded(Mutex<Vec<ProduceNotification>>);

    impl SessionNotifications for Recorded {
        async fn produce(
            &self,
            notification: ProduceNotification,
        ) -> Result<(), AgentSessionError> {
            self.0.lock().expect("lock").push(notification);
            Ok(())
        }
    }

    /// The session wakes once its owner's connection is usable, named as
    /// the connectors service names it, and not while it is turned off.
    #[tokio::test]
    async fn a_session_continues_only_once_the_app_is_usable() {
        let notifications = Arc::new(Recorded::default());
        let continuation = |fake: &FakeConnectors| {
            AppConnectedContinuation::new(
                Arc::new(OwnedBy(user())),
                Arc::new(ConnectorsConnectedApps::new(Arc::new(fake.build()))),
                Arc::clone(&notifications),
            )
        };

        let off = FakeConnectors::new()
            .with_connection(&user(), FakeConnection::app("notion").disabled());
        let refused = continuation(&off)
            .continue_session(AgentSessionId::new(), &user(), "notion", None)
            .await
            .expect_err("not connected");
        assert!(
            matches!(refused, AppConnectedError::NotConnected(_)),
            "{refused:?}"
        );
        assert!(notifications.0.lock().expect("lock").is_empty());

        let on = FakeConnectors::new()
            .with_connection(&user(), FakeConnection::app("notion").named("Notion"));
        continuation(&on)
            .continue_session(AgentSessionId::new(), &user(), "notion", None)
            .await
            .expect("continued");
        let produced = notifications.0.lock().expect("lock");
        assert_eq!(
            produced[0].event,
            NotificationEvent::AppConnected {
                app: "Notion".into()
            }
        );
    }
}
