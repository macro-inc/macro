use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../../fixtures", scripts("users", "project-content")))]
async fn test_get_projects_document_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut transaction = pool.begin().await?;

    let project_ids =
        get_projects_document_ids(&mut transaction, &vec!["p1".to_string(), "p6".to_string()])
            .await?;

    assert_eq!(project_ids.len(), 2);
    assert_eq!(project_ids[0], "document-one");
    assert_eq!(project_ids[1], "document-two");

    transaction.commit().await?;

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../../fixtures", scripts("users", "sub_projects")))]
async fn test_bulk_get_all_sub_project_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let project_ids = vec!["p1".to_string(), "p2".to_string(), "p99".to_string()];

    let mut result = bulk_get_all_sub_project_ids(&pool, &project_ids).await?;

    result.sort();

    assert_eq!(
        result,
        vec!["p1", "p1a", "p1b", "p1c", "p1d", "p2", "p2a", "p2b"]
            .iter()
            .map(|a| a.to_string())
            .collect::<Vec<String>>()
    );

    Ok(())
}
