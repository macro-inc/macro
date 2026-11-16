use std::sync::{Arc, Mutex};

use agent_session::domain::model::{AgentSessionId, SessionSource, SessionVisibility};
use agent_session::domain::ports::{
    AgentSessionRepo, ExternalSessionRequester, RequestedExternalSession,
};
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use bot_id::BotId;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

use super::{BrokerExternalSessionRequests, RuntimeUsers};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

/// A runtime that answers a session request the way macrod does: it creates
/// the row under the requested id itself, as a person's listed session.
#[derive(Clone)]
struct Runtime {
    sessions: InMemoryAgentSessionRepo,
    creates: AgentSessionId,
    bot: BotId,
    requests: Arc<Mutex<usize>>,
}

impl MacroEventBroker for Runtime {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        *self.requests.lock().expect("requests") += 1;
        let mut session = test_agent_session(self.creates);
        session.bot_id = self.bot;
        session.owner_id = Owner::User(owner());
        session.source = SessionSource::User;
        session.visibility = SessionVisibility::Listed;
        self.sessions.insert_session(session);
        Ok(tokio::spawn(async { Ok(()) }))
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
    };
    let requests = BrokerExternalSessionRequests::new(runtime.clone(), sessions.clone(), Owners);

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
