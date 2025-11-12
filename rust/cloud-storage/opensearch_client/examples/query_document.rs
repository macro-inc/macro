use anyhow::Context;
use opensearch_client::SearchOn;
use opensearch_client::search::documents::DocumentSearchArgs;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;

    let result = client
        .search_documents(DocumentSearchArgs {
            terms: vec!["equation".to_string()],
            user_id: "user".to_string(),
            document_ids: Vec::new(),
            page: 0,
            page_size: 10,
            match_type: "partial".to_string(),
            search_on: SearchOn::Content,
            ids_only: false,
            collapse: false,
        })
        .await?;

    for document in result {
        println!("{:?}", document.document_id);
        println!("{:?}", document.highlight);
    }

    Ok(())
}
