use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn task_side_clear_is_idempotent_and_preserves_the_task(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let task_id = Uuid::now_v7().to_string();
    insert_document(&pool, &task_id, OWNER, true).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Launch", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.assign_tasks(created.id, vec![task_id.clone()]).await?;
    repo.clear_task(&task_id).await?;
    repo.clear_task(&task_id).await?;
    let detail = repo.get_detail(created.id).await?.expect("project exists");
    assert!(detail.task_ids.is_empty());
    assert!(detail.updated_at > created.updated_at);
    // Reassignment also proves that clearing preserved the task document/subtype.
    let assigned = repo.assign_tasks(created.id, vec![task_id]).await?;
    assert_eq!(assigned[0].status, AssignTaskStatus::Assigned);
    Ok(())
}
