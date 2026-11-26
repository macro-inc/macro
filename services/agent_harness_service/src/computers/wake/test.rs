use std::sync::Mutex;

use agent_harness::testing::helpers::containers::ContainerMock;
use uuid::Uuid;

use super::*;

const BOT: BotId = BotId::new_from_uuid(Uuid::from_u128(0xb07));
const HARNESS: HarnessId = HarnessId::new_from_uuid(Uuid::from_u128(0x4a));

/// A bot whose runtime never answers, bound to `harness`.
struct Offline {
    harness: Option<HarnessId>,
    binds: Mutex<u32>,
}

impl Offline {
    fn bound_to(harness: Option<HarnessId>) -> Self {
        Self {
            harness,
            binds: Mutex::new(0),
        }
    }
}

impl RuntimeConnections for Offline {
    type Connector = ContainerMock;

    async fn bind(
        &self,
        _bot: BotId,
        _session: AgentSessionId,
    ) -> Option<RuntimeAttachment<ContainerMock>> {
        *self.binds.lock().unwrap() += 1;
        None
    }

    async fn bound_harness(&self, _bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        Ok(self.harness)
    }

    async fn access_facts(
        &self,
        _bot: BotId,
        _actor: Option<&MacroUserIdStr<'static>>,
    ) -> anyhow::Result<Option<RuntimeAccessFacts>> {
        Ok(None)
    }

    fn is_connected(&self, _harness: HarnessId) -> bool {
        false
    }

    fn connection_of(&self, _harness: HarnessId) -> Option<RuntimeConnectionId> {
        None
    }

    async fn sessions_on_harness(
        &self,
        _harness: HarnessId,
        _acp_sessions: &[SessionId],
    ) -> anyhow::Result<ListedSessions> {
        Ok(ListedSessions::default())
    }
}

/// Answers every wake with `outcome` and records the harnesses asked for.
struct Waker {
    outcome: DispatchWake,
    asked: Mutex<Vec<(HarnessId, Duration)>>,
}

impl Waker {
    fn answering(outcome: DispatchWake) -> Arc<Self> {
        Arc::new(Self {
            outcome,
            asked: Mutex::new(Vec::new()),
        })
    }
}

impl DispatchWaker for Waker {
    async fn wake_for_dispatch(
        &self,
        harness: HarnessId,
        timeout: Duration,
    ) -> Result<DispatchWake, ComputerError> {
        self.asked.lock().unwrap().push((harness, timeout));
        Ok(self.outcome)
    }
}

#[tokio::test]
async fn a_prompt_for_an_absent_runtime_wakes_its_computer_and_binds_again_once_macrod_dialed() {
    let waker = Waker::answering(DispatchWake::Connected);
    let connections =
        WakingConnections::new(Offline::bound_to(Some(HARNESS)), Some(Arc::clone(&waker)));

    // The runtime is still absent on this replica, so the second bind finds nothing either.
    assert!(connections.bind(BOT, AgentSessionId::new()).await.is_none());

    assert_eq!(
        *waker.asked.lock().unwrap(),
        vec![(HARNESS, DISPATCH_WAKE_TIMEOUT)]
    );
    assert_eq!(*connections.inner.binds.lock().unwrap(), 2);
}

#[tokio::test]
async fn a_computer_that_could_not_wake_leaves_the_prompt_waiting_without_binding_again() {
    for outcome in [
        DispatchWake::Waiting,
        DispatchWake::Awake,
        DispatchWake::NotAComputer,
    ] {
        let waker = Waker::answering(outcome);
        let connections =
            WakingConnections::new(Offline::bound_to(Some(HARNESS)), Some(Arc::clone(&waker)));
        assert!(connections.bind(BOT, AgentSessionId::new()).await.is_none());
        assert_eq!(waker.asked.lock().unwrap().len(), 1, "{outcome:?}");
        assert_eq!(*connections.inner.binds.lock().unwrap(), 1, "{outcome:?}");
    }
}

#[tokio::test]
async fn nothing_is_woken_for_an_unbound_bot_or_without_a_fleet() {
    let waker = Waker::answering(DispatchWake::Connected);
    let unbound = WakingConnections::new(Offline::bound_to(None), Some(Arc::clone(&waker)));
    assert!(unbound.bind(BOT, AgentSessionId::new()).await.is_none());
    assert!(waker.asked.lock().unwrap().is_empty());

    let no_fleet = WakingConnections::<_, Waker>::new(Offline::bound_to(Some(HARNESS)), None);
    assert!(no_fleet.bind(BOT, AgentSessionId::new()).await.is_none());
    assert_eq!(*no_fleet.inner.binds.lock().unwrap(), 1);
}
