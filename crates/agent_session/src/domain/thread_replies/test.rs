use std::sync::Mutex;

use super::*;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission, EntityType};

struct FakeRepo {
    from_thread: bool,
    writes: Mutex<Vec<Option<String>>>,
}

impl FakeRepo {
    fn new(from_thread: bool) -> Self {
        Self {
            from_thread,
            writes: Mutex::new(Vec::new()),
        }
    }
}

impl ThreadRepliesRepo for FakeRepo {
    async fn thread_replies(&self, _session: AgentSessionId) -> Result<ThreadRepliesState> {
        Ok(ThreadRepliesState {
            from_thread: self.from_thread,
            paused: false,
        })
    }

    async fn set_thread_replies_paused(
        &self,
        _session: AgentSessionId,
        by: Option<&MacroUserIdStr<'static>>,
    ) -> Result<()> {
        self.writes
            .lock()
            .unwrap()
            .push(by.map(|user| user.as_ref().to_owned()));
        Ok(())
    }
}

fn editor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("editor@example.com").unwrap()
}

fn access(session: AgentSessionId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        editor(),
        Entity {
            entity_id: session.as_uuid().to_string().into(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn pausing_records_who_paused_and_resuming_clears_it() {
    let session = AgentSessionId::new();
    let service = ThreadRepliesService::new(FakeRepo::new(true));

    service.set_paused(&access(session), true).await.unwrap();
    service.set_paused(&access(session), false).await.unwrap();

    assert_eq!(
        *service.repo.writes.lock().unwrap(),
        vec![Some(editor().as_ref().to_owned()), None]
    );
}

#[tokio::test]
async fn a_session_not_started_from_a_thread_cannot_be_paused() {
    let session = AgentSessionId::new();
    let service = ThreadRepliesService::new(FakeRepo::new(false));

    let error = service
        .set_paused(&access(session), true)
        .await
        .unwrap_err();

    assert!(matches!(error, AgentSessionError::NotFromThread(id) if id == session));
    assert!(service.repo.writes.lock().unwrap().is_empty());
}
