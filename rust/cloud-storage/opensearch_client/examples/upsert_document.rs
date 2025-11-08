use anyhow::Context;
use opensearch_client::date_format::EpochSeconds;
use opensearch_client::upsert::document::UpsertDocumentArgs;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let content = std::fs::read_to_string("fixtures/sample_file.md")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;
    client
        .upsert_document(&UpsertDocumentArgs {
            node_id: "node-id".to_string(),
            raw_content: None,
            document_id: "testing-id".to_string(),
            document_name: "sample_file".to_string(),
            file_type: "md".to_string(),
            owner_id: "macro|user@user.com".to_string(),
            content,
            updated_at_seconds: EpochSeconds::new(1704067200)?,
        })
        .await?;

    Ok(())
}
