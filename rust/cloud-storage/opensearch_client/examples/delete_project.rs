use anyhow::Context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;

    println!("Client created, checking health...");
    client.health().await?;
    println!("Health check passed");

    // Project IDs to delete (matching the ones from upsert_project.rs)
    let project_ids = ["proj_001", "proj_002", "proj_003", "proj_004", "proj_005"];

    println!("Deleting {} projects...", project_ids.len());

    for (i, project_id) in project_ids.iter().enumerate() {
        println!(
            "Deleting project {}/{}: {}",
            i + 1,
            project_ids.len(),
            project_id
        );

        match client.delete_project(project_id).await {
            Ok(()) => println!("✓ Successfully deleted project {}", project_id),
            Err(e) => println!("✗ Failed to delete project {}: {}", project_id, e),
        }
    }

    println!("Finished deleting projects");
    Ok(())
}
