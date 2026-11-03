use super::*;
use crate::domain::permission_token::decode_permission_token;
use crate::domain::ports::editing::{EditResult, MockEditingWorkerService};
use ai_billing::domain::DenyReason;
use ai_billing::domain::admission::{AdmissionFuture, AiAdmissionService};
use ai_usage::AiFeature;
use bot_id::MACRO_AI_BOT_ID;
use entity_access::domain::models::{BotReceiptScope, Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use std::sync::Arc;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "document-edits-secret";

fn document(file_type: &str) -> DocumentBasic {
    DocumentBasic {
        document_id: DOCUMENT.into(),
        document_name: "Notes".into(),
        owner: Owner::from_principal_str("macro|editor@example.com").unwrap(),
        file_type: Some(file_type.into()),
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

fn user() -> MacroUserIdStr<'static> {
    "macro|editor@example.com".to_owned().try_into().unwrap()
}

fn edit_receipt(document_id: &str) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: document_id.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn operations() -> Vec<DocumentOp> {
    let serde_json::Value::Object(op) = serde_json::json!({
        "kind": "replace",
        "nodeId": "k3Fq",
        "find": "Q3",
        "replace": "Q4",
    }) else {
        panic!("op literal is an object")
    };
    vec![op]
}

struct Xml;
impl LiveDocumentXmlReader for Xml {
    async fn xml(&self, document_id: &str) -> Result<String, DocumentError> {
        assert_eq!(document_id, DOCUMENT);
        Ok(r#"<root><p id="k3Fq">Q3 plan</p></root>"#.to_owned())
    }
}

#[tokio::test]
async fn structure_reads_markdown_xml_with_the_view_receipt() {
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();

    let structure = read_structure(&Xml, receipt, &document("md"))
        .await
        .unwrap();

    assert_eq!(structure.xml, r#"<root><p id="k3Fq">Q3 plan</p></root>"#);
}

#[tokio::test]
async fn structure_refuses_documents_that_are_not_markdown() {
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();

    let error = read_structure(&Xml, receipt, &document("docx"))
        .await
        .unwrap_err();

    assert!(
        matches!(&error, DocumentError::BadRequest(message) if message == "document is not a markdown document"),
        "{error:?}"
    );
}

#[tokio::test]
async fn edits_refuse_documents_that_are_not_markdown_without_calling_the_worker() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_document_ops().never();

    let error = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("pdf"),
        &operations(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentEditError::Document(DocumentError::BadRequest(message)) if message == "document is not a markdown document"),
        "{error:?}"
    );
}

#[tokio::test]
async fn edits_refuse_an_edit_receipt_for_another_document() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_document_ops().never();

    let error = apply_operations(
        &worker,
        SECRET,
        edit_receipt("019fd3b9-0000-7000-8000-000000000000"),
        &document("md"),
        &operations(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(
            error,
            DocumentEditError::Document(DocumentError::Unauthorized)
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn edits_refuse_a_caller_with_no_user_or_bot_to_attribute() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_document_ops().never();

    let error = apply_operations(
        &worker,
        SECRET,
        EntityAccessReceipt::dangerously_assert_internal_user(DOCUMENT, EntityType::Document),
        &document("md"),
        &operations(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(
            error,
            DocumentEditError::Document(DocumentError::Unauthorized)
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn edits_refuse_empty_and_oversized_batches() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_document_ops().never();

    let empty = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &[],
    )
    .await
    .unwrap_err();
    let oversized = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &vec![operations()[0].clone(); 201],
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&empty, DocumentEditError::Document(DocumentError::BadRequest(message)) if message == "a batch carries 1 to 200 operations, not 0"),
        "{empty:?}"
    );
    assert!(
        matches!(&oversized, DocumentEditError::Document(DocumentError::BadRequest(message)) if message == "a batch carries 1 to 200 operations, not 201"),
        "{oversized:?}"
    );
}

#[tokio::test]
async fn bot_edits_carry_the_user_and_bot_in_the_token_and_the_bot_name_on_the_cursor() {
    let receipt = EntityAccessReceipt::<EditAccessLevel>::try_new_bot(
        MACRO_AI_BOT_ID.into_storage_id(),
        BotReceiptScope::User {
            acting_user: user(),
        },
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap();
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_document_ops()
        .times(1)
        .returning(|document_id, token, sent, editor| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(
                claims.actor,
                Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string())
            );
            assert_eq!(sent, operations().as_slice());
            assert_eq!(editor, EditorName::new("Macro"));
            Box::pin(async {
                Ok(DocumentOpsOutcome::Applied {
                    applied: 1,
                    changed_block_ids: vec!["k3Fq".to_string()],
                    revision: "AQID".to_string(),
                })
            })
        });

    let applied = apply_operations(&worker, SECRET, receipt, &document("md"), &operations())
        .await
        .unwrap();

    assert_eq!(
        applied,
        DocumentEditsApplied {
            applied: 1,
            changed_block_ids: vec!["k3Fq".to_string()],
            revision: "AQID".to_string(),
        }
    );
}

#[tokio::test]
async fn user_edits_carry_only_the_user_and_no_cursor_name() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_document_ops()
        .times(1)
        .returning(|_, token, _, editor| {
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.actor, None);
            assert_eq!(editor, None);
            Box::pin(async {
                Ok(DocumentOpsOutcome::Applied {
                    applied: 1,
                    changed_block_ids: vec!["k3Fq".to_string()],
                    revision: "AQID".to_string(),
                })
            })
        });

    let applied = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &operations(),
    )
    .await
    .unwrap();

    assert_eq!(
        applied,
        DocumentEditsApplied {
            applied: 1,
            changed_block_ids: vec!["k3Fq".to_string()],
            revision: "AQID".to_string(),
        }
    );
}

