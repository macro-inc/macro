use super::*;
use agent_session::{domain::model::AgentSessionId, testing::test_agent_session};
use ai_billing::domain::{
    DenyReason,
    admission::{AdmissionFuture, AiAdmissionError},
};
use ai_usage::UsageEvent;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn identity() -> ExecutionIdentity {
    let session = test_agent_session(AgentSessionId::TEST_A);
    ExecutionIdentity {
        session: session.id,
        owner: session.owner_user().unwrap().clone(),
        bot: session.bot_id,
        turn: macro_uuid::Uuid::from_u128(1),
    }
}
fn request() -> GenerationRequest {
    serde_json::from_value(serde_json::json!({"prompt":"Hello"})).unwrap()
}
struct Admission(Result<(), AiAdmissionError>);
impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            assert_eq!(user, &identity().owner);
            assert_eq!(feature, AiFeature::AgentSession);
            self.0
        })
    }
}
#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);
impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}
struct Provider {
    calls: AtomicUsize,
    invalid: bool,
}
#[async_trait]
impl CodeAiProvider for Provider {
    async fn generate(&self, _: &GenerationRequest) -> anyhow::Result<GenerationResult> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(GenerationResult {
            text: "Hi".into(),
            object: None,
            model: "test-model".into(),
            finish_reason: "stop".into(),
            usage: GenerationUsage {
                input_tokens: 100,
                output_tokens: 12,
                cache_read_tokens: 20,
                cache_write_tokens: 10,
            },
            error: self.invalid.then(|| "invalid output".into()),
        })
    }
}

#[tokio::test]
async fn quota_refusal_never_invokes_provider_or_records_fabricated_usage() {
    for error in [
        AiAdmissionError::Unavailable,
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
    ] {
        let provider = Arc::new(Provider {
            calls: AtomicUsize::new(0),
            invalid: false,
        });
        let recorder = Arc::new(Recorder::default());
        let service = CodeAiService::new(
            provider.clone(),
            Arc::new(Admission(Err(error))),
            recorder.clone(),
        );
        assert!(
            service
                .generate(&identity(), &request(), false)
                .await
                .is_err()
        );
        assert_eq!(provider.calls.load(Ordering::Relaxed), 0);
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn successful_and_invalid_completions_record_disjoint_usage_for_owner() {
    for invalid in [false, true] {
        let recorder = Arc::new(Recorder::default());
        let provider = Arc::new(Provider {
            calls: AtomicUsize::new(0),
            invalid,
        });
        let service = CodeAiService::new(provider, Arc::new(Admission(Ok(()))), recorder.clone());
        assert_eq!(
            service
                .generate(&identity(), &request(), false)
                .await
                .is_err(),
            invalid
        );
        let events = recorder.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].user, identity().owner);
        assert_eq!(events[0].feature, AiFeature::AgentSession);
        assert_eq!(
            events[0].amount,
            UsageAmount::Tokens {
                input: 70,
                output: 12,
                cache_read: 20,
                cache_write: 10
            }
        );
    }
}

#[tokio::test]
async fn invalid_requests_never_reach_provider() {
    let provider = Arc::new(Provider {
        calls: AtomicUsize::new(0),
        invalid: false,
    });
    let service = CodeAiService::new(
        provider.clone(),
        Arc::new(Admission(Ok(()))),
        Arc::new(Recorder::default()),
    );
    let mut input = request();
    assert!(service.generate(&identity(), &input, true).await.is_err());
    input.max_output_tokens = 4097;
    assert!(service.generate(&identity(), &input, false).await.is_err());
    input.max_output_tokens = 10;
    input.prompt = "x".repeat(65_537);
    assert!(service.generate(&identity(), &input, false).await.is_err());
    assert_eq!(provider.calls.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn caller_cancellation_keeps_completion_capacity_and_records_actual_usage() {
    struct PendingProvider {
        started: tokio::sync::Notify,
        finish: tokio::sync::Notify,
    }
    #[async_trait]
    impl CodeAiProvider for PendingProvider {
        async fn generate(&self, request: &GenerationRequest) -> anyhow::Result<GenerationResult> {
            self.started.notify_one();
            self.finish.notified().await;
            Provider {
                calls: AtomicUsize::new(0),
                invalid: false,
            }
            .generate(request)
            .await
        }
    }
    let provider = Arc::new(PendingProvider {
        started: tokio::sync::Notify::new(),
        finish: tokio::sync::Notify::new(),
    });
    let recorder = Arc::new(Recorder::default());
    let service = Arc::new(CodeAiService::new(
        provider.clone(),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    ));
    let caller = {
        let service = service.clone();
        tokio::spawn(async move { service.generate(&identity(), &request(), false).await })
    };
    provider.started.notified().await;
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    assert_eq!(service.completions.available_permits(), 15);
    provider.finish.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while service.completions.available_permits() != 16 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
}
