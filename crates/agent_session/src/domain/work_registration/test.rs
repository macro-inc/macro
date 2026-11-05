use std::sync::Mutex;

use entity_access::domain::models::{Entity, EntityPermission};
use models_permissions::share_permission::access_level::AccessLevel;

use super::*;
use crate::domain::ports::SessionViewAccess;

fn account(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).unwrap()
}

fn registration_of(session: AgentSessionId, owner: &str) -> WorkRegistration {
    WorkRegistration {
        id: WorkRegistrationId::generate(),
        account_id: account(owner),
        session,
        registered_at: Utc::now(),
    }
}

fn edit_access(session: AgentSessionId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        account("macro|caller@example.com"),
        Entity {
            entity_id: session.to_string(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

#[derive(Clone, Default)]
struct FakeRepo {
    created: bool,
    unregistered: bool,
    active: Vec<WorkRegistration>,
    states: Vec<WorkRegistrationState>,
    due: Vec<EndedRegistration>,
    finished: Vec<AgentSessionId>,
}

impl WorkRegistrationRepo for FakeRepo {
    async fn register(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Result<Registered> {
        Ok(Registered {
            registration: registration_of(session, account.as_ref()),
            created: self.created,
        })
    }

    async fn unregister(
        &self,
        _account: &MacroUserIdStr<'static>,
        _session: AgentSessionId,
    ) -> Result<bool> {
        Ok(self.unregistered)
    }

    async fn active_registrations(
        &self,
        _accounts: &[MacroUserIdStr<'static>],
        _limit: u32,
    ) -> Result<Vec<WorkRegistration>> {
        Ok(self.active.clone())
    }

    async fn registration_states(
        &self,
        _accounts: &[MacroUserIdStr<'static>],
        _sessions: &[AgentSessionId],
        _ended_after: DateTime<Utc>,
    ) -> Result<Vec<WorkRegistrationState>> {
        Ok(self.states.clone())
    }

    async fn has_current_registrations(
        &self,
        _session: AgentSessionId,
        _ended_after: DateTime<Utc>,
    ) -> Result<bool> {
        Ok(true)
    }

    async fn end_for_finished_pull_requests(
        &self,
        _github_key: &str,
    ) -> Result<Vec<AgentSessionId>> {
        Ok(self.finished.clone())
    }

    async fn end_due_registrations(
        &self,
        _idle_before: DateTime<Utc>,
        _blocked_before: DateTime<Utc>,
        _limit: u32,
    ) -> Result<Vec<EndedRegistration>> {
        Ok(self.due.clone())
    }
}

#[derive(Clone, Default)]
struct RecordingSignal(Arc<Mutex<Vec<AgentSessionId>>>);

impl RecordingSignal {
    fn signalled(&self) -> Vec<AgentSessionId> {
        self.0.lock().unwrap().clone()
    }
}

impl WorkRegistrationSignal for RecordingSignal {
    async fn session_changed(&self, session: AgentSessionId) -> std::result::Result<(), Report> {
        self.0.lock().unwrap().push(session);
        Ok(())
    }
}

/// Answers from a fixed set; a session in `failing` fails the lookup.
struct ViewableSessions {
    viewable: Vec<AgentSessionId>,
    failing: Vec<AgentSessionId>,
}

impl SessionViewAccess for ViewableSessions {
    fn can_view<'a>(
        &'a self,
        _viewer: &'a MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>> {
        Box::pin(async move {
            if self.failing.contains(&session) {
                return Err(anyhow::anyhow!("access service unavailable").into());
            }
            Ok(self.viewable.contains(&session))
        })
    }
}

fn service(
    repo: FakeRepo,
    viewable: Vec<AgentSessionId>,
) -> (
    WorkRegistrationService<FakeRepo, RecordingSignal>,
    RecordingSignal,
) {
    let signal = RecordingSignal::default();
    let access = Arc::new(ViewableSessions {
        viewable,
        failing: Vec::new(),
    });
    (
        WorkRegistrationService::new(repo, access, signal.clone()),
        signal,
    )
}

#[tokio::test]
async fn registering_tells_viewers_only_when_it_created_the_registration() {
    let session = AgentSessionId::new();
    let caller = account("macro|caller@example.com");

    let (created, signal) = service(
        FakeRepo {
            created: true,
            ..FakeRepo::default()
        },
        Vec::new(),
    );
    created
        .register(&edit_access(session), &caller)
        .await
        .unwrap();
    assert_eq!(signal.signalled(), vec![session]);

    let (repeated, signal) = service(FakeRepo::default(), Vec::new());
    repeated
        .register(&edit_access(session), &caller)
        .await
        .unwrap();
    assert_eq!(signal.signalled(), Vec::new());
}

#[tokio::test]
async fn unregistering_tells_viewers_only_when_it_ended_something() {
    let session = AgentSessionId::new();
    let caller = account("macro|caller@example.com");

    let (ended, signal) = service(
        FakeRepo {
            unregistered: true,
            ..FakeRepo::default()
        },
        Vec::new(),
    );
    ended.unregister(&caller, session).await.unwrap();
    assert_eq!(signal.signalled(), vec![session]);

    let (repeated, signal) = service(FakeRepo::default(), Vec::new());
    repeated.unregister(&caller, session).await.unwrap();
    assert_eq!(signal.signalled(), Vec::new());
}

#[tokio::test]
async fn a_viewer_reads_only_registrations_of_sessions_it_can_view() {
    let viewable = AgentSessionId::new();
    let hidden = AgentSessionId::new();
    let failing = AgentSessionId::new();
    let shown = registration_of(viewable, "macro|agent@example.com");
    let repo = FakeRepo {
        active: vec![
            registration_of(hidden, "macro|agent@example.com"),
            shown.clone(),
            registration_of(failing, "macro|agent@example.com"),
        ],
        ..FakeRepo::default()
    };
    let access = Arc::new(ViewableSessions {
        viewable: vec![viewable],
        failing: vec![failing],
    });
    let service = WorkRegistrationService::new(repo, access, RecordingSignal::default());

    let visible = service
        .visible_registrations(
            &account("macro|viewer@example.com"),
            &[account("macro|agent@example.com")],
        )
        .await
        .unwrap();

    assert_eq!(visible, vec![shown]);
}

#[tokio::test]
async fn changes_name_only_what_the_viewer_can_view_and_refetch_for_the_rest() {
    let viewable = AgentSessionId::new();
    let hidden = AgentSessionId::new();
    let active = registration_of(viewable, "macro|agent@example.com");
    let ended = registration_of(viewable, "macro|agent@example.com");
    let on_archived = registration_of(viewable, "macro|other@example.com");
    let state = |registration: &WorkRegistration, ended: bool, session_archived: bool| {
        WorkRegistrationState {
            registration: registration.clone(),
            ended,
            session_archived,
        }
    };
    let repo = FakeRepo {
        states: vec![
            state(&ended, true, false),
            state(&active, false, false),
            state(&on_archived, false, true),
        ],
        ..FakeRepo::default()
    };
    let (service, _) = service(repo, vec![viewable]);
    let viewer = account("macro|viewer@example.com");
    let accounts = [account("macro|agent@example.com")];

    let changes = service
        .changes(&viewer, &accounts, &[viewable], Utc::now())
        .await
        .unwrap();
    assert_eq!(
        changes,
        WorkRegistrationChanges {
            active: vec![active],
            removed: vec![ended.id, on_archived.id],
            refetch: false,
        }
    );

    let revoked = registration_of(hidden, "macro|agent@example.com");
    let repo = FakeRepo {
        states: vec![state(&revoked, false, false), state(&revoked, true, false)],
        ..FakeRepo::default()
    };
    let (service, _) = self::service(repo, vec![viewable]);
    let changes = service
        .changes(&viewer, &accounts, &[hidden], Utc::now())
        .await
        .unwrap();
    assert_eq!(
        changes,
        WorkRegistrationChanges {
            active: Vec::new(),
            removed: Vec::new(),
            refetch: true,
        }
    );
}

#[tokio::test]
async fn a_sweep_counts_by_reason_and_tells_each_session_once() {
    let first = AgentSessionId::new();
    let second = AgentSessionId::new();
    let ended = |session, reason| EndedRegistration { session, reason };
    let repo = FakeRepo {
        due: vec![
            ended(first, WorkEndReason::Idle),
            ended(first, WorkEndReason::Idle),
            ended(second, WorkEndReason::BlockedTimeout),
            ended(second, WorkEndReason::PullRequestFinished),
            ended(second, WorkEndReason::SessionArchived),
        ],
        ..FakeRepo::default()
    };
    let (service, signal) = service(repo, Vec::new());

    let report = service.sweep().await.unwrap();

    assert_eq!(
        report,
        WorkRegistrationSweepReport {
            pull_request_finished: 1,
            session_archived: 1,
            idle: 2,
            blocked_timeout: 1,
        }
    );
    let signalled = signal.signalled();
    assert_eq!(signalled.len(), 2);
    assert!(signalled.contains(&first) && signalled.contains(&second));
}

#[tokio::test]
async fn a_finished_pull_request_tells_each_session_once() {
    let session = AgentSessionId::new();
    let repo = FakeRepo {
        finished: vec![session, session],
        ..FakeRepo::default()
    };
    let (service, signal) = service(repo, Vec::new());

    service.pull_request_changed("example/repo/pull/7").await.unwrap();

    assert_eq!(signal.signalled(), vec![session]);
}