#[tokio::test]
async fn refused_batches_pass_each_failure_through() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_document_ops()
        .times(1)
        .returning(|_, _, _, _| {
            Box::pin(async {
                Ok(DocumentOpsOutcome::Rejected(vec![DocumentOpFailure {
                    index: 0,
                    kind: "node_not_found".to_string(),
                    message: "no node k3Fq".to_string(),
                }]))
            })
        });

    let error = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &operations(),
    )
    .await
    .unwrap_err();

    let DocumentEditError::Rejected(failures) = error else {
        panic!("expected a rejected batch, got {error:?}")
    };
    assert_eq!(
        failures,
        vec![DocumentOpFailure {
            index: 0,
            kind: "node_not_found".to_string(),
            message: "no node k3Fq".to_string(),
        }]
    );
}

#[tokio::test]
async fn unacknowledged_batches_are_reported_as_outcome_unknown() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_document_ops()
        .times(1)
        .returning(|_, _, _, _| {
            Box::pin(async {
                Ok(DocumentOpsOutcome::Unacknowledged(
                    "sync service did not acknowledge the update".to_string(),
                ))
            })
        });

    let error = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &operations(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentEditError::Unacknowledged(message) if message == "sync service did not acknowledge the update"),
        "{error:?}"
    );
}

#[tokio::test]
async fn malformed_ops_reported_by_the_worker_are_a_bad_request() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_document_ops()
        .times(1)
        .returning(|_, _, _, _| {
            Box::pin(async {
                Ok(DocumentOpsOutcome::Invalid(
                    "operations[0].type is unknown".to_string(),
                ))
            })
        });

    let error = apply_operations(
        &worker,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        &operations(),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentEditError::Document(DocumentError::BadRequest(message)) if message == "operations[0].type is unknown"),
        "{error:?}"
    );
}

struct Refuse(AiAdmissionError);
impl AiAdmissionService for Refuse {
    fn admit<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            assert_eq!(caller.as_ref(), "macro|editor@example.com");
            assert_eq!(feature, AiFeature::AiEditing);
            Err(self.0)
        })
    }
}

