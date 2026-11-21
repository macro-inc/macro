//! The credential binding must reach the journal before any program starts.
use super::*;
use agent_code_mode::domain::{
    CodeModeService, ExecutionCredentials, ExecutionIdentity, IssuedRun, ModelImage, ModelImages,
    SessionCodeMode, StaticFileId,
};
use agent_session::testing::test_agent_session;
use code_execution::domain::{
    ContextShape, ExecuteRequest, Outcome, ProgramExecutor, RunEnvironment,
};
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Journal {
    record: Mutex<Option<ExecutionRecord>>,
    refuse_save: bool,
}
#[async_trait]
impl ExecutionStore for Journal {
    async fn create(
        &self,
        _: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        assert_eq!(record.credential_correlation_id, None);
        *self.record.lock().unwrap() = Some(record.clone());
        Ok(())
    }
    async fn save(&self, _: AgentSessionId, record: &ExecutionRecord) -> Result<(), CodeModeError> {
        if self.refuse_save {
            return Err(CodeModeError::Storage(rootcause::report!(
                "binding save refused"
            )));
        }
        *self.record.lock().unwrap() = Some(record.clone());
        Ok(())
    }
    async fn get(
        &self,
        _: AgentSessionId,
        _: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.record
            .lock()
            .unwrap()
            .clone()
            .ok_or(CodeModeError::NotFound)
    }
}
struct Credentials;
#[async_trait]
impl ExecutionCredentials for Credentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        _: &str,
        _: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        Ok(IssuedRun {
            correlation_id: Uuid::from_u128(666),
            acting_user: identity.owner.clone(),
            environment: RunEnvironment::default(),
        })
    }
}
struct Runner {
    journal: Arc<Journal>,
    starts: Arc<AtomicUsize>,
}
#[async_trait]
impl ProgramExecutor for Runner {
    async fn check_program(
        &self,
        _: &ExecuteRequest,
        _: ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        assert_eq!(
            self.journal
                .record
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .credential_correlation_id,
            Some(Uuid::from_u128(666)),
            "the runner's first request already owns its recorded binding"
        );
        self.starts.fetch_add(1, Ordering::SeqCst);
        Outcome::Succeeded {
            value: json!({"data":42,"reviews":[]}),
        }
    }
}
struct NoImages;
#[async_trait]
impl ModelImages for NoImages {
    async fn load_png(
        &self,
        _: &StaticFileId,
        _: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage> {
        anyhow::bail!("this program returns no images")
    }
}

#[tokio::test]
async fn the_issued_binding_is_saved_before_the_runner_starts() {
    for refuse_save in [false, true] {
        let journal = Arc::new(Journal {
            refuse_save,
            ..Default::default()
        });
        let starts = Arc::new(AtomicUsize::new(0));
        let service = CodeModeService::new(
            Some(Arc::new(Runner {
                journal: journal.clone(),
                starts: starts.clone(),
            })),
            Arc::new(Credentials),
            journal.clone(),
            Arc::new(Turns),
            Arc::new(NoImages),
        );
        let session = test_agent_session(AgentSessionId::new_from_uuid(Uuid::from_u128(202)));
        let result = service
            .execute(
                &session,
                ExecutionId::from_uuid(Uuid::from_u128(102)),
                ai_toolset::actor::ToolActor::Owner,
                Uuid::from_u128(402),
                ExecuteRequest {
                    source: "export async function main() { return {data:42,reviews:[]}; }".into(),
                    timeout_ms: 1000,
                },
                CancellationToken::new(),
            )
            .await;
        if refuse_save {
            assert!(matches!(result, Err(CodeModeError::Storage(_))));
            assert_eq!(starts.load(Ordering::SeqCst), 0);
            assert_eq!(
                journal
                    .record
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .credential_correlation_id,
                None
            );
        } else {
            assert_eq!(
                result.unwrap().status,
                agent_code_mode::domain::ExecutionStatus::Succeeded
            );
            assert_eq!(starts.load(Ordering::SeqCst), 1);
        }
    }
}
