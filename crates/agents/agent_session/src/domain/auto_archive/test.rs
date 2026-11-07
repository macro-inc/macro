use std::sync::Mutex;

use super::*;
use crate::testing::RecordingRealtime;

struct FakeRepo {
    merged: Vec<AgentSessionId>,
    failing: AgentSessionId,
    archivable: AgentSessionId,
    attempts: Mutex<Vec<(AgentSessionId, AutoArchiveReason)>>,
}

impl AutoArchiveRepo for FakeRepo {
    async fn user_auto_archive_preferences(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<AutoArchivePreferences> {
        Ok(AutoArchivePreferences::default())
    }

    async fn set_user_auto_archive_preferences(
        &self,
        _user: &MacroUserIdStr<'static>,
        _preferences: AutoArchivePreferences,
    ) -> Result<()> {
        Ok(())
    }

    async fn session_auto_archive(&self, _session: AgentSessionId) -> Result<SessionAutoArchive> {
        Err(AgentSessionError::Forbidden)
    }

    async fn set_session_auto_archive_overrides(
        &self,
        _session: AgentSessionId,
        _overrides: AutoArchiveOverrides,
    ) -> Result<()> {
        Ok(())
    }

    async fn sessions_with_merged_pull_requests(
        &self,
        github_key: &str,
    ) -> Result<Vec<AgentSessionId>> {
        assert_eq!(github_key, "example/repo/pull/7");
        Ok(self.merged.clone())
    }

    async fn auto_archive(
        &self,
        session: AgentSessionId,
        reason: AutoArchiveReason,
    ) -> Result<bool> {
        self.attempts.lock().unwrap().push((session, reason));
        if session == self.failing {
            return Err(anyhow::anyhow!("database unavailable").into());
        }
        Ok(session == self.archivable)
    }
}

#[tokio::test]
async fn a_merged_pull_request_archives_every_ready_session_past_a_failing_one() {
    let failing = AgentSessionId::new();
    let busy = AgentSessionId::new();
    let archivable = AgentSessionId::new();
    let realtime = RecordingRealtime::new();
    let service = AutoArchiveService::new(
        FakeRepo {
            merged: vec![failing, busy, archivable],
            failing,
            archivable,
            attempts: Mutex::new(Vec::new()),
        },
        realtime.clone(),
    );

    let archived = service
        .pull_request_changed("example/repo/pull/7")
        .await
        .unwrap();

    assert_eq!(archived, [archivable]);
    assert_eq!(realtime.updated(), [archivable]);
    assert_eq!(
        *service.repo.attempts.lock().unwrap(),
        [
            (failing, AutoArchiveReason::PullRequestMerged),
            (busy, AutoArchiveReason::PullRequestMerged),
            (archivable, AutoArchiveReason::PullRequestMerged),
        ]
    );
}

#[tokio::test]
async fn a_closed_runtime_publishes_only_when_the_session_archived() {
    let archivable = AgentSessionId::new();
    let other = AgentSessionId::new();
    let realtime = RecordingRealtime::new();
    let service = AutoArchiveService::new(
        FakeRepo {
            merged: Vec::new(),
            failing: AgentSessionId::new(),
            archivable,
            attempts: Mutex::new(Vec::new()),
        },
        realtime.clone(),
    );

    assert!(!service.runtime_closed(other).await.unwrap());
    assert!(service.runtime_closed(archivable).await.unwrap());
    assert_eq!(realtime.updated(), [archivable]);
}
