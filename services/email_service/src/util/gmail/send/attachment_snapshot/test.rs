use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn link() -> Uuid {
    Uuid::parse_str("00000000-0000-0000-0000-000000000f01").unwrap()
}

fn draft() -> Uuid {
    Uuid::parse_str("00000000-0000-0000-0000-00000000f501").unwrap()
}

fn original() -> Uuid {
    Uuid::parse_str("00000000-0000-0000-0000-00000000f301").unwrap()
}

fn approved() -> ApprovedAttachments {
    ApprovedAttachments {
        uploaded: vec![],
        forwarded: vec![
            Uuid::parse_str("00000000-0000-0000-0000-0000000fa001").unwrap(),
            Uuid::parse_str("00000000-0000-0000-0000-0000000fa002").unwrap(),
        ],
    }
}

#[test]
fn missing_uploaded_bytes_require_review_but_transient_storage_errors_remain_retryable() {
    use aws_sdk_s3::operation::get_object::GetObjectError;
    let missing = GetObjectError::NoSuchKey(aws_sdk_s3::types::error::NoSuchKey::builder().build());
    let sdk_error = aws_sdk_s3::error::SdkError::service_error(missing, ());
    let error =
        classify_uploaded_attachment_error(anyhow::Error::new(sdk_error).context("S3 read"));
    assert!(error.downcast_ref::<AttachmentSnapshotMismatch>().is_some());
    let transient = classify_uploaded_attachment_error(anyhow::anyhow!("temporary storage outage"));
    assert!(
        transient
            .downcast_ref::<AttachmentSnapshotMismatch>()
            .is_none()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../../crates/email_db_client/fixtures",
        scripts("forwarded_attachments")
    )
)]
async fn source_deletion_before_preparation_rejects_incomplete_payload(
    pool: PgPool,
) -> anyhow::Result<()> {
    email_db_client::messages::delete::delete_db_message(&pool, original()).await?;
    let result = AttachmentMetadata::load(&pool, link(), draft(), Some(&approved())).await;
    let Err(error) = result else {
        panic!("missing approved attachments must reject preparation");
    };
    assert!(error.downcast_ref::<AttachmentSnapshotMismatch>().is_some());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../../crates/email_db_client/fixtures",
        scripts("forwarded_attachments")
    )
)]
async fn source_deletion_after_snapshot_cannot_shrink_the_payload(
    pool: PgPool,
) -> anyhow::Result<()> {
    let snapshot = AttachmentMetadata::load(&pool, link(), draft(), Some(&approved())).await?;
    email_db_client::messages::delete::delete_db_message(&pool, original()).await?;
    let current = email_db_client::attachments::forwarded::fetch_forwarded_attachments_by_draft_id(
        &pool,
        link(),
        draft(),
    )
    .await?;
    assert!(current.is_empty());
    assert_eq!(snapshot.forwarded.len(), 2);
    assert!(
        snapshot
            .forwarded
            .iter()
            .all(|attachment| attachment.message_provider_id == "gmail-original-msg-001")
    );
    assert_eq!(
        snapshot.forwarded[0].provider_attachment_id.as_deref(),
        Some("gmail-att-id-002")
    );
    assert_eq!(
        snapshot.forwarded[1].provider_attachment_id.as_deref(),
        Some("gmail-att-id-001")
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../../crates/email_db_client/fixtures",
        scripts("forwarded_attachments")
    )
)]
async fn legacy_delivery_without_an_approved_set_uses_existing_attachments(
    pool: PgPool,
) -> anyhow::Result<()> {
    let snapshot = AttachmentMetadata::load(&pool, link(), draft(), None).await?;
    assert_eq!(snapshot.forwarded.len(), 2);
    assert!(snapshot.uploaded.is_empty());
    Ok(())
}
