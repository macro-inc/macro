use super::*;
use ai_billing::domain::{AiAdmissionError, AiAdmissionService, DenyReason};
use ai_usage::AiFeature;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn user() -> MacroUserIdStr<'static> {
    user_id("macro|memory-test@example.com")
}

struct Admission {
    result: Mutex<Option<std::result::Result<(), AiAdmissionError>>>,
    calls: Mutex<Vec<(MacroUserIdStr<'static>, AiFeature)>>,
}

impl Admission {
    fn new(result: std::result::Result<(), AiAdmissionError>) -> Self {
        Self {
            result: Mutex::new(Some(result)),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = std::result::Result<(), AiAdmissionError>> + Send + 'a>,
    > {
        self.calls
            .lock()
            .unwrap()
            .push((user.clone().into_owned(), feature));
        Box::pin(async {
            self.result
                .lock()
                .unwrap()
                .take()
                .expect("only one admission")
        })
    }
}

#[derive(Clone, Default)]
struct Repo {
    record: Arc<Mutex<Option<MemoryRecord>>>,
    writes: Arc<AtomicUsize>,
}

impl Repo {
    fn cached(age: chrono::Duration) -> Self {
        Self {
            record: Arc::new(Mutex::new(Some(MemoryRecord {
                memory: "good cached memory".to_owned(),
                updated_at: Utc::now() - age,
            }))),
            ..Self::default()
        }
    }
}

impl MemoryRepo for Repo {
    async fn save_memory(
        &self,
        memory: &Memory,
        actor: MacroUserIdStr<'_>,
    ) -> super::super::Result<macro_uuid::Uuid> {
        assert_eq!(actor, user());
        self.writes.fetch_add(1, Ordering::SeqCst);
        *self.record.lock().unwrap() = Some(MemoryRecord {
            memory: memory.clone(),
            updated_at: Utc::now(),
        });
        Ok(macro_uuid::Uuid::now_v7())
    }

    async fn get_latest_memory(
        &self,
        actor: MacroUserIdStr<'_>,
    ) -> super::super::Result<Option<MemoryRecord>> {
        assert_eq!(actor, user());
        Ok(self
            .record
            .lock()
            .unwrap()
            .as_ref()
            .map(|record| MemoryRecord {
                memory: record.memory.clone(),
                updated_at: record.updated_at,
            }))
    }

    async fn get_memory_by_id(
        &self,
        _: MacroUserIdStr<'_>,
        _: macro_uuid::Uuid,
    ) -> super::super::Result<Memory> {
        panic!("generation must not fetch by id")
    }
}

fn unexpected_generation(_: Option<Memory>) -> std::future::Ready<super::super::Result<Memory>> {
    panic!("this read must not request admission or start generation")
}

#[tokio::test]
async fn fresh_memory_does_not_request_regeneration_or_admission() {
    let repo = Repo::cached(chrono::Duration::hours(1));
    let memory = read_memory_with_regeneration(&repo, user(), true, unexpected_generation)
        .await
        .unwrap();
    assert_eq!(memory.as_deref(), Some("good cached memory"));
    assert_eq!(repo.writes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn local_reads_do_not_regenerate_stale_or_missing_memory() {
    for repo in [Repo::cached(chrono::Duration::days(2)), Repo::default()] {
        let expected = repo
            .get_latest_memory(user())
            .await
            .unwrap()
            .map(|r| r.memory);
        let memory = read_memory_with_regeneration(&repo, user(), false, unexpected_generation)
            .await
            .unwrap();
        assert_eq!(memory, expected);
    }
}

#[tokio::test]
async fn blocked_stale_and_missing_memory_never_run_models_or_replace_cache() {
    for repo in [Repo::cached(chrono::Duration::days(2)), Repo::default()] {
        for failure in [
            AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
            AiAdmissionError::Unavailable(rootcause::report!("private billing failure")),
        ] {
            let unavailable = matches!(failure, AiAdmissionError::Unavailable(_));
            let admission = Arc::new(Admission::new(Err(failure)));
            let expected = repo.get_latest_memory(user()).await.unwrap();
            let expected_memory = expected.as_ref().map(|r| r.memory.clone());
            let expected_timestamp = expected.as_ref().map(|r| r.updated_at);
            let (finished, result) = tokio::sync::oneshot::channel();
            let memory = read_memory_with_regeneration(&repo, user(), true, |previous| {
                assert_eq!(previous, expected_memory);
                let admission = admission.clone();
                let repo = repo.clone();
                async move {
                    let result = generate_memory_with(&repo, admission.as_ref(), user(), async {
                        panic!("neither generation nor quality judge may run without admission")
                    })
                    .await;
                    let is_typed = match &result {
                        Err(MemoryError::Admission(AiAdmissionError::Unavailable(_))) => {
                            unavailable
                        }
                        Err(MemoryError::Admission(AiAdmissionError::Denied(
                            DenyReason::AllowanceExhausted,
                        ))) => !unavailable,
                        _ => false,
                    };
                    finished.send(is_typed).unwrap();
                    result
                }
            })
            .await
            .unwrap();
            assert_eq!(memory, expected_memory);
            assert!(result.await.unwrap(), "preserve the typed admission error");
            assert_eq!(
                *admission.calls.lock().unwrap(),
                vec![(user(), AiFeature::Memory)]
            );
            assert_eq!(repo.writes.load(Ordering::SeqCst), 0);
            let cached = repo.get_latest_memory(user()).await.unwrap();
            assert_eq!(cached.as_ref().map(|r| r.memory.clone()), expected_memory);
            assert_eq!(cached.map(|r| r.updated_at), expected_timestamp);
        }
    }
}

#[tokio::test]
async fn stale_and_missing_reads_return_before_background_generation_finishes() {
    for repo in [Repo::cached(chrono::Duration::days(2)), Repo::default()] {
        let expected = repo
            .get_latest_memory(user())
            .await
            .unwrap()
            .map(|r| r.memory);
        let admission = Arc::new(Admission::new(Ok(())));
        let (resume, pending) = tokio::sync::oneshot::channel();
        let (finished, result) = tokio::sync::oneshot::channel();
        let memory = read_memory_with_regeneration(&repo, user(), true, |previous| {
            assert_eq!(previous, expected);
            let repo = repo.clone();
            let admission = admission.clone();
            async move {
                let result = generate_memory_with(&repo, admission.as_ref(), user(), async {
                    pending.await.unwrap();
                    Ok("refreshed memory".to_owned())
                })
                .await;
                finished.send(()).unwrap();
                result
            }
        })
        .await
        .unwrap();
        assert_eq!(memory, expected);
        assert_eq!(repo.writes.load(Ordering::SeqCst), 0);
        resume.send(()).unwrap();
        result.await.unwrap();
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![(user(), AiFeature::Memory)]
        );
        assert_eq!(repo.writes.load(Ordering::SeqCst), 1);
        assert_eq!(
            repo.get_latest_memory(user())
                .await
                .unwrap()
                .unwrap()
                .memory,
            "refreshed memory"
        );
    }
}

#[tokio::test]
async fn one_admission_covers_generation_and_judge_before_saving() {
    let repo = Repo::default();
    let admission = Admission::new(Ok(()));
    let calls = Mutex::new(Vec::new());
    let memory = generate_memory_with(&repo, &admission, user(), async {
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![(user(), AiFeature::Memory)]
        );
        calls.lock().unwrap().push("generation");
        tokio::task::yield_now().await;
        calls.lock().unwrap().push("judge");
        assert_eq!(repo.writes.load(Ordering::SeqCst), 0);
        Ok("new memory".to_owned())
    })
    .await
    .unwrap();
    assert_eq!(memory, "new memory");
    assert_eq!(*calls.lock().unwrap(), vec!["generation", "judge"]);
    assert_eq!(admission.calls.lock().unwrap().len(), 1);
    assert_eq!(repo.writes.load(Ordering::SeqCst), 1);
    assert_eq!(
        repo.get_latest_memory(user())
            .await
            .unwrap()
            .unwrap()
            .memory,
        memory
    );
}

#[tokio::test]
async fn failed_generation_or_judge_keeps_existing_memory_without_retry() {
    for failure in [
        MemoryError::NoGeneration,
        MemoryError::Rejected("insufficient data".to_owned()),
    ] {
        let repo = Repo::cached(chrono::Duration::days(2));
        let admission = Admission::new(Ok(()));
        let result = generate_memory_with(&repo, &admission, user(), async { Err(failure) }).await;
        assert!(result.is_err());
        assert_eq!(admission.calls.lock().unwrap().len(), 1);
        assert_eq!(repo.writes.load(Ordering::SeqCst), 0);
        assert_eq!(
            repo.get_latest_memory(user())
                .await
                .unwrap()
                .unwrap()
                .memory,
            "good cached memory"
        );
    }
}

#[test]
fn generation_system_prompt_includes_previous_memory_when_present() {
    let prompt = build_generation_system_prompt(
        "base tools prompt",
        &user(),
        "Mon, 08 Jun 2026 12:00:00 +0000",
        Some("previous durable facts"),
    );
    assert!(prompt.contains("base tools prompt"));
    assert!(prompt.contains("<user_id>macro|memory-test@example.com</user_id>"));
    assert!(prompt.contains("<datetime>Mon, 08 Jun 2026 12:00:00 +0000</datetime>"));
    assert!(prompt.contains("<previous_memory>\nprevious durable facts\n</previous_memory>"));
}

#[test]
fn extract_memory_body_strips_surrounding_narration() {
    let content = "I have enough context. Let me write the memory.\n\
        <memory>\nEric is an engineer at Macro.\n</memory>\nDone!";
    assert_eq!(
        extract_memory_body(content),
        Some("Eric is an engineer at Macro.")
    );
}

#[test]
fn extract_memory_body_rejects_missing_tags() {
    assert_eq!(extract_memory_body("Eric is an engineer at Macro."), None);
    assert_eq!(extract_memory_body("<memory>unterminated"), None);
    assert_eq!(extract_memory_body("</memory>backwards<memory>"), None);
}

#[test]
fn extract_memory_body_uses_last_closing_tag() {
    assert_eq!(
        extract_memory_body("<memory>uses </memory> in prose</memory>"),
        Some("uses </memory> in prose")
    );
}

#[test]
fn generation_system_prompt_omits_previous_memory_when_absent() {
    let prompt = build_generation_system_prompt(
        "base tools prompt",
        &user(),
        "Mon, 08 Jun 2026 12:00:00 +0000",
        None,
    );
    assert!(!prompt.contains("<previous_memory>"));
}
