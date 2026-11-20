use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_session::domain::model::{AgentSessionId, SessionSource, SessionVisibility};
use agent_session::domain::ports::{
    AgentSessionRepo, ExternalSessionRequester, RequestedExternalSession,
};
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use bot_id::BotId;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use tokio::sync::Notify;
use tokio_util::task::TaskTracker;

use super::{BrokerExternalSessionRequests, RuntimeUsers};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

/// A runtime that answers a session request the way macrod does: it creates
/// the row under the requested id itself, as a person's listed session; when
/// `opens` is set, only once told to. When `publishes` is set, the request
/// is only published, and the row only created, once told to.
#[derive(Clone)]
struct Runtime {
    sessions: InMemoryAgentSessionRepo,
    creates: AgentSessionId,
    bot: BotId,
    requests: Arc<Mutex<usize>>,
    opens: Option<Arc<Notify>>,
    publishes: Option<Arc<Notify>>,
    /// Whether the row it creates is someone else's.
    taken: bool,
}

impl MacroEventBroker for Runtime {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        *self.requests.lock().expect("requests") += 1;
        let mut session = test_agent_session(self.creates);
        session.bot_id = self.bot;
        session.owner_id = if self.taken {
            Owner::User(
                MacroUserIdStr::try_from("macro|other@example.com".to_string())
                    .expect("valid user id"),
            )
        } else {
            Owner::User(owner())
        };
        session.source = SessionSource::User;
        session.visibility = SessionVisibility::Listed;
        let sessions = self.sessions.clone();
        let opens = self.opens.clone();
        let publishes = self.publishes.clone();
        Ok(tokio::spawn(async move {
            if let Some(publishes) = publishes {
                publishes.notified().await;
            }
            tokio::spawn(async move {
                if let Some(opens) = opens {
                    opens.notified().await;
                }
                sessions.insert_session(session);
            });
            Ok(())
        }))
    }
}

/// Every bot's runtime answers to the owner.
struct Owners;

impl RuntimeUsers for Owners {
    async fn runtime_user_for_bot(
        &self,
        _bot: BotId,
    ) -> agent_session::domain::error::Result<Option<String>> {
        Ok(Some(owner().as_ref().to_owned()))
    }
}

/// A routine draft's session is a person's but hidden. The runtime creates
/// every session listed, so the requester records the hidden visibility on
/// the row: the session stays out of the person's list, and the routine's
/// delete takes it.
#[tokio::test]
async fn a_hidden_session_a_runtime_opens_is_recorded_hidden() {
    let sessions = InMemoryAgentSessionRepo::new();
    let session_id = AgentSessionId::new();
    let bot = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let runtime = Runtime {
        sessions: sessions.clone(),
        creates: session_id,
        bot,
        requests: Arc::default(),
        opens: None,
        publishes: None,
        taken: false,
    };
    let requests = BrokerExternalSessionRequests::new(
        runtime.clone(),
        sessions.clone(),
        Owners,
        TaskTracker::new(),
    );

    let opened = requests
        .request(RequestedExternalSession {
            session_id,
            bot_id: bot,
            owner: owner(),
            model: None,
            repo_url: None,
            source: SessionSource::User,
            visibility: SessionVisibility::Hidden,
            origin: trigger_context::TriggerOrigin::Requested { by: owner() },
        })
        .await
        .expect("opened");

    let stored = sessions.get(session_id).await.expect("stored");
    assert_eq!(opened.visibility, SessionVisibility::Hidden);
    assert_eq!(stored.visibility, SessionVisibility::Hidden);
    assert_eq!(stored.source, SessionSource::User);
    assert_eq!(*runtime.requests.lock().expect("requests"), 1);
}

/// A caller can stop waiting before the runtime creates the row, as when
/// the route times out or the connection drops: the row is still given the
/// requested visibility once it appears.
#[tokio::test(start_paused = true)]
async fn a_session_a_runtime_opens_after_its_caller_left_is_still_hidden() {
    let sessions = InMemoryAgentSessionRepo::new();
    let session_id = AgentSessionId::new();
    let bot = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let opens = Arc::new(Notify::new());
    let runtime = Runtime {
        sessions: sessions.clone(),
        creates: session_id,
        bot,
        requests: Arc::default(),
        opens: Some(opens.clone()),
        publishes: None,
        taken: false,
    };
    let requests =
        BrokerExternalSessionRequests::new(runtime, sessions.clone(), Owners, TaskTracker::new());
    let request = RequestedExternalSession {
        session_id,
        bot_id: bot,
        owner: owner(),
        model: None,
        repo_url: None,
        source: SessionSource::User,
        visibility: SessionVisibility::Hidden,
        origin: trigger_context::TriggerOrigin::Requested { by: owner() },
    };

    let waited = tokio::time::timeout(Duration::from_secs(30), requests.request(request)).await;
    assert!(
        waited.is_err(),
        "the caller gave up before the row appeared"
    );
    opens.notify_one();
    let mut stored = None;
    for _ in 0..20 {
        tokio::time::sleep(super::POLL_INTERVAL).await;
        if let Ok(session) = sessions.get(session_id).await
            && session.visibility == SessionVisibility::Hidden
        {
            stored = Some(session);
            break;
        }
    }

    let stored = stored.expect("the row ends up hidden");
    assert_eq!(stored.source, SessionSource::User);
}

