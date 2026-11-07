use std::sync::{Arc, Mutex};

use agent_session::domain::auto_archive::{
    AutoArchive, AutoArchiveOverrides, AutoArchivePreferences, SessionAutoArchive,
};
use agent_session::domain::error::Result;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::SessionTurnObserver;
use agent_session::domain::session::{CloseReason, StopReason};
use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::task::TaskTracker;

use super::ArchiveOnRuntimeClosed;

/// Records the sessions it was told closed; nothing else is reachable here.
struct RecordingArchive {
    closed: Arc<Mutex<Vec<AgentSessionId>>>,
}

impl AutoArchive for RecordingArchive {
    async fn preferences(&self, _user: &MacroUserIdStr<'static>) -> Result<AutoArchivePreferences> {
        unreachable!("only runtime_closed is under test")
    }

    async fn set_preferences(
        &self,
        _user: &MacroUserIdStr<'static>,
        _preferences: AutoArchivePreferences,
    ) -> Result<()> {
        unreachable!("only runtime_closed is under test")
    }

    async fn session_auto_archive(
        &self,
        _access: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SessionAutoArchive> {
        unreachable!("only runtime_closed is under test")
    }

    async fn set_session_overrides(
        &self,
        _access: &EntityAccessReceipt<OwnerAccessLevel>,
        _overrides: AutoArchiveOverrides,
    ) -> Result<()> {
        unreachable!("only runtime_closed is under test")
    }

    async fn pull_request_changed(&self, _github_key: &str) -> Result<Vec<AgentSessionId>> {
        unreachable!("only runtime_closed is under test")
    }

    async fn runtime_closed(&self, session: AgentSessionId) -> Result<bool> {
        self.closed.lock().unwrap().push(session);
        Ok(true)
    }
}

#[tokio::test]
async fn a_runtime_close_reaches_auto_archive_and_a_disconnect_does_not() {
    let closed = Arc::new(Mutex::new(Vec::new()));
    let tasks = TaskTracker::new();
    let observer = ArchiveOnRuntimeClosed::new(
        RecordingArchive {
            closed: closed.clone(),
        },
        tasks.clone(),
    );

    observer.session_stopped(
        AgentSessionId::TEST_A,
        StopReason::Closed(CloseReason::TransportClosed),
    );
    observer.runtime_closed(AgentSessionId::TEST_A);
    tasks.close();
    tasks.wait().await;

    assert_eq!(*closed.lock().unwrap(), vec![AgentSessionId::TEST_A]);
}
