use anyhow::Context;
use opensearch_client::date_format::EpochSeconds;
use opensearch_client::upsert::project::UpsertProjectArgs;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = opensearch_client::OpensearchClient::new(url, username, password)?;

    println!("Client created, checking health...");
    client.health().await?;
    println!("Health check passed");

    // Sample project data
    let sample_projects = vec![
        UpsertProjectArgs {
            project_id: "proj_001".to_string(),
            user_id: "user_123".to_string(),
            project_name: "AI Research Project".to_string(),
            created_at_seconds: EpochSeconds::new(1642723200)?, // 2022-01-21 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642723200)?,
        },
        UpsertProjectArgs {
            project_id: "proj_002".to_string(),
            user_id: "user_123".to_string(),
            project_name: "Machine Learning Models".to_string(),
            created_at_seconds: EpochSeconds::new(1642809600)?, // 2022-01-22 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642809600)?,
        },
        UpsertProjectArgs {
            project_id: "proj_003".to_string(),
            user_id: "user_456".to_string(),
            project_name: "Web Development".to_string(),
            created_at_seconds: EpochSeconds::new(1642896000)?, // 2022-01-23 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642896000)?,
        },
        UpsertProjectArgs {
            project_id: "proj_004".to_string(),
            user_id: "user_456".to_string(),
            project_name: "React Frontend".to_string(),
            created_at_seconds: EpochSeconds::new(1642982400)?, // 2022-01-24 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642982400)?,
        },
        UpsertProjectArgs {
            project_id: "proj_005".to_string(),
            user_id: "user_789".to_string(),
            project_name: "Data Analysis Pipeline".to_string(),
            created_at_seconds: EpochSeconds::new(1643068800)?, // 2022-01-25 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1643068800)?,
        },
    ];

    println!("Upserting {} projects...", sample_projects.len());

    for (i, project) in sample_projects.iter().enumerate() {
        println!(
            "Upserting project {}/{}: {}",
            i + 1,
            sample_projects.len(),
            project.project_name
        );

        match client.upsert_project(project).await {
            Ok(()) => println!("✓ Successfully upserted project {}", project.project_id),
            Err(e) => println!("✗ Failed to upsert project {}: {}", project.project_id, e),
        }
    }

    println!("Finished upserting projects");
    Ok(())
}
