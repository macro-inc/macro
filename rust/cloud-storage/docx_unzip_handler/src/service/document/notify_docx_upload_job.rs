use std::sync::Arc;

use lambda_runtime::tracing::{self};
use sqlx::{Pool, Postgres};

use crate::models::{DocxUploadJobData, DocxUploadJobResult};

/// Sends failed response to job if present
#[tracing::instrument(skip(db, lambda_client))]
pub async fn handle_docx_unzip_failure(
    db: Pool<Postgres>,
    lambda_client: Arc<lambda_client::Lambda>,
    function_name: &str,
    document_id: &str,
) -> anyhow::Result<()> {
    let result = macro_db_client::docx_unzip::get_job_for_docx_upload(&db, document_id).await?;

    if let Some((job_id, job_type)) = result {
        tracing::trace!(document_id=?document_id, "docx unzip failed");
        lambda_client
            .invoke_event(
                function_name,
                &DocxUploadJobResult {
                    job_id: job_id.into(),
                    status: "Failed".into(),
                    job_type: job_type.into(),
                    data: DocxUploadJobData {
                        error: true,
                        message: Some("error unzipping document".to_string()),
                        data: None,
                    },
                },
            )
            .await?;
    }

    Ok(())
}
