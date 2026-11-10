use super::*;
use crate::domain::models::AgentHarnessSelection;

async fn report_workspaces(
    pool: &PgPool,
    harness: HarnessId,
    paths: &[&str],
) -> anyhow::Result<()> {
    let workspaces: Vec<Value> = paths
        .iter()
        .map(|path| json!({ "path": path, "kind": "repository" }))
        .collect();
    sqlx::query!(
        "UPDATE harnesses SET reported_workspaces = $2 WHERE id = $1",
        harness.as_uuid(),
        Value::Array(workspaces),
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_workspace_must_be_one_its_harness_reported(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, USER_OWNER).await?;
    let harness = insert_harness(&pool, Some(USER_OWNER), None).await?;
    report_workspaces(
        &pool,
        harness,
        &["/home/owner/code/api", "/home/owner/code/web"],
    )
    .await?;
    let service = service(&pool);

    let unreported = service
        .create_agent(
            user_id(USER_OWNER),
            CreateAgentRequest {
                workspace_path: Some("/etc".to_owned()),
                ..macrod_agent_req("unreported-workspace", Some(harness))
            },
        )
        .await;
    assert!(matches!(unreported, Err(BotError::BadRequest(_))));

    let created = service
        .create_agent(
            user_id(USER_OWNER),
            CreateAgentRequest {
                workspace_path: Some("/home/owner/code/api".to_owned()),
                ..macrod_agent_req("api-agent", Some(harness))
            },
        )
        .await?;
    assert_eq!(
        created.workspace_path.as_deref(),
        Some("/home/owner/code/api")
    );

    let mut update = update_agent_req("api-agent", AgentChannelScope::All);
    update.harness = "macrod".to_owned();
    update.harness_id = Some(harness);
    update.workspace_path = Some("/home/owner/code/web".to_owned());
    let updated = service
        .update_agent(user_id(USER_OWNER), created.bot.id, update)
        .await?;
    assert_eq!(
        PgBotsRepo::new(pool.clone())
            .get_agent(updated.bot.id)
            .await?
            .unwrap()
            .workspace_path
            .as_deref(),
        Some("/home/owner/code/web")
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_workspace_needs_a_registered_harness(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, USER_OWNER).await?;
    let service = service(&pool);

    let built_in = service
        .create_agent(
            user_id(USER_OWNER),
            CreateAgentRequest {
                workspace_path: Some("/home/owner/code".to_owned()),
                ..create_agent_req("built-in-workspace", AgentChannelScope::All)
            },
        )
        .await;

    assert!(matches!(built_in, Err(BotError::BadRequest(_))));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_kept_workspace_survives_and_moving_harness_drops_it(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, USER_OWNER).await?;
    let first = insert_harness(&pool, Some(USER_OWNER), None).await?;
    let second = insert_harness(&pool, Some(USER_OWNER), None).await?;
    report_workspaces(&pool, first, &["/home/owner/code/api"]).await?;
    let service = service(&pool);
    let created = service
        .create_agent(
            user_id(USER_OWNER),
            CreateAgentRequest {
                workspace_path: Some("/home/owner/code/api".to_owned()),
                ..macrod_agent_req("moving-agent", Some(first))
            },
        )
        .await?;

    // The daemon stops reporting the directory; unrelated edits still save.
    report_workspaces(&pool, first, &[]).await?;
    let renamed = service
        .patch_agent(
            user_id(USER_OWNER),
            created.bot.id,
            PatchAgentRequest {
                instructions: Some("Review pull requests.".to_owned()),
                harness: Some(AgentHarnessSelection {
                    harness: "macrod".to_owned(),
                    harness_id: Some(first),
                }),
                ..PatchAgentRequest::default()
            },
        )
        .await?;
    assert_eq!(
        renamed.workspace_path.as_deref(),
        Some("/home/owner/code/api")
    );

    let moved = service
        .patch_agent(
            user_id(USER_OWNER),
            created.bot.id,
            PatchAgentRequest {
                harness: Some(AgentHarnessSelection {
                    harness: "macrod".to_owned(),
                    harness_id: Some(second),
                }),
                ..PatchAgentRequest::default()
            },
        )
        .await?;
    assert_eq!(moved.harness_id, Some(second));
    assert_eq!(moved.workspace_path, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_users_harness_does_not_reveal_its_workspaces(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, USER_OWNER).await?;
    insert_user(&pool, USER_OTHER).await?;
    let harness = insert_harness(&pool, Some(USER_OWNER), None).await?;
    report_workspaces(&pool, harness, &["/home/owner/code/api"]).await?;
    let service = service(&pool);

    for (handle, path) in [
        ("probe-reported", "/home/owner/code/api"),
        ("probe-unreported", "/home/owner/code/secret"),
    ] {
        let probe = service
            .create_agent(
                user_id(USER_OTHER),
                CreateAgentRequest {
                    workspace_path: Some(path.to_owned()),
                    ..macrod_agent_req(handle, Some(harness))
                },
            )
            .await;
        assert!(
            matches!(probe, Err(BotError::Unauthorized)),
            "{path}: {probe:?}"
        );
    }
    Ok(())
}
