use super::*;
use chrono::NaiveDateTime;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("recently_deleted")))]
async fn returns_old_deleted_projects_with_owners(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let cutoff = NaiveDateTime::parse_from_str("2020-01-01 00:00:00", "%Y-%m-%d %H:%M:%S")?;
    let mut projects = get_projects_to_delete(&pool, &cutoff).await?;
    projects.sort_unstable_by(|left, right| left.project_id.cmp(&right.project_id));

    assert_eq!(
        projects,
        vec![
            ProjectToDelete {
                project_id: "p1".to_owned(),
                user_id: "macro|user@user.com".to_owned(),
            },
            ProjectToDelete {
                project_id: "p2".to_owned(),
                user_id: "macro|user@user.com".to_owned(),
            },
            ProjectToDelete {
                project_id: "p3".to_owned(),
                user_id: "macro|user@user.com".to_owned(),
            },
        ]
    );

    Ok(())
}
