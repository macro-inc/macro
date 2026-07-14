use anyhow::Result;
use model::citations::{DocumentReference, DocumentTextPart};
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_part_by_id(db: Pool<Postgres>, id: &str) -> Result<Option<DocumentTextPart>> {
    let record = sqlx::query!(
        r#"
            SELECT reference, "documentId"
            FROM "DocumentTextParts"
            WHERE id = $1
        "#,
        id
    )
    .fetch_optional(&db)
    .await?;

    Ok(record.map(|r| {
        let reference: DocumentReference =
            serde_json::from_str(&r.reference).expect("invalid text part in db");
        DocumentTextPart {
            document_id: r.documentId,
            id: id.to_string(),
            reference,
        }
    }))
}
