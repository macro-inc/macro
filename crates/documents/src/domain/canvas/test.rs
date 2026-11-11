use super::*;
use crate::domain::ports::editing::MockEditingWorkerService;
use ai_billing::domain::{
    DenyReason,
    admission::{AdmissionFuture, AiAdmissionError},
};
use ai_usage::UsageEvent;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use std::sync::Mutex;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "local-canvas-test-secret";

#[tokio::test]
async fn render_mints_view_access_and_does_not_admit_or_meter_a_model() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_canvas().times(1).returning(|id, token, request, _| {
        assert_eq!(id, DOCUMENT);
        assert!(matches!(request, CanvasRequest::Render { .. }));
        let claims: serde_json::Value = macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
        assert_eq!(claims["access_level"], "view");
        assert_eq!(claims["actor"], "macro|ai@macro.com");
        assert_eq!(serde_json::to_value(request).unwrap(), serde_json::json!({"action":"render"}));
        Box::pin(async { Ok(CanvasResult { failure: None, usage: vec![], response: CanvasResponse {
            render: Some(serde_json::from_value(serde_json::json!({"revision":"snapshot-1","clock":{},"crop":{"x":0,"y":0,"width":100,"height":80},"width":200,"height":160,"objects":[],"unavailable":[],"modelMedia":[{"type":"image","mediaType":"image/png","data":"iVBORw0KGgo="}]})).unwrap()),
            canvas: None, operations_applied: 0, summary: "Rendered".into(), clarification: None,
        } }) })
    });
    let recorder = Arc::new(Recorder::default());
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
        recorder.clone(),
    );
    let render = service
        .render(
            receipt(AccessLevel::View),
            &user(),
            Some("macro|ai@macro.com"),
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(render.revision, "snapshot-1");
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_render_crop_never_starts_storage_or_worker_access() {
    let service = CanvasService::new(
        Arc::new(MockCanvasDocumentLookup::new()),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        Arc::new(Recorder::default()),
    );
    assert!(
        service
            .render(
                receipt(AccessLevel::View),
                &user(),
                Some("macro|ai@macro.com"),
                None,
                Some(CanvasBounds {
                    x: 0.0,
                    y: 0.0,
                    width: -1.0,
                    height: 100.0
                })
            )
            .await
            .is_err()
    );
}
fn user() -> MacroUserIdStr<'static> {
    "macro|canvas@example.com".to_owned().try_into().unwrap()
}
fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
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
fn documents(file_type: &str) -> MockCanvasDocumentLookup {
    let mut documents = MockCanvasDocumentLookup::new();
    let file_type = file_type.to_owned();
    documents
        .expect_file_type()
        .withf(|id| id == DOCUMENT)
        .times(1)
        .returning(move |_| {
            let file_type = file_type.clone();
            Box::pin(async move { Ok(Some(file_type)) })
        });
    documents
}

#[tokio::test]
async fn read_mints_only_view_access_and_preserves_actor_without_admission_or_usage() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_canvas()
        .times(1)
        .returning(|id, token, request, _| {
            assert_eq!(id, DOCUMENT);
            assert!(matches!(request, CanvasRequest::Read { .. }));
            let claims: serde_json::Value =
                macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
            assert_eq!(claims["document_id"], DOCUMENT);
            assert_eq!(claims["access_level"], "view");
            assert_eq!(claims["actor"], "macro|ai@macro.com");
            assert_eq!(claims["user_id"], "macro|canvas@example.com");
            Box::pin(async {
                Ok(CanvasResult {
                    failure: None,
                    response: CanvasResponse {
                        render: None,
                        canvas: Some("scene".into()),
                        operations_applied: 0,
                        summary: "Read".into(),
                        clarification: None,
                    },
                    usage: vec![],
                })
            })
        });
    let recorder = Arc::new(Recorder::default());
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
        recorder.clone(),
    );
    assert_eq!(
        service
            .read(
                receipt(AccessLevel::View),
                &user(),
                Some("macro|ai@macro.com"),
                None,
                None
            )
            .await
            .unwrap()
            .canvas
            .as_deref(),
        Some("scene")
    );
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_file_type_and_denied_admission_never_start_worker() {
    for (file_type, admission) in [
        ("md", Ok(())),
        (
            "canvas",
            Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)),
        ),
        ("canvas", Err(AiAdmissionError::Unavailable)),
    ] {
        let recorder = Arc::new(Recorder::default());
        let service = CanvasService::new(
            Arc::new(documents(file_type)),
            Arc::new(MockEditingWorkerService::new()),
            SECRET.into(),
            Arc::new(Admission(admission)),
            recorder.clone(),
        );
        let error = service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                Some("macro|ai@macro.com"),
                "Make a flowchart".into(),
                None,
            )
            .await
            .unwrap_err();
        if file_type == "md" {
            assert!(matches!(error, CanvasError::Invalid(_)));
        } else {
            assert!(matches!(error, CanvasError::Admission(_)));
        }
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn admitted_edit_mints_edit_access_and_records_actual_worker_usage() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_canvas().times(1).returning(|_, token, request, _| {
        assert!(matches!(request,CanvasRequest::Edit {instructions, ..} if instructions=="Make a flowchart"));
        let claims: serde_json::Value=macro_sync_service_jwt::decode(token.as_str(),SECRET).unwrap();
        assert_eq!(claims["access_level"],"edit");
        assert_eq!(claims["actor"],"macro|ai@macro.com");
        Box::pin(async {Ok(CanvasResult { failure: None,response:CanvasResponse { render: None,canvas:None,operations_applied:3,summary:"Applied".into(),clarification:None},usage:vec![EditUsage {model:"test-model".into(),input_tokens:100,output_tokens:20}]})})
    });
    let recorder = Arc::new(Recorder::default());
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    );
    assert_eq!(
        service
            .edit(
                receipt(AccessLevel::Edit),
                &user(),
                Some("macro|ai@macro.com"),
                "Make a flowchart".into(),
                None
            )
            .await
            .unwrap()
            .operations_applied,
        3
    );
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 100,
            output: 20,
            cache_read: 0,
            cache_write: 0
        }
    );
}

