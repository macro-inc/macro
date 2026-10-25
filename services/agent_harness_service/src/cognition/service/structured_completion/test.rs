use super::*;
use ai_usage::{UsageAmount, UsageEvent};
use serde_json::json;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|one-shot@example.com".to_owned()).unwrap()
}

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

#[tokio::test]
async fn canceled_callers_keep_one_admitted_completion_and_its_accounting_alive() {
    let recorder = Arc::new(Recorder::default());
    let service = Arc::new(ToolFreeCompletionService::new(recorder.clone()));
    let started = Arc::new(tokio::sync::Notify::new());
    let finish = Arc::new(tokio::sync::Notify::new());
    let calls = Arc::new(AtomicUsize::new(0));
    let usage = UsageContext::new(AiFeature::DynamicCompletionsApi, owner());
    let metering = MeteringContext::new(
        ai_usage::financial::FinancialMode::Legacy,
        ai_usage::financial::FinancialCapability::Unavailable,
        usage.clone(),
        vec![],
    );
    let caller = tokio::spawn(MeteringContext::carry(Some(metering), {
        let service = service.clone();
        let started = started.clone();
        let finish = finish.clone();
        let calls = calls.clone();
        let recorder = recorder.clone();
        async move {
            service
                .run(async move {
                    assert!(
                        MeteringContext::current().is_some(),
                        "spawn lost metering context"
                    );
                    calls.fetch_add(1, Ordering::SeqCst);
                    started.notify_one();
                    finish.notified().await;
                    recorder.record(usage.into_event(
                        "test".into(),
                        UsageAmount::Tokens {
                            input: 7,
                            output: 2,
                            cache_read: 0,
                            cache_write: 0,
                        },
                    ));
                    Ok(json!({"answer": "done"}))
                })
                .await
        }
    }));
    started.notified().await;
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    assert_eq!(
        service.completions.available_permits(),
        MAX_CONCURRENT_COMPLETIONS - 1
    );
    let remaining = service
        .completions
        .clone()
        .try_acquire_many_owned(u32::try_from(MAX_CONCURRENT_COMPLETIONS - 1).unwrap())
        .unwrap();
    assert!(matches!(
        service
            .run(async { panic!("busy operation must not start") })
            .await,
        Err(ToolFreeCompletionError::Busy)
    ));
    finish.notify_one();
    let last = service.completions.acquire().await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user, owner());
    assert_eq!(events[0].feature, AiFeature::DynamicCompletionsApi);
    drop(events);
    drop(last);
    drop(remaining);
}

#[tokio::test(start_paused = true)]
async fn stalled_completions_are_bounded_and_release_capacity() {
    let service = ToolFreeCompletionService::new(Arc::new(Recorder::default()));
    let started = tokio::time::Instant::now();
    assert!(matches!(
        service.run(std::future::pending()).await,
        Err(ToolFreeCompletionError::Timeout)
    ));
    assert_eq!(tokio::time::Instant::now() - started, COMPLETION_TIMEOUT);
    assert_eq!(
        service.completions.available_permits(),
        MAX_CONCURRENT_COMPLETIONS
    );
}

#[tokio::test]
async fn real_completion_entrypoint_retains_activated_financial_scope() {
    let service = ToolFreeCompletionService::new(Arc::new(Recorder::default()));
    let metering = MeteringContext::new(
        ai_usage::financial::FinancialMode::Activated,
        ai_usage::financial::FinancialCapability::Unavailable,
        UsageContext::new(AiFeature::DynamicCompletionsApi, owner()),
        vec![],
    );
    let error = metering
        .scope(service.complete(
            owner(),
            ToolFreeRequest {
                model: "invalid/model".into(),
                system_prompt: "Return JSON.".into(),
                prompt: "Hello".into(),
                schema: DynamicSchema {
                    name: "Answer".into(),
                    schema: json!({"type": "object"}),
                    description: None,
                },
            },
        ))
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "structured completion failed: financial capability unavailable"
    );
}
