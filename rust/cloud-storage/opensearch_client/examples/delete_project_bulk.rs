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

    // Sample project data to create
    let sample_projects = vec![
        UpsertProjectArgs {
            project_id: "bulk_proj_001".to_string(),
            user_id: "user_bulk_test".to_string(),
            project_name: "Bulk Test Project 1".to_string(),
            created_at_seconds: EpochSeconds::new(1642723200)?, // 2022-01-21 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642723200)?,
        },
        UpsertProjectArgs {
            project_id: "bulk_proj_002".to_string(),
            user_id: "user_bulk_test".to_string(),
            project_name: "Bulk Test Project 2".to_string(),
            created_at_seconds: EpochSeconds::new(1642809600)?, // 2022-01-22 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642809600)?,
        },
        UpsertProjectArgs {
            project_id: "bulk_proj_003".to_string(),
            user_id: "user_bulk_test".to_string(),
            project_name: "Bulk Test Project 3".to_string(),
            created_at_seconds: EpochSeconds::new(1642896000)?, // 2022-01-23 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642896000)?,
        },
        UpsertProjectArgs {
            project_id: "bulk_proj_004".to_string(),
            user_id: "user_bulk_test".to_string(),
            project_name: "Bulk Test Project 4".to_string(),
            created_at_seconds: EpochSeconds::new(1642982400)?, // 2022-01-24 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1642982400)?,
        },
        UpsertProjectArgs {
            project_id: "bulk_proj_005".to_string(),
            user_id: "user_bulk_test".to_string(),
            project_name: "Bulk Test Project 5".to_string(),
            created_at_seconds: EpochSeconds::new(1643068800)?, // 2022-01-25 00:00:00 UTC
            updated_at_seconds: EpochSeconds::new(1643068800)?,
        },
    ];

    println!(
        "Creating {} projects for bulk deletion test...",
        sample_projects.len()
    );

    // Create projects first
    for (i, project) in sample_projects.iter().enumerate() {
        println!(
            "Creating project {}/{}: {}",
            i + 1,
            sample_projects.len(),
            &project.project_name
        );

        match client.upsert_project(project).await {
            Ok(()) => println!("[OK] Successfully created project {}", project.project_id),
            Err(e) => println!(
                "[ERROR] Failed to create project {}: {}",
                project.project_id, e
            ),
        }
    }

    println!("\nProjects created successfully!");
    println!("Now testing bulk deletion...");

    // Collect project IDs for bulk deletion
    let project_ids: Vec<String> = sample_projects
        .iter()
        .map(|p| p.project_id.to_string())
        .collect();

    println!("Deleting {} projects in bulk...", project_ids.len());
    println!("Project IDs to delete: {:?}", project_ids);

    let project_count = project_ids.len();
    match client.delete_project_bulk(&project_ids.clone()).await {
        Ok(()) => {
            println!(
                "[OK] Successfully deleted all {} projects in bulk",
                project_count
            );
            println!("Bulk deletion completed successfully!");
        }
        Err(e) => {
            println!("[ERROR] Failed to delete projects in bulk: {}", e);
            println!("Attempting individual cleanup...");

            // Fallback to individual deletion if bulk fails
            for project_id in project_ids {
                match client.delete_project(&project_id).await {
                    Ok(()) => println!("[OK] Cleaned up project {}", project_id),
                    Err(e) => println!("[ERROR] Failed to clean up project {}: {}", project_id, e),
                }
            }
        }
    }

    println!("Bulk deletion test completed!");
    Ok(())
}
