use anyhow::{anyhow, Result};

use crate::config::DOCUMENT_PROCESSING_SERVICE_URL;
use crate::model::post::PostData;

pub async fn send_to_document_processing_service(
    client: &reqwest::Client,
    post_data: &PostData<'_>,
) -> Result<()> {
    let url = &*DOCUMENT_PROCESSING_SERVICE_URL;
    let res = client.post(url).json(&post_data).send().await?;

    if let Err(e) = res.error_for_status_ref() {
        let response_body = res.text().await.unwrap_or_else(|_| String::new());
        return Err(anyhow!(format!(
            "Failed to send job to document processing service {:?}. Response body: {}",
            e, response_body
        )));
    }

    Ok(())
}