#[test]
fn view_only_permission_cannot_construct_an_edit_receipt() {
    assert!(
        EntityAccessReceipt::<EditAccessLevel>::try_new_authenticated_user(
            user(),
            Entity {
                entity_id: DOCUMENT.into(),
                entity_type: EntityType::Document
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View
            }
        )
        .is_err()
    );
}

#[tokio::test]
async fn failed_later_step_still_records_completed_provider_usage() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_canvas().times(1).returning(|_, _, _, _| {
        Box::pin(async {
            Ok(CanvasResult {
                failure: Some(
                    "Provider failed after one acknowledged edit. ReadCanvas before retrying."
                        .into(),
                ),
                response: CanvasResponse {
                    render: None,
                    canvas: None,
                    operations_applied: 1,
                    summary: "Stopped".into(),
                    clarification: None,
                },
                usage: vec![EditUsage {
                    model: "test-model".into(),
                    input_tokens: 70,
                    output_tokens: 30,
                }],
            })
        })
    });
    let recorder = Arc::new(Recorder::default());
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        recorder.clone(),
    );
    let error = service
        .edit(
            receipt(AccessLevel::Edit),
            &user(),
            Some("macro|ai@macro.com"),
            "Make a flowchart".into(),
            None,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("acknowledged edit"));
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 70,
            output: 30,
            cache_read: 0,
            cache_write: 0
        }
    );
}

