use anyhow::Context;
use opensearch_client::search::projects::ProjectSearchArgs;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;

    println!("Client created, checking health...");
    client.health().await?;
    println!("Health check passed");

    // Search examples based on the sample data from upsert_project.rs
    let search_scenarios = vec![
        ("AI", "user_123", "Search for AI projects"),
        ("Research", "user_123", "Search for Research projects"),
        ("Web", "user_456", "Search for Web projects"),
        ("React", "user_456", "Search for React projects"),
        ("Data", "user_789", "Search for Data projects"),
        ("", "user_123", "Get all projects for user_123"),
    ];

    for (term, user_id, description) in search_scenarios {
        println!("\n--- {} ---", description);

        let search_args = ProjectSearchArgs {
            terms: if term.is_empty() {
                vec![]
            } else {
                vec![term.to_string()]
            },
            user_id: user_id.to_string(),
            page: 0,
            page_size: 10,
            match_type: "exact".to_string(),
            ..Default::default()
        };

        match client.search_project(search_args).await {
            Ok(results) => {
                println!("Found {} results:", results.len());
                for result in results {
                    println!(
                        "  - {} ({}): {}",
                        result.project_id, result.user_id, result.project_name
                    );
                }
            }
            Err(e) => println!("Search failed: {}", e),
        }
    }

    println!("\n--- Partial match search ---");
    let partial_search = ProjectSearchArgs {
        terms: vec!["Dev".to_string()],
        user_id: "user_456".to_string(),
        page: 0,
        page_size: 10,
        match_type: "partial".to_string(),
        ..Default::default()
    };

    match client.search_project(partial_search).await {
        Ok(results) => {
            println!("Found {} results with partial match:", results.len());
            for result in results {
                println!(
                    "  - {} ({}): {}",
                    result.project_id, result.user_id, result.project_name
                );
            }
        }
        Err(e) => println!("Partial search failed: {}", e),
    }

    Ok(())
}
