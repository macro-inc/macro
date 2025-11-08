use sqlx::{Pool, Postgres};

use super::get_project::get_sub_items::get_all_sub_project_ids;

#[tracing::instrument(skip(db))]
pub async fn is_project_recursively_nested<'a>(
    db: Pool<Postgres>,
    project_id: &str,
    parent_id: &str,
) -> anyhow::Result<Option<String>> {
    // get the projects sub-projects
    let mut transaction = db.begin().await?;
    let sub_projects = get_all_sub_project_ids(&mut transaction, project_id).await?;
    transaction.commit().await?;

    // Filter out the project itself
    let sub_projects = sub_projects
        .into_iter()
        .filter_map(|p| {
            if p == project_id {
                return None;
            }
            Some(p)
        })
        .collect::<Vec<String>>();

    if sub_projects.is_empty() {
        return Ok(None);
    }

    let conflicting_project = sub_projects
        .into_iter()
        .filter(|id| id == parent_id)
        .collect::<Vec<String>>();

    if conflicting_project.is_empty() {
        return Ok(None);
    }

    Ok(Some(conflicting_project.join(", ")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct TestFixture<'a> {
        project_id: &'a str,
        parent_id: &'a str,
        expected_result: Option<String>,
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("users", "projects")))]
    async fn test_is_project_recursively_nested(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let tests: Vec<TestFixture> = vec![
            TestFixture {
                project_id: "p1",
                parent_id: "pb1",
                expected_result: None,
            },
            TestFixture {
                project_id: "p2",
                parent_id: "pb1",
                expected_result: None,
            },
            TestFixture {
                project_id: "pb1",
                parent_id: "p11",
                expected_result: None,
            },
            TestFixture {
                project_id: "p6",
                parent_id: "p1",
                expected_result: None,
            },
            TestFixture {
                project_id: "p1",
                parent_id: "p2",
                expected_result: Some("p2".to_string()),
            },
            TestFixture {
                project_id: "p1",
                parent_id: "p6",
                expected_result: Some("p6".to_string()),
            },
            TestFixture {
                project_id: "p1",
                parent_id: "p11",
                expected_result: Some("p11".to_string()),
            },
        ];

        for test in tests {
            let project_id = test.project_id;
            let parent_id = test.parent_id;
            let expected_result = test.expected_result;
            let result: Option<String> =
                match is_project_recursively_nested(pool.clone(), project_id, parent_id).await {
                    Ok(e) => e,
                    Err(e) => return Err(e),
                };

            assert_eq!(
                (project_id, parent_id, expected_result),
                (project_id, parent_id, result)
            );
        }

        Ok(())
    }
}