#[tokio::test]
async fn direct_batch_has_edit_capability_without_a_second_model_or_admission() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_canvas().times(1).returning(|_, token, request, _| {
        let claims: serde_json::Value = macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
        assert_eq!(claims["access_level"], "edit");
        assert_eq!(claims["actor"], "macro|ai@macro.com");
        assert!(matches!(request, CanvasRequest::Apply { code, .. } if code == "editor.move(['a'],0,20)"));
        Box::pin(async { Ok(CanvasResult { failure: None, usage: vec![], response: CanvasResponse {
            render: None, canvas: Some("verified scene".into()), operations_applied: 1, summary: "Applied".into(), clarification: None,
        } }) })
    });
    let recorder = Arc::new(Recorder::default());
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
        recorder.clone(),
    );
    let result = service
        .apply(
            receipt(AccessLevel::Edit),
            &user(),
            Some("macro|ai@macro.com"),
            CanvasRequest::Apply {
                expected_revision: "a".repeat(64),
                code: "editor.move(['a'],0,20)".into(),
                snippets: None,
                editor_name: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(result.operations_applied, 1);
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_direct_revision_never_reads_storage_or_calls_worker() {
    let service = CanvasService::new(
        Arc::new(MockCanvasDocumentLookup::new()),
        Arc::new(MockEditingWorkerService::new()),
        SECRET.into(),
        Arc::new(Admission(Ok(()))),
        Arc::new(Recorder::default()),
    );
    let error = service
        .apply(
            receipt(AccessLevel::Edit),
            &user(),
            Some("macro|ai@macro.com"),
            CanvasRequest::Apply {
                expected_revision: "stale".into(),
                code: "editor.move(['a'],0,20)".into(),
                snippets: None,
                editor_name: None,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, CanvasError::Invalid(_)));
}

#[tokio::test]
async fn the_artifacts_rollout_reaches_the_worker_only_when_set() {
    for (service_setting, expected) in [(None, false), (Some(false), false), (Some(true), true)] {
        let mut worker = MockEditingWorkerService::new();
        worker
            .expect_canvas()
            .times(1)
            .returning(move |_, _, _, artifacts| {
                assert_eq!(artifacts, expected);
                Box::pin(async {
                    Ok(CanvasResult {
                        failure: None,
                        response: CanvasResponse {
                            render: None,
                            canvas: Some("scene".into()),
                            operations_applied: 0,
                            summary: "Read".into(),
                            clarification: None,
                        },
                        usage: vec![],
                    })
                })
            });
        let mut service = CanvasService::new(
            Arc::new(documents("canvas")),
            Arc::new(worker),
            SECRET.into(),
            Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
            Arc::new(Recorder::default()),
        );
        if let Some(artifacts) = service_setting {
            service = service.with_artifacts(artifacts);
        }

        service
            .read(
                receipt(AccessLevel::View),
                &user(),
                Some("macro|ai@macro.com"),
                None,
                None,
            )
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a_user_without_a_bot_mints_a_token_with_no_actor() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_canvas().times(1).returning(|_, token, _, _| {
        let claims: serde_json::Value =
            macro_sync_service_jwt::decode(token.as_str(), SECRET).unwrap();
        assert_eq!(claims["user_id"], "macro|canvas@example.com");
        assert!(claims.get("actor").is_none_or(serde_json::Value::is_null));
        Box::pin(async {
            Ok(CanvasResult {
                failure: None,
                response: CanvasResponse {
                    render: None,
                    canvas: Some("{}".into()),
                    operations_applied: 0,
                    summary: "Read".into(),
                    clarification: None,
                },
                usage: vec![],
            })
        })
    });
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
        Arc::new(Recorder::default()),
    );
    service
        .read(receipt(AccessLevel::View), &user(), None, None, None)
        .await
        .unwrap();
}

#[tokio::test]
async fn worker_conflicts_and_rejections_reach_the_caller_as_their_own_errors() {
    for (worker_error, conflict) in [
        (
            CanvasError::Conflict("Canvas revision changed.".into()),
            true,
        ),
        (
            CanvasError::Rejected("Item a no longer exists.".into()),
            false,
        ),
    ] {
        let mut worker = MockEditingWorkerService::new();
        let worker_error = Mutex::new(Some(worker_error));
        worker
            .expect_canvas()
            .times(1)
            .returning(move |_, _, _, _| {
                let error = worker_error.lock().unwrap().take().unwrap();
                Box::pin(async move { Err(error) })
            });
        let service = CanvasService::new(
            Arc::new(documents("canvas")),
            Arc::new(worker),
            SECRET.into(),
            Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
            Arc::new(Recorder::default()),
        );
        let error = service
            .apply(
                receipt(AccessLevel::Edit),
                &user(),
                None,
                CanvasRequest::Apply {
                    expected_revision: "a".repeat(64),
                    code: "editor.move(['a'],0,20)".into(),
                    snippets: None,
                    editor_name: None,
                },
            )
            .await
            .unwrap_err();
        if conflict {
            assert!(
                matches!(error, CanvasError::Conflict(message) if message == "Canvas revision changed.")
            );
        } else {
            assert!(
                matches!(error, CanvasError::Rejected(message) if message == "Item a no longer exists.")
            );
        }
    }
}

#[derive(Default)]
struct Images(Mutex<Vec<(String, String, Vec<u8>)>>);
#[async_trait::async_trait]
impl CanvasImageStore for Images {
    async fn save_png(
        &self,
        owner: &MacroUserIdStr<'static>,
        name: &str,
        png: Vec<u8>,
    ) -> anyhow::Result<StoredCanvasImage> {
        self.0
            .lock()
            .unwrap()
            .push((owner.to_string(), name.to_owned(), png));
        Ok(StoredCanvasImage {
            file_id: "0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e".into(),
            url: "https://static.test/file/0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e".into(),
        })
    }
}

#[tokio::test]
async fn a_stored_render_keeps_the_png_as_the_callers_file_and_drops_inline_media() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_canvas().times(1).returning(|_, _, _, _| {
        Box::pin(async { Ok(CanvasResult { failure: None, usage: vec![], response: CanvasResponse {
            render: Some(serde_json::from_value(serde_json::json!({"revision":"snapshot-1","clock":{},"crop":{"x":0,"y":0,"width":100,"height":80},"width":200,"height":160,"objects":[{"id":"box","bounds":{"x":0,"y":0,"width":10,"height":10}}],"unavailable":[],"modelMedia":[{"type":"image","mediaType":"image/png","data":"iVBORw0KGgo="}]})).unwrap()),
            canvas: None, operations_applied: 0, summary: "Rendered".into(), clarification: None,
        } }) })
    });
    let service = CanvasService::new(
        Arc::new(documents("canvas")),
        Arc::new(worker),
        SECRET.into(),
        Arc::new(Admission(Err(AiAdmissionError::Unavailable))),
        Arc::new(Recorder::default()),
    );
    let images = Images::default();
    let stored = service
        .render_to_file(
            receipt(AccessLevel::View),
            &user(),
            None,
            Some(vec!["box".into()]),
            None,
            &images,
        )
        .await
        .unwrap();
    assert_eq!(stored.image.file_id, "0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e");
    assert_eq!(stored.render.revision, "snapshot-1");
    assert!(stored.render.model_media.is_empty());
    assert_eq!(stored.render.objects[0].id, "box");
    let saved = images.0.lock().unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].0, "macro|canvas@example.com");
    assert_eq!(saved[0].1, format!("canvas-{DOCUMENT}.png"));
    assert_eq!(saved[0].2, b"\x89PNG\r\n\x1a\n");
}
