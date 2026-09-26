use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assignee_sharing_adds_manageable_collaborators_without_owner_downgrade(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Launch", &[TEAMMATE]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    repo.grant_assignees(created.id, vec![user(OWNER), user(MEMBER)])
        .await?;
    repo.grant_assignees(created.id, vec![user(MEMBER)]).await?;

    let detail = repo.get_detail(created.id).await?.expect("project exists");
    assert_eq!(detail.member_ids.len(), 2);
    assert!(detail.member_ids.contains(&user(MEMBER)));
    assert!(detail.member_ids.contains(&user(TEAMMATE)));
    assert_eq!(
        mirrored_access(&pool, created.id, created.description_document_id, MEMBER).await?,
        (Some("edit".into()), Some("edit".into()))
    );
    assert_eq!(
        mirrored_access(&pool, created.id, created.description_document_id, OWNER).await?,
        (Some("owner".into()), Some("owner".into()))
    );

    // Clearing the assignee property sends an empty grant set and keeps the share.
    repo.grant_assignees(created.id, vec![]).await?;
    assert_eq!(
        repo.get_detail(created.id)
            .await?
            .expect("project exists")
            .member_ids,
        detail.member_ids
    );

    // The existing collaborator update is the owner's explicit access-revocation path.
    repo.update(UpdateInitiativeRepoArgs {
        member_ids_removed: vec![user(MEMBER)],
        ..update_args(created.id)
    })
    .await?;
    assert_eq!(
        repo.get_detail(created.id)
            .await?
            .expect("project exists")
            .member_ids,
        vec![user(TEAMMATE)]
    );
    assert_eq!(
        mirrored_access(&pool, created.id, created.description_document_id, MEMBER).await?,
        (None, None)
    );
    Ok(())
}

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
