use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("project_preview")))]
async fn test_batch_get_project_preview_v2(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let project_ids = vec![
        "project-one".to_string(),
        "project-two".to_string(),
        "non-existent-proj".to_string(),
    ];

    let results = batch_get_project_preview_v2(&pool, &project_ids).await?;

    assert_eq!(results.len(), 3);

    match &results[0] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "project-one");
            assert_eq!(data.name, "test_project_name");
            assert_eq!(data.path, vec!["test_project_name"]);
        }
        _ => panic!("Expected Found variant for project-one"),
    }

    match &results[1] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "project-two");
            assert_eq!(data.path, vec!["test_project_name"]);
        }
        _ => panic!("Expected Found variant for project-two"),
    }

    match &results[2] {
        ProjectPreviewV2::DoesNotExist(data) => {
            assert_eq!(data.id, "non-existent-proj");
        }
        _ => panic!("Expected DoesNotExist variant for non-existent-proj"),
    }

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("project_preview_nested")))]
async fn test_batch_get_project_preview_nested(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let project_ids = vec![
        "root-project".to_string(),
        "level1-project".to_string(),
        "level2-project".to_string(),
        "level3-project".to_string(),
        "alt-level1-project".to_string(),
        "standalone-project".to_string(),
    ];

    let results = batch_get_project_preview_v2(&pool, &project_ids).await?;

    assert_eq!(results.len(), 6);

    match &results[0] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "root-project");
            assert_eq!(data.name, "Root Project");
            assert_eq!(data.path, vec!["Root Project"]);
        }
        _ => panic!("Expected Found variant for root-project"),
    }

    match &results[1] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "level1-project");
            assert_eq!(data.name, "Level 1");
            assert_eq!(data.path, vec!["Root Project", "Level 1"]);
        }
        _ => panic!("Expected Found variant for level1-project"),
    }

    match &results[2] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "level2-project");
            assert_eq!(data.name, "Level 2");
            assert_eq!(data.path, vec!["Root Project", "Level 1", "Level 2"]);
        }
        _ => panic!("Expected Found variant for level2-project"),
    }

    match &results[3] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "level3-project");
            assert_eq!(data.name, "Level 3");
            assert_eq!(
                data.path,
                vec!["Root Project", "Level 1", "Level 2", "Level 3"]
            );
        }
        _ => panic!("Expected Found variant for level3-project"),
    }

    match &results[4] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "alt-level1-project");
            assert_eq!(data.name, "Alt Branch");
            assert_eq!(data.path, vec!["Root Project", "Alt Branch"]);
        }
        _ => panic!("Expected Found variant for alt-level1-project"),
    }

    match &results[5] {
        ProjectPreviewV2::Found(data) => {
            assert_eq!(data.id, "standalone-project");
            assert_eq!(data.name, "Standalone");
            assert_eq!(data.path, vec!["Standalone"]);
        }
        _ => panic!("Expected Found variant for standalone-project"),
    }

    Ok(())
}
