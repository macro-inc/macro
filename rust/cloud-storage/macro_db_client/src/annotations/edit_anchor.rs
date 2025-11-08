use anyhow::{Result, bail};
use model::annotations::{
    Anchor, PdfAnchor, PdfPlaceableCommentAnchor,
    edit::{
        EditAnchorRequest, EditAnchorResponse, EditPdfAnchorRequest,
        EditPdfPlaceableCommentAnchorRequest,
    },
};
use sqlx::{Pool, Postgres};

use crate::annotations::CommentError;

pub async fn edit_document_anchor(
    db: &Pool<Postgres>,
    user_id: &str,
    req: EditAnchorRequest,
) -> Result<EditAnchorResponse> {
    match req {
        EditAnchorRequest::Pdf(EditPdfAnchorRequest::FreeComment(request)) => {
            let anchor = edit_pdf_free_comment_anchor(db, user_id, request).await?;
            Ok(EditAnchorResponse {
                document_id: anchor.document_id.clone(),
                anchor: Anchor::Pdf(PdfAnchor::Placeable(anchor)),
            })
        }
    }
}

async fn edit_pdf_free_comment_anchor(
    db: &Pool<Postgres>,
    user_id: &str,
    request: EditPdfPlaceableCommentAnchorRequest,
) -> Result<PdfPlaceableCommentAnchor> {
    let (anchor_owner, document_owner) = sqlx::query!(
        r#"
        SELECT a.owner, d.owner as document_owner
        FROM "PdfPlaceableCommentAnchor" a
        JOIN "Thread" t ON a."threadId" = t.id
        JOIN "Document" d ON a."documentId" = d.id
        WHERE a.uuid = $1 AND t."deletedAt" IS NULL
        "#,
        request.uuid
    )
    .map(|row| (row.owner, row.document_owner))
    .fetch_one(db)
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::AnchorNotFound),
        e => anyhow::anyhow!(e),
    })?;

    if anchor_owner != user_id && document_owner != user_id {
        bail!(CommentError::InvalidPermissions);
    }

    // Ensure at least one field is being updated
    if request.page.is_none()
        && request.original_page.is_none()
        && request.original_index.is_none()
        && request.x_pct.is_none()
        && request.y_pct.is_none()
        && request.width_pct.is_none()
        && request.height_pct.is_none()
        && request.rotation.is_none()
        && request.allowable_edits.is_none()
        && request.was_edited.is_none()
        && request.was_deleted.is_none()
        && request.should_lock_on_save.is_none()
    {
        bail!(CommentError::NotAllowed(
            "At least one field must be updated.".to_string()
        ));
    }

    let anchor = sqlx::query_as!(
        PdfPlaceableCommentAnchor,
        r#"
        UPDATE "PdfPlaceableCommentAnchor" SET
            "page" = COALESCE($1, "page"),
            "originalPage" = COALESCE($2, "originalPage"),
            "originalIndex" = COALESCE($3, "originalIndex"),
            "xPct" = COALESCE($4, "xPct"),
            "yPct" = COALESCE($5, "yPct"),
            "widthPct" = COALESCE($6, "widthPct"),
            "heightPct" = COALESCE($7, "heightPct"),
            "rotation" = COALESCE($8, "rotation"),
            "allowableEdits" = COALESCE($9, "allowableEdits"),
            "wasEdited" = COALESCE($10, "wasEdited"),
            "wasDeleted" = COALESCE($11, "wasDeleted"),
            "shouldLockOnSave" = COALESCE($12, "shouldLockOnSave")
        WHERE uuid = $13
        RETURNING 
            uuid, 
            "documentId" as document_id,
            owner, 
            "threadId" as thread_id, 
            page, 
            "originalPage" as original_page, 
            "originalIndex" as original_index, 
            "xPct" as x_pct, 
            "yPct" as y_pct, 
            "widthPct" as width_pct, 
            "heightPct" as height_pct, 
            rotation,
            "allowableEdits" as allowable_edits, 
            "wasEdited" as was_edited, 
            "wasDeleted" as was_deleted, 
            "shouldLockOnSave" as should_lock_on_save
        "#,
        request.page,
        request.original_page,
        request.original_index,
        request.x_pct,
        request.y_pct,
        request.width_pct,
        request.height_pct,
        request.rotation,
        request.allowable_edits,
        request.was_edited,
        request.was_deleted,
        request.should_lock_on_save,
        request.uuid,
    )
    .fetch_one(db)
    .await?;

    Ok(anchor)
}

