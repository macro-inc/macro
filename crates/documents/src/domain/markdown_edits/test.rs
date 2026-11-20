use super::*;
use crate::domain::permission_token::decode_permission_token;
use crate::domain::ports::editing::MockEditingWorkerService;
use entity_access::domain::models::{Entity, EntityPermission, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";
const SECRET: &str = "document-markdown-secret";

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

fn receipt<Level: entity_access::domain::models::RequiredPermission>(
    access_level: AccessLevel,
) -> EntityAccessReceipt<Level> {
    let user: MacroUserIdStr<'static> = "macro|editor@example.com".to_owned().try_into().unwrap();
    EntityAccessReceipt::try_new_authenticated_user(
        user,
        Entity {
            entity_id: DOCUMENT.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

fn block(id: &str) -> BlockId {
    BlockId::try_from(id.to_owned()).unwrap()
}

#[test]
fn every_edit_shape_reads_from_its_fields() {
    let edits: Vec<MarkdownEdit> = serde_json::from_value(serde_json::json!([
        { "old": "Q3", "new": "Q4" },
        { "block_id": "b1", "old": "a", "new": "b", "replace_all": true },
        { "insert_after": "end", "markdown": "- new" },
        { "insert_before": "b2", "markdown": "# Top" },
        { "delete": "b3" },
        { "move": "b4", "after": "b5" },
        { "move": "b4", "before": "start" },
    ]))
    .unwrap();

    assert_eq!(
        edits,
        vec![
            MarkdownEdit::Replace(ReplaceEdit {
                block_id: None,
                old: "Q3".into(),
                new: "Q4".into(),
                replace_all: false,
            }),
            MarkdownEdit::Replace(ReplaceEdit {
                block_id: Some(block("b1")),
                old: "a".into(),
                new: "b".into(),
                replace_all: true,
            }),
            MarkdownEdit::InsertAfter(InsertAfterEdit {
                insert_after: block("end"),
                markdown: "- new".into(),
            }),
            MarkdownEdit::InsertBefore(InsertBeforeEdit {
                insert_before: block("b2"),
                markdown: "# Top".into(),
            }),
            MarkdownEdit::Delete(DeleteEdit {
                delete: block("b3"),
            }),
            MarkdownEdit::MoveAfter(MoveAfterEdit {
                block: block("b4"),
                after: block("b5"),
            }),
            MarkdownEdit::MoveBefore(MoveBeforeEdit {
                block: block("b4"),
                before: block("start"),
            }),
        ]
    );
}

#[test]
fn an_edit_with_unknown_or_mixed_fields_is_rejected() {
    for edit in [
        serde_json::json!({ "old": "a", "new": "b", "extra": 1 }),
        serde_json::json!({ "delete": "b1", "markdown": "x" }),
        serde_json::json!({ "move": "b1" }),
        serde_json::json!({ "delete": "" }),
    ] {
        assert!(
            serde_json::from_value::<MarkdownEdit>(edit.clone()).is_err(),
            "{edit}"
        );
    }
}

#[test]
fn the_worker_request_keeps_the_edit_shapes_and_drops_defaults() {
    let request = MarkdownEditRequest {
        edits: vec![MarkdownEdit::Replace(ReplaceEdit {
            block_id: None,
            old: "Q3".into(),
            new: "Q4".into(),
            replace_all: false,
        })],
        base_revision: Some("AQID".into()),
        dry_run: true,
        allow_deleting_content: false,
    };

    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        serde_json::json!({
            "edits": [{ "old": "Q3", "new": "Q4" }],
            "baseRevision": "AQID",
            "dryRun": true,
        })
    );
}

#[test]
fn the_worker_response_reads_as_changes() {
    let edited: MarkdownEdited = serde_json::from_value(serde_json::json!({
        "action": "edit",
        "outcome": "committed",
        "revision": "AQIE",
        "merge": "base",
        "changes": [
            { "kind": "edited", "blockId": "b1", "before": "Q3", "after": "Q4" },
            { "kind": "inserted", "blockId": "n1", "afterBlockId": null, "markdown": "# Top" },
            { "kind": "deleted", "blockId": "b2", "markdown": "old" },
            { "kind": "moved", "blockId": "b3", "afterBlockId": "n1" },
        ],
    }))
    .unwrap();

    assert_eq!(
        edited,
        MarkdownEdited {
            outcome: MarkdownEditOutcomeKind::Committed,
            revision: "AQIE".into(),
            merge: Some(MarkdownEditMerge::Base),
            changes: vec![
                MarkdownBlockChange::Edited {
                    block_id: block("b1"),
                    before: "Q3".into(),
                    after: "Q4".into(),
                },
                MarkdownBlockChange::Inserted {
                    block_id: block("n1"),
                    after_block_id: None,
                    markdown: "# Top".into(),
                },
                MarkdownBlockChange::Deleted {
                    block_id: block("b2"),
                    markdown: "old".into(),
                },
                MarkdownBlockChange::Moved {
                    block_id: block("b3"),
                    after_block_id: Some(block("n1")),
                },
            ],
        }
    );
}

fn request() -> MarkdownEditRequest {
    MarkdownEditRequest {
        edits: vec![MarkdownEdit::Delete(DeleteEdit {
            delete: block("b1"),
        })],
        base_revision: None,
        dry_run: false,
        allow_deleting_content: false,
    }
}

#[tokio::test]
async fn edits_go_to_the_worker_with_an_edit_token_for_the_caller() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_edit_markdown()
        .times(1)
        .returning(|document_id, token, sent| {
            assert_eq!(document_id, DOCUMENT);
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(claims.access_level, AccessLevel::Edit);
            assert_eq!(sent, &request());
            Box::pin(async {
                Ok(MarkdownEditOutcome::Applied(MarkdownEdited {
                    outcome: MarkdownEditOutcomeKind::Committed,
                    revision: "AQIE".into(),
                    changes: vec![],
                    merge: Some(MarkdownEditMerge::Current),
                }))
            })
        });

    let edited = edit_markdown(
        &worker,
        SECRET,
        receipt(AccessLevel::Edit),
        &document("md"),
        &request(),
    )
    .await
    .unwrap();

    assert_eq!(edited.revision, "AQIE");
}

#[tokio::test]
async fn a_refusal_and_a_conflict_come_back_typed() {
    let refusal = MarkdownEditRefusal {
        code: MarkdownEditRefusalCode::AmbiguousMatch,
        message: "edit 1: old occurs 2 times".into(),
        edit: Some(1),
        blocks: vec![],
    };
    let mut worker = MockEditingWorkerService::new();
    let refused = refusal.clone();
    worker
        .expect_edit_markdown()
        .times(1)
        .returning(move |_, _, _| {
            let refused = refused.clone();
            Box::pin(async move { Ok(MarkdownEditOutcome::Refused(refused)) })
        });
    worker.expect_edit_markdown().times(1).returning(|_, _, _| {
        Box::pin(async {
            Ok(MarkdownEditOutcome::Conflict(MarkdownEditConflict {
                reason: MarkdownEditConflictReason::Changed,
                message: "text is gone".into(),
            }))
        })
    });

    let first = edit_markdown(
        &worker,
        SECRET,
        receipt(AccessLevel::Edit),
        &document("md"),
        &request(),
    )
    .await;
    let second = edit_markdown(
        &worker,
        SECRET,
        receipt(AccessLevel::Edit),
        &document("md"),
        &request(),
    )
    .await;

    assert!(matches!(first, Err(MarkdownEditError::Refused(r)) if r == refusal));
    assert!(matches!(
        second,
        Err(MarkdownEditError::Conflict(conflict))
            if conflict.reason == MarkdownEditConflictReason::Changed && conflict.message == "text is gone"
    ));
}

#[tokio::test]
async fn an_empty_batch_or_a_non_markdown_document_never_reaches_the_worker() {
    let worker = MockEditingWorkerService::new();
    let empty = MarkdownEditRequest {
        edits: vec![],
        ..request()
    };

    let no_edits = edit_markdown(
        &worker,
        SECRET,
        receipt(AccessLevel::Edit),
        &document("md"),
        &empty,
    )
    .await;
    let not_markdown = edit_markdown(
        &worker,
        SECRET,
        receipt(AccessLevel::Edit),
        &document("pdf"),
        &request(),
    )
    .await;

    assert!(matches!(
        no_edits,
        Err(MarkdownEditError::Document(DocumentError::BadRequest(_)))
    ));
    assert!(matches!(
        not_markdown,
        Err(MarkdownEditError::Document(DocumentError::BadRequest(_)))
    ));
}

#[tokio::test]
async fn blocks_are_read_with_a_view_token() {
    let mut worker = MockEditingWorkerService::new();
    worker
        .expect_markdown_blocks()
        .times(1)
        .returning(|_, token| {
            let claims = decode_permission_token(token, SECRET).unwrap();
            assert_eq!(claims.access_level, AccessLevel::View);
            Box::pin(async {
                Ok(DocumentMarkdownBlocks {
                    revision: "AQID".into(),
                    blocks: vec![MarkdownBlock {
                        id: BlockId::try_from("b1".to_owned()).unwrap(),
                        block_type: "heading".into(),
                        markdown: "# Plan".into(),
                        opaque: false,
                    }],
                })
            })
        });

    let read = read_markdown_blocks(&worker, SECRET, receipt(AccessLevel::View), &document("md"))
        .await
        .unwrap();

    assert_eq!(read.blocks.len(), 1);
    assert_eq!(read.revision, "AQID");
}
