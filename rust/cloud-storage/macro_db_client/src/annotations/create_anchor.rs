use anyhow::Result;
use model::annotations::create::{
    AnchorRequest, CreateUnthreadedAnchorRequest, CreateUnthreadedAnchorResponse,
    CreateUnthreadedPdfAnchorRequest, PdfAnchorRequest, PdfHighlightAnchorRequest,
    PdfPlaceableCommentAnchorRequest, UnthreadedPdfUuidRequest,
};
use model::annotations::{
    Anchor, PdfAnchor, PdfHighlightAnchor, PdfHighlightRect, PdfPlaceableCommentAnchor,
};
use sqlx::types::Uuid;
use sqlx::{PgExecutor, Pool, Postgres, Transaction, query_as, query_scalar};

use crate::annotations::CommentError;

use super::AnchorTableName;

fn _validate_thread_ids(thread_id: i64, anchor_thread_id: Option<i64>) -> Result<()> {
    let incompatible_thread_ids = anchor_thread_id.is_some_and(|id| id != thread_id);
    if incompatible_thread_ids {
        return Err(anyhow::anyhow!("provided thread ids do not match"));
    }
    Ok(())
}

async fn validate_thread_exists(executor: impl PgExecutor<'_>, thread_id: i64) -> Result<()> {
    let thread_exists = sqlx::query_scalar!(
        r#"
    SELECT 1
    FROM "Thread" t
    WHERE t.id = $1 AND t."deletedAt" IS NULL
    "#,
        thread_id
    )
    .fetch_optional(executor)
    .await?;

    if thread_exists.is_none() {
        anyhow::bail!(CommentError::ThreadNotFound);
    }

    Ok(())
}

pub async fn create_comment_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    owner: &str,
    document_id: &str,
    req: AnchorRequest,
    thread_id: i64,
) -> Result<Anchor> {
    match req {
        AnchorRequest::Pdf(anchor) => match anchor {
            PdfAnchorRequest::Attachment(attachment) => match attachment {
                UnthreadedPdfUuidRequest::Highlight(uuid) => {
                    let anchor = attach_pdf_highlight_anchor(transaction, thread_id, uuid).await?;
                    Ok(Anchor::Pdf(PdfAnchor::Highlight(anchor)))
                }
            },
            PdfAnchorRequest::FreeComment(anchor) => {
                let anchor =
                    create_pdf_placeable_anchor(transaction, owner, document_id, thread_id, anchor)
                        .await?;
                attach_anchor_to_thread(
                    transaction,
                    thread_id,
                    anchor.uuid,
                    AnchorTableName::PdfPlaceableCommentAnchor,
                )
                .await?;
                Ok(Anchor::Pdf(PdfAnchor::Placeable(anchor)))
            }
            PdfAnchorRequest::Highlight(anchor) => {
                let anchor = create_pdf_highlight_anchor(
                    transaction,
                    owner,
                    document_id,
                    Some(thread_id),
                    anchor,
                )
                .await?;
                attach_anchor_to_thread(
                    transaction,
                    thread_id,
                    anchor.uuid,
                    AnchorTableName::PdfHighlightAnchor,
                )
                .await?;
                Ok(Anchor::Pdf(PdfAnchor::Highlight(anchor)))
            }
        },
    }
}

pub async fn attach_pdf_highlight_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    thread_id: i64,
    uuid: Uuid,
) -> Result<PdfHighlightAnchor> {
    validate_thread_exists(transaction.as_mut(), thread_id).await?;

    let anchor = query_as!(
        PdfHighlightAnchor,
        r#"
        WITH updated AS (
            UPDATE "PdfHighlightAnchor"
            SET "threadId" = $1
            WHERE uuid = $2
            RETURNING uuid, "threadId"
        )
        SELECT 
            ph.uuid, 
            ph."documentId" as document_id,
            ph.owner, 
            updated."threadId" as thread_id, 
            ph.page, 
            ph.red,
            ph.green, 
            ph.blue, 
            ph.alpha, 
            ph.type as highlight_type, 
            ph.text, 
            ph."pageViewportWidth" as page_viewport_width, 
            ph."pageViewportHeight" as page_viewport_height, 
            ph."createdAt"::timestamptz as created_at, 
            ph."updatedAt"::timestamptz as updated_at, 
            ph."deletedAt"::timestamptz as deleted_at, 
            array_agg((phr.id, phr.top, phr.left, phr.width, phr.height)) as "highlight_rects!: Vec<PdfHighlightRect>"
        FROM updated 
        JOIN "PdfHighlightAnchor" ph ON updated.uuid = ph.uuid
        JOIN "PdfHighlightRect" phr ON ph.uuid = phr."pdfHighlightAnchorId"
        GROUP BY ph.uuid, ph.owner, updated."threadId", ph.page, ph.red, ph.green, ph.blue, ph.alpha, ph.type, ph.text, ph."pageViewportWidth", ph."pageViewportHeight", ph."createdAt", ph."updatedAt", ph."deletedAt"
        "#,
        thread_id,
        uuid
    )
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::AnchorNotFound),
        e => anyhow::anyhow!(e),
    })?;

    attach_anchor_to_thread(
        transaction,
        thread_id,
        uuid,
        AnchorTableName::PdfHighlightAnchor,
    )
    .await?;

    Ok(anchor)
}