#[cfg(test)]
mod edit_anchor_tests {
    use super::*;
    use crate::annotations::CommentError;
    use serde_json::json;
    use sqlx::{PgPool, types::Uuid};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_pdf_free_comment_anchor_success(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("91111111-1111-1111-1111-111111111111").unwrap();

        let request = EditPdfPlaceableCommentAnchorRequest {
            uuid,
            page: Some(2),
            original_page: Some(1),
            original_index: Some(3),
            x_pct: Some(0.5),
            y_pct: Some(0.5),
            width_pct: Some(0.2),
            height_pct: Some(0.2),
            rotation: Some(45.0),
            allowable_edits: Some(json!({"allowResize": true})), // Example JSON
            was_edited: Some(true),
            was_deleted: Some(false),
            should_lock_on_save: Some(false),
        };

        let result = edit_pdf_free_comment_anchor(&pool, user_id, request).await;

        assert!(result.is_ok(), "Expected success but got {:?}", result);
        let updated_anchor = result.unwrap();

        assert_eq!(updated_anchor.page, 2);
        assert_eq!(updated_anchor.original_page, 1);
        assert_eq!(updated_anchor.original_index, 3);
        assert_eq!(updated_anchor.x_pct, 0.5);
        assert_eq!(updated_anchor.y_pct, 0.5);
        assert_eq!(updated_anchor.width_pct, 0.2);
        assert_eq!(updated_anchor.height_pct, 0.2);
        assert_eq!(updated_anchor.rotation, 45.0);
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_pdf_free_comment_anchor_not_found(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::new_v4(); // Non-existent UUID

        let request = EditPdfPlaceableCommentAnchorRequest {
            uuid,
            page: Some(2),
            original_page: Some(1),
            original_index: Some(3),
            x_pct: Some(0.5),
            y_pct: Some(0.5),
            width_pct: Some(0.2),
            height_pct: Some(0.2),
            rotation: Some(45.0),
            allowable_edits: None,
            was_edited: Some(true),
            was_deleted: Some(false),
            should_lock_on_save: Some(false),
        };

        let result = edit_pdf_free_comment_anchor(&pool, user_id, request).await;

        assert!(result.is_err(), "Expected error for non-existent anchor");
        assert!(
            matches!(
                result.unwrap_err().downcast_ref::<CommentError>(),
                Some(CommentError::AnchorNotFound)
            ),
            "Expected AnchorNotFound error"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_pdf_free_comment_anchor_invalid_permissions(pool: PgPool) {
        let unauthorized_user = "macro|unauthorized_user@user.com";
        let uuid = Uuid::try_parse("91111111-1111-1111-1111-111111111111").unwrap();

        let request = EditPdfPlaceableCommentAnchorRequest {
            uuid,
            page: Some(2),
            original_page: Some(1),
            original_index: Some(3),
            x_pct: Some(0.5),
            y_pct: Some(0.5),
            width_pct: Some(0.2),
            height_pct: Some(0.2),
            rotation: Some(45.0),
            allowable_edits: None,
            was_edited: Some(true),
            was_deleted: Some(false),
            should_lock_on_save: Some(false),
        };

        let result = edit_pdf_free_comment_anchor(&pool, unauthorized_user, request).await;

        assert!(
            result.is_err(),
            "Expected failure due to insufficient permissions"
        );
        assert!(
            matches!(
                result.unwrap_err().downcast_ref::<CommentError>(),
                Some(CommentError::InvalidPermissions)
            ),
            "Expected InvalidPermissions error"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_pdf_free_comment_anchor_no_update_attempt(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("91111111-1111-1111-1111-111111111111").unwrap();

        let request = EditPdfPlaceableCommentAnchorRequest {
            uuid,
            page: None,
            original_page: None,
            original_index: None,
            x_pct: None,
            y_pct: None,
            width_pct: None,
            height_pct: None,
            rotation: None,
            allowable_edits: None,
            was_edited: None,
            was_deleted: None,
            should_lock_on_save: None,
        };

        let result = edit_pdf_free_comment_anchor(&pool, user_id, request).await;

        assert!(
            result.is_err(),
            "Expected failure when no fields are updated"
        );
        assert!(
            matches!(
                result.unwrap_err().downcast_ref::<CommentError>(),
                Some(CommentError::NotAllowed(_))
            ),
            "Expected NotAllowed error"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_pdf_free_comment_anchor_keeps_existing_values(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("91111111-1111-1111-1111-111111111111").unwrap();

        let request = EditPdfPlaceableCommentAnchorRequest {
            uuid,
            page: None, // Keeping existing values
            original_page: None,
            original_index: None,
            x_pct: None,
            y_pct: None,
            width_pct: None,
            height_pct: None,
            rotation: None,
            allowable_edits: None,
            was_edited: Some(true), // Updating only this field
            was_deleted: None,
            should_lock_on_save: None,
        };

        let result = edit_pdf_free_comment_anchor(&pool, user_id, request).await;

        assert!(result.is_ok(), "Expected success but got {:?}", result);
        let updated_anchor = result.unwrap();

        // Ensure updated field changed
        assert_eq!(updated_anchor.was_edited, true);

        // Ensure existing values remain unchanged
        assert_eq!(updated_anchor.page, 1);
        assert_eq!(updated_anchor.original_page, 1);
        assert_eq!(updated_anchor.original_index, 0);
        assert_eq!(updated_anchor.x_pct, 0.2);
        assert_eq!(updated_anchor.y_pct, 0.3);
        assert_eq!(updated_anchor.width_pct, 0.1);
        assert_eq!(updated_anchor.height_pct, 0.05);
        assert_eq!(updated_anchor.rotation, 0.0);
        assert_eq!(
            updated_anchor.allowable_edits,
            Some(
                json!({"allowResize": true, "allowTranslate": true, "allowRotate": true, "allowDelete": true, "lockAspectRatio": false})
            )
        );
    }
}