fn ai_editing(
    worker: MockEditingWorkerService,
    admission: Arc<dyn AiAdmissionService>,
) -> AiEditingService<MockEditingWorkerService> {
    AiEditingService::new(
        Arc::new(worker),
        admission,
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
}

#[tokio::test]
async fn instructions_run_editdocuments_pipeline_and_return_what_changed() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_edit()
        .times(1)
        .returning(|document_id, token, instructions, mode, editor| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(
                claims.user_id.map(|user| user.as_ref().to_string()),
                Some("macro|editor@example.com".to_string())
            );
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(instructions, "Replace Q3 with Q4 in the plan");
            assert_eq!(mode, EditMode::Fast);
            assert_eq!(editor, None);
            Box::pin(async {
                Ok(EditResult {
                    edits_applied: 1,
                    usage: Vec::new(),
                    clarification: None,
                    changed_block_ids: vec!["k3Fq".to_string()],
                    revision: Some("AQID".to_string()),
                    summary: Some("Changed Q3 to Q4.".to_string()),
                })
            })
        });

    let edited = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Replace Q3 with Q4 in the plan",
        true,
    )
    .await
    .unwrap();

    assert_eq!(
        edited,
        DocumentAiEdited {
            summary: "Changed Q3 to Q4.".to_string(),
            changed_block_ids: vec!["k3Fq".to_string()],
            revision: "AQID".to_string(),
        }
    );
}

#[tokio::test]
async fn instructions_refuse_documents_that_are_not_markdown_and_empty_instructions() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().never();
    let editing = ai_editing(
        worker,
        Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
    );

    let not_markdown = edit_with_instructions(
        &editing,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("docx"),
        "Fix the heading",
        false,
    )
    .await
    .unwrap_err();
    let empty = edit_with_instructions(
        &editing,
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "  ",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&not_markdown, DocumentAiEditError::Document(DocumentError::BadRequest(message)) if message == "document is not a markdown document"),
        "{not_markdown:?}"
    );
    assert!(
        matches!(&empty, DocumentAiEditError::Document(DocumentError::BadRequest(message)) if message == "instructions are empty"),
        "{empty:?}"
    );
}

#[tokio::test]
async fn instructions_refused_by_admission_never_reach_the_worker() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().never();

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(Refuse(AiAdmissionError::Denied(
                DenyReason::OveragePaymentFailed,
            ))),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix the heading",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(
            error,
            DocumentAiEditError::Admission(AiAdmissionError::Denied(
                DenyReason::OveragePaymentFailed
            ))
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_clarification_is_a_refused_edit() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().times(1).returning(|_, _, _, _, _| {
        Box::pin(async {
            Ok(EditResult {
                edits_applied: 0,
                usage: Vec::new(),
                clarification: Some("Which of the two plans?".to_string()),
                changed_block_ids: Vec::new(),
                revision: None,
                summary: None,
            })
        })
    });

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix the plan",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentAiEditError::Refused(reason) if reason == "Which of the two plans?"),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_worker_failure_is_a_failed_edit_distinct_from_a_refusal() {
    let mut worker = MockEditingWorkerService::new();
    worker.expect_edit().times(1).returning(|_, _, _, _, _| {
        Box::pin(async {
            Err(anyhow::anyhow!(
                "editing worker returned 502 Bad Gateway: sync service closed"
            ))
        })
    });

    let error = edit_with_instructions(
        &ai_editing(
            worker,
            Arc::new(ai_billing::domain::admission::DisabledAiAdmissionService),
        ),
        SECRET,
        edit_receipt(DOCUMENT),
        &document("md"),
        "Fix the plan",
        false,
    )
    .await
    .unwrap_err();

    assert!(
        matches!(&error, DocumentAiEditError::Failed(error) if error.to_string() == "editing worker returned 502 Bad Gateway: sync service closed"),
        "{error:?}"
    );
}