async fn attach_anchor_to_thread(
    transaction: &mut Transaction<'_, Postgres>,
    thread_id: i64,
    anchor_id: Uuid,
    anchor_table_name: AnchorTableName,
) -> Result<()> {
    println!("{:?} {:?}", thread_id, anchor_id);
    sqlx::query!(
        r#"
    INSERT INTO "ThreadAnchor" ("threadId", "anchorId", "anchorTableName")
    VALUES ($1, $2, $3::"anchor_table_name")
    "#,
        thread_id,
        anchor_id,
        anchor_table_name as _
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

pub async fn create_unthreaded_anchor(
    db: &Pool<Postgres>,
    owner: &str,
    document_id: &str,
    req: CreateUnthreadedAnchorRequest,
) -> Result<CreateUnthreadedAnchorResponse> {
    let mut transaction = db.begin().await?;
    match req {
        CreateUnthreadedAnchorRequest::Pdf(anchor) => match anchor {
            CreateUnthreadedPdfAnchorRequest::Highlight(anchor) => {
                let anchor =
                    create_pdf_highlight_anchor(&mut transaction, owner, document_id, None, anchor)
                        .await?;
                transaction.commit().await?;
                Ok(CreateUnthreadedAnchorResponse {
                    document_id: document_id.to_string(),
                    anchor: Anchor::Pdf(PdfAnchor::Highlight(anchor)),
                })
            }
        },
    }
}

async fn create_pdf_placeable_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    owner: &str,
    document_id: &str,
    thread_id: i64,
    anchor: PdfPlaceableCommentAnchorRequest,
) -> Result<PdfPlaceableCommentAnchor> {
    validate_thread_exists(transaction.as_mut(), thread_id).await?;

    let inserted_anchor = query_as!(
        PdfPlaceableCommentAnchor,
        r#"
        INSERT INTO "PdfPlaceableCommentAnchor" (
            "uuid", "owner", "threadId", "page", "originalPage", "originalIndex", 
            "xPct", "yPct", "widthPct", "heightPct", "allowableEdits", 
            "wasEdited", "wasDeleted", "shouldLockOnSave", "documentId", "rotation"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        anchor.uuid.unwrap_or(Uuid::new_v4()),
        owner,
        thread_id,
        anchor.page,
        anchor.original_page,
        anchor.original_index,
        anchor.x_pct,
        anchor.y_pct,
        anchor.width_pct,
        anchor.height_pct,
        anchor.allowable_edits,
        anchor.was_edited,
        anchor.was_deleted,
        anchor.should_lock_on_save,
        document_id,
        anchor.rotation
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(inserted_anchor)
}

async fn create_pdf_highlight_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    owner: &str,
    document_id: &str,
    thread_id: Option<i64>,
    anchor: PdfHighlightAnchorRequest,
) -> Result<PdfHighlightAnchor> {
    if let Some(thread_id) = thread_id {
        validate_thread_exists(transaction.as_mut(), thread_id).await?;
    }

    let anchor_uuid = query_scalar!(
        r#"
        INSERT INTO "PdfHighlightAnchor" (
            "uuid", "documentId", "owner", "threadId", "page", "red", "green", "blue", 
            "alpha", "type", "text", "pageViewportWidth", "pageViewportHeight"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING uuid
        "#,
        anchor.uuid.unwrap_or(Uuid::new_v4()),
        document_id,
        owner,
        thread_id,
        anchor.page,
        anchor.red,
        anchor.green,
        anchor.blue,
        anchor.alpha,
        anchor.highlight_type as i32,
        anchor.text,
        anchor.page_viewport_width,
        anchor.page_viewport_height
    )
    .fetch_one(transaction.as_mut())
    .await?;

    let mut anchor_ids = Vec::new();
    let mut top_values = Vec::new();
    let mut left_values = Vec::new();
    let mut width_values = Vec::new();
    let mut height_values = Vec::new();

    for rect in &anchor.highlight_rects {
        anchor_ids.push(anchor_uuid);
        top_values.push(rect.top);
        left_values.push(rect.left);
        width_values.push(rect.width);
        height_values.push(rect.height);
    }

    // Execute bulk insert using UNNEST
    sqlx::query!(
        r#"
    INSERT INTO "PdfHighlightRect" ("pdfHighlightAnchorId", "top", "left", "width", "height")
    SELECT *
    FROM UNNEST(
        $1::uuid[], 
        $2::double precision[], 
        $3::double precision[], 
        $4::double precision[], 
        $5::double precision[]
    )
    "#,
        &anchor_ids,
        &top_values,
        &left_values,
        &width_values,
        &height_values,
    )
    .execute(transaction.as_mut())
    .await?;

    let inserted_anchor = query_as!(
        PdfHighlightAnchor,
        r#"
        SELECT 
            ph.uuid, 
            ph."documentId" as document_id,
            ph.owner, 
            ph."threadId" as thread_id, 
            ph.page, 
            ph.red,
            ph.green, 
            ph.blue, 
            ph.alpha, 
            ph.type as highlight_type, 
            ph.text, 
            ph."pageViewportWidth" as page_viewport_width, 
            ph."pageViewportHeight" as page_viewport_height, 
            ph."createdAt"::timestamptz as created_at, 
            ph."updatedAt"::timestamptz as updated_at, 
            ph."deletedAt"::timestamptz as deleted_at, 
            array_agg((phr.id, phr.top, phr.left, phr.width, phr.height)) as "highlight_rects!: Vec<PdfHighlightRect>"
        FROM "PdfHighlightAnchor" ph
        JOIN "PdfHighlightRect" phr ON ph.uuid = phr."pdfHighlightAnchorId"
        WHERE ph.uuid = $1
        GROUP BY ph.uuid, ph.owner, ph."threadId", ph.page, ph.red, ph.green, ph.blue, ph.alpha, ph.type, ph.text, ph."pageViewportWidth", ph."pageViewportHeight", ph."createdAt", ph."updatedAt", ph."deletedAt"
        "#,
        anchor_uuid
    )
    .fetch_one(transaction.as_mut())
    .await?;

    Ok(inserted_anchor)
}

#[cfg(test)]
mod create_comment_anchor_tests {
    use crate::annotations::get::fetch_pdf_highlight_anchors;

    use super::*;
    use model::annotations::{HighlightType, create::PdfHighlightRectAnchorRequest};
    use sqlx::{PgPool, types::Uuid};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_pdf_placeable_anchor(pool: PgPool) {
        let mut transaction = pool.begin().await.unwrap();
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request = PdfPlaceableCommentAnchorRequest {
            uuid: None,
            page: 1,
            original_page: 1,
            original_index: 0,
            x_pct: 0.2,
            y_pct: 0.3,
            width_pct: 0.1,
            height_pct: 0.05,
            rotation: 0.0,
            allowable_edits: None,
            was_edited: false,
            was_deleted: false,
            should_lock_on_save: true,
        };

        let result =
            create_pdf_placeable_anchor(&mut transaction, owner, document_id, 1001, anchor_request)
                .await;
        let anchor = result.unwrap();

        assert_eq!(anchor.owner, "macro|user@user.com");
        assert_eq!(anchor.thread_id, 1001);
        assert_eq!(anchor.page, 1);
        assert_eq!(anchor.original_page, 1);
        assert_eq!(anchor.original_index, 0);
        assert_eq!(anchor.x_pct, 0.2);
        assert_eq!(anchor.y_pct, 0.3);
        assert_eq!(anchor.width_pct, 0.1);
        assert_eq!(anchor.height_pct, 0.05);
        assert_eq!(anchor.allowable_edits, None);
        assert_eq!(anchor.was_edited, false);
        assert_eq!(anchor.was_deleted, false);
        assert_eq!(anchor.should_lock_on_save, true);
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_pdf_highlight_anchor(pool: PgPool) {
        let mut transaction = pool.begin().await.unwrap();
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let highlight_anchor_request = PdfHighlightAnchorRequest {
            uuid: Some(Uuid::new_v4()),
            page: 1,
            red: 255,
            green: 0,
            blue: 0,
            alpha: 0.8,
            highlight_type: HighlightType::Highlight,
            text: "Highlighted text".to_string(),
            page_viewport_width: 800.0,
            page_viewport_height: 1000.0,
            highlight_rects: vec![
                PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                },
                PdfHighlightRectAnchorRequest {
                    top: 160.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                },
            ],
        };

        let result = create_pdf_highlight_anchor(
            &mut transaction,
            owner,
            document_id,
            Some(1001),
            highlight_anchor_request,
        )
        .await;
        assert!(result.is_ok(), "Failed to create highlight anchor");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_comment_anchor_invalid_thread_id(pool: PgPool) {
        let mut transaction = pool.begin().await.unwrap();
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request = AnchorRequest::Pdf(PdfAnchorRequest::FreeComment(
            PdfPlaceableCommentAnchorRequest {
                uuid: Some(Uuid::new_v4()),
                page: 1,
                original_page: 1,
                original_index: 0,
                x_pct: 0.2,
                y_pct: 0.3,
                width_pct: 0.1,
                height_pct: 0.05,
                rotation: 0.0,
                allowable_edits: None,
                was_edited: false,
                was_deleted: false,
                should_lock_on_save: true,
            },
        ));

        let result =
            create_comment_anchor(&mut transaction, owner, document_id, anchor_request, 9849).await;

        assert!(result.is_err(), "Should fail when thread IDs do not match");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_free_comment_anchor_with_deleted_thread_id(pool: PgPool) {
        let mut transaction = pool.begin().await.unwrap();
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";
        let deleted_thread_id = 1004;

        let anchor_request = AnchorRequest::Pdf(PdfAnchorRequest::FreeComment(
            PdfPlaceableCommentAnchorRequest {
                uuid: Some(Uuid::new_v4()),
                page: 1,
                original_page: 1,
                original_index: 0,
                x_pct: 0.2,
                y_pct: 0.3,
                width_pct: 0.1,
                height_pct: 0.05,
                rotation: 0.0,
                allowable_edits: None,
                was_edited: false,
                was_deleted: false,
                should_lock_on_save: true,
            },
        ));

        let result = create_comment_anchor(
            &mut transaction,
            owner,
            document_id,
            anchor_request,
            deleted_thread_id,
        )
        .await;

        assert_eq!(result.unwrap_err().to_string(), "Thread not found");
    }
    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_highlight_anchor_with_invalid_thread_id(pool: PgPool) {
        let mut transaction = pool.begin().await.unwrap();
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request =
            AnchorRequest::Pdf(PdfAnchorRequest::Highlight(PdfHighlightAnchorRequest {
                uuid: Some(Uuid::new_v4()),
                page: 1,
                red: 255,
                green: 0,
                blue: 0,
                alpha: 0.8,
                highlight_type: HighlightType::Highlight,
                text: "Test Highlight".to_string(),
                page_viewport_width: 800.0,
                page_viewport_height: 1000.0,
                highlight_rects: vec![PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                }],
            }));

        let result =
            create_comment_anchor(&mut transaction, owner, document_id, anchor_request, 9849).await;

        assert!(
            result.is_err(),
            "Should fail when highlight anchor has invalid thread ID"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_highlight_anchor_with_deleted_thread_id(pool: PgPool) {
        let mut transaction = pool.begin().await.unwrap();
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";
        let deleted_thread_id = 1004;

        let anchor_request =
            AnchorRequest::Pdf(PdfAnchorRequest::Highlight(PdfHighlightAnchorRequest {
                uuid: Some(Uuid::new_v4()),
                page: 1,
                red: 255,
                green: 0,
                blue: 0,
                alpha: 0.8,
                highlight_type: HighlightType::Highlight,
                text: "Test Highlight".to_string(),
                page_viewport_width: 800.0,
                page_viewport_height: 1000.0,
                highlight_rects: vec![PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                }],
            }));

        let result = create_comment_anchor(
            &mut transaction,
            owner,
            document_id,
            anchor_request,
            deleted_thread_id,
        )
        .await;

        assert_eq!(result.unwrap_err().to_string(), "Thread not found");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_independent_pdf_highlight_anchor(pool: PgPool) {
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request = CreateUnthreadedAnchorRequest::Pdf(
            CreateUnthreadedPdfAnchorRequest::Highlight(PdfHighlightAnchorRequest {
                uuid: None,
                page: 1,
                red: 255,
                green: 0,
                blue: 0,
                alpha: 0.8,
                highlight_type: HighlightType::Highlight,
                text: "Test Highlight".to_string(),
                page_viewport_width: 800.0,
                page_viewport_height: 1000.0,
                highlight_rects: vec![PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                }],
            }),
        );

        let result = create_unthreaded_anchor(&pool, owner, document_id, anchor_request).await;

        let CreateUnthreadedAnchorResponse { anchor, .. } = result.unwrap();
        if let Anchor::Pdf(PdfAnchor::Highlight(highlight_anchor)) = anchor {
            assert_eq!(highlight_anchor.thread_id, None);
        } else {
            panic!("Unexpected anchor type");
        }
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_attach_highlight_anchor(pool: Pool<Postgres>) {
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request = CreateUnthreadedAnchorRequest::Pdf(
            CreateUnthreadedPdfAnchorRequest::Highlight(PdfHighlightAnchorRequest {
                uuid: None,
                page: 1,
                red: 255,
                green: 0,
                blue: 0,
                alpha: 0.8,
                highlight_type: HighlightType::Highlight,
                text: "Test Highlight".to_string(),
                page_viewport_width: 800.0,
                page_viewport_height: 1000.0,
                highlight_rects: vec![PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                }],
            }),
        );

        let result = create_unthreaded_anchor(&pool, owner, document_id, anchor_request).await;

        let CreateUnthreadedAnchorResponse { anchor, .. } = result.unwrap();
        let uuid;
        if let Anchor::Pdf(PdfAnchor::Highlight(highlight_anchor)) = anchor {
            assert_eq!(highlight_anchor.thread_id, None);
            uuid = highlight_anchor.uuid;
        } else {
            panic!("Unexpected anchor type");
        }

        let mut transaction = pool.begin().await.unwrap();
        let result = attach_pdf_highlight_anchor(&mut transaction, 1005, uuid).await;
        transaction.commit().await.unwrap();

        let highlight_anchor = result.unwrap();
        assert_eq!(highlight_anchor.thread_id, Some(1005));
        assert_eq!(highlight_anchor.uuid, uuid);

        let document_anchors = fetch_pdf_highlight_anchors(&pool, document_id)
            .await
            .unwrap();
        let matching_anchor = document_anchors
            .iter()
            .find(|a| a.uuid == uuid)
            .expect("Anchor should exist");

        assert_eq!(matching_anchor.thread_id, Some(1005));
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_cannot_attach_to_existing_anchored_thread(pool: Pool<Postgres>) {
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request = CreateUnthreadedAnchorRequest::Pdf(
            CreateUnthreadedPdfAnchorRequest::Highlight(PdfHighlightAnchorRequest {
                uuid: None,
                page: 1,
                red: 255,
                green: 0,
                blue: 0,
                alpha: 0.8,
                highlight_type: HighlightType::Highlight,
                text: "Test Highlight".to_string(),
                page_viewport_width: 800.0,
                page_viewport_height: 1000.0,
                highlight_rects: vec![PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                }],
            }),
        );

        let result = create_unthreaded_anchor(&pool, owner, document_id, anchor_request).await;

        let CreateUnthreadedAnchorResponse { anchor, .. } = result.unwrap();
        let uuid;
        if let Anchor::Pdf(PdfAnchor::Highlight(highlight_anchor)) = anchor {
            assert_eq!(highlight_anchor.thread_id, None);
            uuid = highlight_anchor.uuid;
        } else {
            panic!("Unexpected anchor type");
        }

        let mut transaction = pool.begin().await.unwrap();
        let result = attach_pdf_highlight_anchor(&mut transaction, 1001, uuid).await;
        transaction.commit().await.unwrap();

        assert!(result.is_err());
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_attach_highlight_anchor_uuid_not_found(pool: Pool<Postgres>) {
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";

        let anchor_request = CreateUnthreadedAnchorRequest::Pdf(
            CreateUnthreadedPdfAnchorRequest::Highlight(PdfHighlightAnchorRequest {
                uuid: None,
                page: 1,
                red: 255,
                green: 0,
                blue: 0,
                alpha: 0.8,
                highlight_type: HighlightType::Highlight,
                text: "Test Highlight".to_string(),
                page_viewport_width: 800.0,
                page_viewport_height: 1000.0,
                highlight_rects: vec![PdfHighlightRectAnchorRequest {
                    top: 100.0,
                    left: 50.0,
                    width: 200.0,
                    height: 50.0,
                }],
            }),
        );

        let result = create_unthreaded_anchor(&pool, owner, document_id, anchor_request).await;

        let CreateUnthreadedAnchorResponse { anchor, .. } = result.unwrap();
        if let Anchor::Pdf(PdfAnchor::Highlight(highlight_anchor)) = anchor {
            assert_eq!(highlight_anchor.thread_id, None);
        } else {
            panic!("Unexpected anchor type");
        }

        let mut transaction = pool.begin().await.unwrap();
        let result = attach_pdf_highlight_anchor(&mut transaction, 1001, Uuid::new_v4()).await;
        transaction.commit().await.unwrap();

        // TODO: this should fail because the uuid is different?
        assert!(result.is_err(), "Should not update anchor without uuid");
    }
}
