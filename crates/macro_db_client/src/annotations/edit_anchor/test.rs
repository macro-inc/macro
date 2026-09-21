use super::*;
use messages::domain::ports::MessageError;
use serde_json::json;
use sqlx::{PgPool, types::Uuid};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
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

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
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
        matches!(result.unwrap_err(), MessageError::NotFound),
        "Expected AnchorNotFound error"
    );
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
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
        matches!(result.unwrap_err(), MessageError::Forbidden),
        "Expected InvalidPermissions error"
    );
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
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
        matches!(result.unwrap_err(), MessageError::Invalid(_)),
        "Expected NotAllowed error"
    );
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
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
async fn edit_pdf_free_comment_anchor(
    pool: &PgPool,
    user: &str,
    request: EditPdfPlaceableCommentAnchorRequest,
) -> std::result::Result<PdfPlaceableCommentAnchor, MessageError> {
    let response = messages::domain::annotations::AnnotationService::new(
        crate::annotations::repository::PgAnnotationRepository(pool.clone()),
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
        messages::domain::ports::NoMessageEventPublisher,
    )
    .edit(
        &user.to_owned().try_into().unwrap(),
        None,
        EditAnchorRequest::Pdf(EditPdfAnchorRequest::FreeComment(request)),
    )
    .await?;
    let Anchor::Pdf(PdfAnchor::Placeable(anchor)) = response.anchor else {
        panic!("expected a placeable")
    };
    Ok(anchor)
}
