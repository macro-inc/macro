use anyhow::Result;
use lambda_runtime::tracing;
use model::citations::TextReference;
use serde_json;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db, references))]
pub async fn insert_pdf_references(
    db: Pool<Postgres>,
    references: &Vec<TextReference>,
    document_id: &str,
) -> Result<()> {
    let mut refs = Vec::with_capacity(references.len());
    let mut ids = Vec::with_capacity(references.len());
    for r in references {
        refs.push(serde_json::to_string(&r.reference)?);
        ids.push(r.id.clone());
    }

    sqlx::query!(
        r#"
        INSERT INTO "DocumentTextParts" (id, reference, "documentId")
        SELECT id, ref, $1
        FROM UNNEST($2::text[], $3::text[])
        AS t(id, ref)
        ON CONFLICT (id) 
        DO UPDATE SET 
            reference = EXCLUDED.reference,
            "documentId" = EXCLUDED."documentId"
        "#,
        document_id,
        &ids,
        &refs
    )
    .fetch_optional(&db)
    .await?;
    Ok(())
}