/// A caller can stop waiting while the request is still being published:
/// the publication goes on without it, the runtime creates the row, and the
/// row is still given the requested visibility.
#[tokio::test(start_paused = true)]
async fn a_session_published_after_its_caller_left_is_still_hidden() {
    let sessions = InMemoryAgentSessionRepo::new();
    let session_id = AgentSessionId::new();
    let bot = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let publishes = Arc::new(Notify::new());
    let runtime = Runtime {
        sessions: sessions.clone(),
        creates: session_id,
        bot,
        requests: Arc::default(),
        opens: None,
        publishes: Some(publishes.clone()),
        taken: false,
    };
    let requests =
        BrokerExternalSessionRequests::new(runtime, sessions.clone(), Owners, TaskTracker::new());
    let request = RequestedExternalSession {
        session_id,
        bot_id: bot,
        owner: owner(),
        model: None,
        repo_url: None,
        source: SessionSource::User,
        visibility: SessionVisibility::Hidden,
        origin: trigger_context::TriggerOrigin::Requested { by: owner() },
    };

    let waited = tokio::time::timeout(Duration::from_secs(30), requests.request(request)).await;
    assert!(
        waited.is_err(),
        "the caller gave up before the request was published"
    );
    publishes.notify_one();

    let mut stored = None;
    for _ in 0..20 {
        tokio::time::sleep(super::POLL_INTERVAL).await;
        if let Ok(session) = sessions.get(session_id).await
            && session.visibility == SessionVisibility::Hidden
        {
            stored = Some(session);
            break;
        }
    }

    let stored = stored.expect("the row ends up hidden");
    assert_eq!(stored.source, SessionSource::User);
}

/// Counts the warnings logged while it is the default subscriber.
#[derive(Default)]
struct Warnings(std::sync::atomic::AtomicUsize);

impl tracing::Subscriber for Warnings {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _span: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        if *event.metadata().level() == tracing::Level::WARN {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn enter(&self, _span: &tracing::span::Id) {}

    fn exit(&self, _span: &tracing::span::Id) {}
}

/// A settle that fails after its caller left has nobody to answer: it is
/// logged, not lost.
#[tokio::test(start_paused = true)]
async fn a_settle_that_fails_after_its_caller_left_is_logged() {
    let warnings = Arc::new(Warnings::default());
    let _default = tracing::subscriber::set_default(warnings.clone());
    let sessions = InMemoryAgentSessionRepo::new();
    let session_id = AgentSessionId::new();
    let bot = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let opens = Arc::new(Notify::new());
    let runtime = Runtime {
        sessions: sessions.clone(),
        creates: session_id,
        bot,
        requests: Arc::default(),
        opens: Some(opens.clone()),
        publishes: None,
        taken: true,
    };
    let tasks = TaskTracker::new();
    let requests = BrokerExternalSessionRequests::new(runtime, sessions, Owners, tasks.clone());
    let request = RequestedExternalSession {
        session_id,
        bot_id: bot,
        owner: owner(),
        model: None,
        repo_url: None,
        source: SessionSource::User,
        visibility: SessionVisibility::Hidden,
        origin: trigger_context::TriggerOrigin::Requested { by: owner() },
    };

    let waited = tokio::time::timeout(Duration::from_secs(30), requests.request(request)).await;
    assert!(
        waited.is_err(),
        "the caller gave up before the row appeared"
    );
    opens.notify_one();
    tasks.close();
    tasks.wait().await;

    assert_eq!(warnings.0.load(std::sync::atomic::Ordering::SeqCst), 1);
}

/// Shutdown waits for sessions still settling only so long: a task that
/// hangs gives way, inside the stop's grace.
#[tokio::test(start_paused = true)]
async fn shutdown_waits_for_settling_sessions_only_so_long() {
    let finishing = TaskTracker::new();
    finishing.spawn(tokio::time::sleep(Duration::from_secs(5)));
    let hanging = TaskTracker::new();
    hanging.spawn(std::future::pending::<()>());
    let started = tokio::time::Instant::now();

    let finished = super::drain(&finishing, super::SHUTDOWN_DRAIN).await;
    let gave_up = tokio::time::timeout(
        Duration::from_secs(120),
        super::drain(&hanging, super::SHUTDOWN_DRAIN),
    )
    .await;

    assert!(finished);
    assert_eq!(gave_up, Ok(false), "a hanging settle gives way");
    assert!(
        started.elapsed() <= Duration::from_secs(70),
        "{:?}",
        started.elapsed()
    );
}
