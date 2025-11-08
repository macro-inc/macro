use anyhow::Context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;

    println!("Client created");

    if let Err(e) = client.health().await {
        println!("Unable to connect to OpenSearch: {e}");
    }

    println!("OpenSearch health check passed");

    Ok(())
}
