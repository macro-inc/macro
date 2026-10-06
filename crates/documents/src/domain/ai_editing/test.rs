use super::*;
use crate::domain::ports::editing::{EditUsage, MockEditingWorkerService};
use ai_billing::domain::{DenyReason, admission::AdmissionFuture};
use ai_usage::{UsageAmount, UsageEvent};
use entity_access::domain::models::{Entity, EntityPermission, EntityType};
use models_permissions::share_permission::access_level::AccessLevel;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
fn user() -> MacroUserIdStr<'static> {
    "macro|editor@example.com".to_owned().try_into().unwrap()
}
fn receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}
fn token() -> DocumentPermissionToken {
    DocumentPermissionToken::from("test-scoped-token".to_owned())
}
fn request(token: &DocumentPermissionToken) -> AiEditRequest<'_> {
    AiEditRequest {
        document_token: token,
        instructions: "edit",
        mode: EditMode::Fast,
        editor: EditorName::new("Macro"),
    }
}

struct Admission(Result<(), AiAdmissionError>);
impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            assert_eq!(caller, &user());
            assert_eq!(feature, AiFeature::AiEditing);
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

#[tokio::test]
async fn refusal_never_calls_worker_or_records_usage() {
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ] {
        let recorder = Arc::new(Recorder::default());
        let service = AiEditingService::new(
            Arc::new(MockEditingWorkerService::new()),
            Arc::new(Admission(Err(error))),
            recorder.clone(),
        );
        assert!(
            matches!(service.edit(receipt(), &user(), request(&token())).await, Err(AiEditError::Admission(actual)) if actual == error)
        );
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn admitted_edit_keeps_worker_arguments_and_each_models_usage() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_edit()
        .times(1)
        .returning(|id, token, instructions, mode, editor| {
            assert_eq!(id, DOCUMENT);
            assert_eq!(token.as_str(), "test-scoped-token");
            assert_eq!(instructions, "edit");
            assert_eq!(mode, EditMode::Fast);
            assert_eq!(editor, EditorName::new("Macro"));
            Box::pin(async {
                Ok(EditResult {
                    edits_applied: 0,
                    clarification: Some("Which paragraph?".into()),
                    usage: vec![
                        EditUsage {
                            model: "model-a".into(),
                            input_tokens: 12,
                            output_tokens: 3,
                        },
                        EditUsage {
                            model: "model-b".into(),
                            input_tokens: 14,
                            output_tokens: 5,
                        },
                    ],
                })
            })
        });
    let recorder = Arc::new(Recorder::default());
    let service = AiEditingService::new(
        Arc::new(worker),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    );
    let result = service
        .edit(receipt(), &user(), request(&token()))
        .await
        .unwrap();
    assert_eq!(result.clarification.as_deref(), Some("Which paragraph?"));
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 2);
    for event in events.iter() {
        assert_eq!(event.user, user());
        assert_eq!(event.feature, AiFeature::AiEditing);
        assert_eq!(event.entity, Some(DOCUMENT.parse().unwrap()));
    }
    assert_eq!(events[0].model, "model-a");
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 12,
            output: 3,
            cache_read: 0,
            cache_write: 0,
        }
    );
    assert_eq!(events[1].model, "model-b");
}

struct Dropped(Arc<AtomicBool>);
impl Drop for Dropped {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn cancelling_edit_drops_in_flight_worker_without_inventing_usage() {
    let dropped = Arc::new(AtomicBool::new(false));
    let signal = dropped.clone();
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_edit()
        .times(1)
        .returning(move |_, _, _, _, _| {
            let guard = Dropped(signal.clone());
            Box::pin(async move {
                let _guard = guard;
                std::future::pending().await
            })
        });
    let recorder = Arc::new(Recorder::default());
    let service = AiEditingService::new(
        Arc::new(worker),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    );
    let caller = user();
    let token = token();
    let mut edit = Box::pin(service.edit(receipt(), &caller, request(&token)));
    assert!(futures::poll!(&mut edit).is_pending());
    drop(edit);
    assert!(dropped.load(Ordering::SeqCst));
    assert!(recorder.0.lock().unwrap().is_empty());
}
