use anyhow::Context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;

    println!("DELETING DOCUMENT");
    client
        .delete_document("33591bbc-6a78-4748-93ca-8c9483201059")
        .await?;

    Ok(())
}
