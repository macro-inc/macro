//! Access regressions through the real importer writer, document service and database.
use entity_access::{
    domain::{models::AccessLevel, ports::AccessRepository},
    outbound::PgAccessRepository,
};
use import::domain::{
    models::{ImportSource, RunStatus},
    ports::{ImportRepo, ImportVisibility, NotionRunRepo, SharedEntity, WorkspaceWriter},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;
mod host;

struct Users {
    owner: MacroUserIdStr<'static>,
    teammate: MacroUserIdStr<'static>,
    team: Uuid,
}

async fn users(pool: &PgPool) -> anyhow::Result<Users> {
    let run = Uuid::now_v7();
    let owner = MacroUserIdStr::parse_from_str(&format!("macro|import-owner-{run}@example.com"))?
        .into_owned();
    let teammate =
        MacroUserIdStr::parse_from_str(&format!("macro|import-teammate-{run}@example.com"))?
            .into_owned();
    for user in [&owner, &teammate] {
        let id = Uuid::now_v7();
        sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)", id, user.as_ref()).execute(pool).await?;
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
            user.as_ref(),
            id
        )
        .execute(pool)
        .await?;
    }
    let team = Uuid::now_v7();
    sqlx::query!("INSERT INTO team (id, name, owner_id, seat_count, default_link_share) VALUES ($1, 'Import Team', $2, 2, 'TEAM')", team, owner.as_ref()).execute(pool).await?;
    sqlx::query!("INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $3, 'owner'), ($2, $3, 'member')", owner.as_ref(), teammate.as_ref(), team).execute(pool).await?;
    Ok(Users {
        owner,
        teammate,
        team,
    })
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn personal_imports_deny_teammate_link_access(pool: PgPool) -> anyhow::Result<()> {
    imported_access(&pool, ImportVisibility::Personal, None).await
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn shared_imports_retain_teammate_link_access(pool: PgPool) -> anyhow::Result<()> {
    imported_access(&pool, ImportVisibility::Shared, Some(AccessLevel::Edit)).await
}

async fn imported_access(
    pool: &PgPool,
    visibility: ImportVisibility,
    expected: Option<AccessLevel>,
) -> anyhow::Result<()> {
    let users = users(pool).await?;
    let host = host::host(pool).await;
    let folder = host
        .creator
        .create_folder(&users.owner, "Imported", None, ImportVisibility::Personal)
        .await?;
    let access = PgAccessRepository::new(pool.clone());
    let task_properties = import::domain::ports::ImportedTaskProperties {
        assignee_email: Some(users.teammate.email_str().to_string()),
        ..Default::default()
    };
    for scope in ["TEAM", "PUBLIC"] {
        sqlx::query!(
            "UPDATE team SET default_link_share = $2 WHERE id = $1",
            users.team,
            scope
        )
        .execute(pool)
        .await?;
        for kind in [
            "page",
            "row body",
            "Notion task",
            "Linear task",
            "Jira task",
        ] {
            let id = Uuid::now_v7();
            let document = match kind {
                "page" | "row body" => {
                    host.creator
                        .create_document(
                            &users.owner,
                            id,
                            kind,
                            "Body",
                            &Default::default(),
                            &Default::default(),
                            Some(folder),
                            None,
                            visibility,
                        )
                        .await?
                }
                "Notion task" => {
                    host.creator
                        .create_task(
                            &users.owner,
                            id,
                            kind,
                            "Body",
                            &Default::default(),
                            &task_properties,
                            Some(folder),
                            None,
                            visibility,
                        )
                        .await?
                        .id
                }
                _ => {
                    host.creator
                        .create_tracker_task(
                            &users.owner,
                            id,
                            kind,
                            "Body",
                            &task_properties,
                            visibility,
                        )
                        .await?
                        .id
                }
            };
            assert_eq!(
                access
                    .get_document_access(&document, Some(&users.teammate.0))
                    .await?,
                expected,
                "{kind}, {scope}, {visibility:?}"
            );
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn team_folder_link_does_not_open_an_owner_only_child(pool: PgPool) -> anyhow::Result<()> {
    let users = users(&pool).await?;
    let host = host::host(&pool).await;
    let folder = host
        .creator
        .create_folder(
            &users.owner,
            "Link shared folder",
            None,
            ImportVisibility::Shared,
        )
        .await?;
    assert!(
        !host
            .creator
            .folder_has_explicit_grant(&users.owner, folder)
            .await?
    );
    let access = PgAccessRepository::new(pool);
    assert_eq!(
        access
            .get_project_access(&folder.to_string(), Some(&users.teammate.0))
            .await?,
        Some(AccessLevel::View)
    );
    let private_folder = host
        .creator
        .create_folder(
            &users.owner,
            "Personal child folder",
            Some(folder),
            ImportVisibility::Personal,
        )
        .await?;
    assert_eq!(
        access
            .get_project_access(&private_folder.to_string(), Some(&users.teammate.0))
            .await?,
        None
    );
    let document = host
        .creator
        .create_document(
            &users.owner,
            Uuid::now_v7(),
            "Personal child",
            "Body",
            &Default::default(),
            &Default::default(),
            Some(folder),
            None,
            ImportVisibility::Personal,
        )
        .await?;
    assert_eq!(
        access
            .get_document_access(&document, Some(&users.teammate.0))
            .await?,
        None
    );
    Ok(())
}

struct NoConnector;
impl connectors::ConnectorSelect for NoConnector {
    async fn user_toolset(&self, _: &MacroUserIdStr<'static>) -> connectors::UserMcpTools {
        unreachable!()
    }
    async fn connector_toolset(
        &self,
        _: &MacroUserIdStr<'static>,
        _: connectors::ConnectorRef<'_>,
    ) -> anyhow::Result<Option<connectors::UserMcpTools>> {
        unreachable!()
    }
    async fn connector_connected(
        &self,
        _: &MacroUserIdStr<'static>,
        _: connectors::ConnectorRef<'_>,
    ) -> anyhow::Result<bool> {
        unreachable!()
    }
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_new_personal_child_of_a_previously_shared_folder_stays_owner_only(
    pool: PgPool,
) -> anyhow::Result<()> {
    let users = users(&pool).await?;
    let host = host::host(&pool).await;
    let creator = Arc::new(host.creator);
    let repo = import::outbound::pg_import_repo::PgImportRepo::new(pool.clone());
    let service = import::domain::service::ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnector),
        creator.clone(),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    // First run explicitly shares the page folder.
    repo.start_run(&users.owner, ImportSource::Notion, &[])
        .await?;
    let shared = creator
        .create_folder(&users.owner, "Team wiki", None, ImportVisibility::Shared)
        .await?;
    creator
        .share_with_team(&users.owner, SharedEntity::Folder(shared))
        .await?;
    assert!(
        creator
            .folder_has_team_edit_grant(&users.owner, shared)
            .await?
    );
    let nested = creator
        .create_folder(
            &users.owner,
            "Notes",
            Some(shared),
            ImportVisibility::Personal,
        )
        .await?;
    assert!(
        creator
            .folder_has_explicit_grant(&users.owner, nested)
            .await?
    );
    repo.finish_run(
        &users.owner,
        ImportSource::Notion,
        RunStatus::Completed,
        None,
    )
    .await?;
    // A later run places a new personal page below that source page.
    repo.start_run(&users.owner, ImportSource::Notion, &[RunStatus::Completed])
        .await?;
    for (original, foreign_id, path) in [
        (
            shared,
            "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            vec!["Team wiki".into()],
        ),
        (
            nested,
            "ffffffffffffffffffffffffffffffff",
            vec!["Team wiki".into(), "Notes".into()],
        ),
    ] {
        let row = repo
            .upsert_staged(
                &users.owner,
                ImportSource::Notion,
                import::domain::models::ImportKind::Page,
                import::domain::models::Initiator::Manual,
                foreign_id,
                &serde_json::json!({
                    "title": "Personal child", "url": null, "summary": null,
                    "plan": {"decision":"copy", "shared":false, "shareable":true}
                }),
            )
            .await?
            .expect("new personal page");
        let id = Uuid::now_v7();
        let destination = service
            .personal_item_folder(&users.owner, row.id, original, &path)
            .await?;
        let document = creator
            .create_document(
                &users.owner,
                id,
                "Personal child",
                "Body",
                &Default::default(),
                &Default::default(),
                Some(destination),
                None,
                ImportVisibility::Personal,
            )
            .await?;
        assert_eq!(
            PgAccessRepository::new(pool.clone())
                .get_document_access(&document, Some(&users.teammate.0))
                .await?,
            None
        );
        assert_ne!(destination, original);
        let saved = repo.get(&users.owner, row.id).await?.expect("saved import");
        assert_eq!(saved.metadata["personalFolderId"], destination.to_string());
    }
    use import::domain::service::NotionWorkspaceImporter;
    let report = service.notion_import_report(&users.owner).await?;
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("Personal child")
                && warning.contains("Notion (personal)"))
    );

    assert!(
        creator
            .folder_has_explicit_grant(&users.owner, shared)
            .await?
    );
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn the_personal_mirror_root_and_paths_survive_two_runs(pool: PgPool) -> anyhow::Result<()> {
    let users = users(&pool).await?;
    let host = host::host(&pool).await;
    let creator = Arc::new(host.creator);
    let repo = import::outbound::pg_import_repo::PgImportRepo::new(pool);
    let service = import::domain::service::ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnector),
        creator.clone(),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    repo.start_run(&users.owner, ImportSource::Notion, &[])
        .await?;
    let path = vec!["Team wiki".into(), "Notes".into()];
    let first = service.personal_mirror_folder(&users.owner, &path).await?;
    let root = repo.personal_root_folder(&users.owner).await?;
    repo.finish_run(
        &users.owner,
        ImportSource::Notion,
        RunStatus::Completed,
        None,
    )
    .await?;
    repo.start_run(&users.owner, ImportSource::Notion, &[RunStatus::Completed])
        .await?;
    assert_eq!(
        service.personal_mirror_folder(&users.owner, &path).await?,
        first
    );
    assert_eq!(repo.personal_root_folder(&users.owner).await?, root);
    // A cached branch shared after the import is replaced without changing it.
    let shared_prefix = repo
        .personal_folder(&users.owner, &path[..1])
        .await?
        .unwrap();
    creator
        .share_with_team(&users.owner, SharedEntity::Folder(shared_prefix))
        .await?;
    let replacement = service.personal_mirror_folder(&users.owner, &path).await?;
    assert_ne!(replacement, first);
    assert_eq!(repo.personal_root_folder(&users.owner).await?, root);
    assert!(
        !creator
            .folder_has_explicit_grant(&users.owner, replacement)
            .await?
    );
    assert!(
        creator
            .folder_has_explicit_grant(&users.owner, first)
            .await?
    );
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn teamless_shared_imports_keep_markdown_defaults(pool: PgPool) -> anyhow::Result<()> {
    let users = users(&pool).await?;
    sqlx::query!(
        "DELETE FROM team_user WHERE user_id = $1",
        users.owner.as_ref()
    )
    .execute(&pool)
    .await?;
    let host = host::host(&pool).await;
    let access = PgAccessRepository::new(pool);
    for visibility in [ImportVisibility::Shared, ImportVisibility::Personal] {
        for kind in ["page", "Notion task", "tracker task"] {
            let id = Uuid::now_v7();
            let document = match kind {
                "page" => {
                    host.creator
                        .create_document(
                            &users.owner,
                            id,
                            kind,
                            "Body",
                            &Default::default(),
                            &Default::default(),
                            None,
                            None,
                            visibility,
                        )
                        .await?
                }
                "Notion task" => {
                    host.creator
                        .create_task(
                            &users.owner,
                            id,
                            kind,
                            "Body",
                            &Default::default(),
                            &Default::default(),
                            None,
                            None,
                            visibility,
                        )
                        .await?
                        .id
                }
                _ => {
                    host.creator
                        .create_tracker_task(
                            &users.owner,
                            id,
                            kind,
                            "Body",
                            &Default::default(),
                            visibility,
                        )
                        .await?
                        .id
                }
            };
            let expected = match visibility {
                ImportVisibility::Shared => Some(AccessLevel::Edit),
                ImportVisibility::Personal => None,
            };
            assert_eq!(
                access
                    .get_document_access(&document, Some(&users.teammate.0))
                    .await?,
                expected,
                "{kind}, {visibility:?}"
            );
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn shared_imports_keep_assignee_access_with_links_off(pool: PgPool) -> anyhow::Result<()> {
    let users = users(&pool).await?;
    sqlx::query!(
        "UPDATE team SET default_link_share = NULL WHERE id = $1",
        users.team
    )
    .execute(&pool)
    .await?;
    let host = host::host(&pool).await;
    let properties = import::domain::ports::ImportedTaskProperties {
        assignee_email: Some(users.teammate.email_str().to_string()),
        ..Default::default()
    };
    for tracker in [false, true] {
        let id = Uuid::now_v7();
        for _ in 0..2 {
            let created = if tracker {
                host.creator
                    .create_tracker_task(
                        &users.owner,
                        id,
                        "Assigned task",
                        "Body",
                        &properties,
                        ImportVisibility::Shared,
                    )
                    .await?
            } else {
                host.creator
                    .create_task(
                        &users.owner,
                        id,
                        "Assigned task",
                        "Body",
                        &Default::default(),
                        &properties,
                        None,
                        None,
                        ImportVisibility::Shared,
                    )
                    .await?
            };
            assert_eq!(
                created.notice, None,
                "the enrichment pass must use the Shared verdict even without a team claim"
            );
            assert_eq!(
                PgAccessRepository::new(pool.clone())
                    .get_document_access(&created.id, Some(&users.teammate.0))
                    .await?,
                Some(AccessLevel::Edit)
            );
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn omitted_personal_assignees_are_counted_once_in_the_import_report(
    pool: PgPool,
) -> anyhow::Result<()> {
    use import::domain::{
        models::{ImportKind, Initiator},
        ports::{TaskImportNoticeReason, WrittenObjects},
        service::NotionWorkspaceImporter,
    };
    let users = users(&pool).await?;
    let host = host::host(&pool).await;
    let creator = Arc::new(host.creator);
    let repo = import::outbound::pg_import_repo::PgImportRepo::new(pool.clone());
    let row = repo.upsert_staged(&users.owner, ImportSource::Notion, ImportKind::DataSource, Initiator::Manual, &"a".repeat(32), &serde_json::json!({"title":"Tasks", "url":null, "summary":null, "plan":{"decision":"tasks", "shared":false,"shareable":true}})).await?.unwrap();
    let properties = import::domain::ports::ImportedTaskProperties {
        assignee_email: Some(users.teammate.email_str().to_string()),
        ..Default::default()
    };
    for tracker in [false, true] {
        let id = Uuid::now_v7();
        for _ in 0..2 {
            let created = if tracker {
                creator
                    .create_tracker_task(
                        &users.owner,
                        id,
                        "Personal task",
                        "Body",
                        &properties,
                        ImportVisibility::Personal,
                    )
                    .await?
            } else {
                creator
                    .create_task(
                        &users.owner,
                        id,
                        "Personal task",
                        "Body",
                        &Default::default(),
                        &properties,
                        None,
                        None,
                        ImportVisibility::Personal,
                    )
                    .await?
            };
            assert_eq!(
                created.notice,
                Some(TaskImportNoticeReason::PersonalAssigneeOmitted)
            );
            assert_eq!(
                PgAccessRepository::new(pool.clone())
                    .get_document_access(&created.id, Some(&users.teammate.0))
                    .await?,
                None
            );
            repo.record_task_notice(&users.owner, row.id, id, created.notice.unwrap())
                .await?;
        }
    }
    let service = import::domain::service::ImportServiceImpl::new(
        repo,
        Arc::new(NoConnector),
        creator,
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    assert!(
        service
            .notion_import_report(&users.owner)
            .await?
            .warnings
            .iter()
            .any(
                |warning| warning.contains("2 teammate assignees omitted to keep tasks owner-only")
            )
    );
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_shared_assignee_replay_grants_only_the_previously_omitted_assignee(
    pool: PgPool,
) -> anyhow::Result<()> {
    use import::domain::ports::TaskImportNoticeReason;
    let users = users(&pool).await?;
    let host = host::host(&pool).await;
    let id = Uuid::now_v7();
    let properties = import::domain::ports::ImportedTaskProperties {
        assignee_email: Some(users.teammate.email_str().to_string()),
        ..Default::default()
    };
    let task = host
        .creator
        .create_task(
            &users.owner,
            id,
            "Personal task",
            "Body",
            &Default::default(),
            &properties,
            None,
            None,
            ImportVisibility::Personal,
        )
        .await?;
    assert_eq!(
        task.notice,
        Some(TaskImportNoticeReason::PersonalAssigneeOmitted)
    );
    let access = PgAccessRepository::new(pool);
    for (visibility, expected, notice) in [
        (
            ImportVisibility::Personal,
            None,
            Some(TaskImportNoticeReason::PersonalAssigneeOmitted),
        ),
        (ImportVisibility::Shared, Some(AccessLevel::Edit), None),
    ] {
        assert_eq!(
            host.creator
                .reapply_task_assignee(&users.owner, id, users.teammate.email_str(), visibility)
                .await?,
            notice
        );
        assert_eq!(
            access
                .get_document_access(&task.id, Some(&users.teammate.0))
                .await?,
            expected
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn an_assignee_replay_roster_outage_remains_retryable(pool: PgPool) -> anyhow::Result<()> {
    let users = users(&pool).await?;
    let mut host = host::host(&pool).await;
    let id = Uuid::now_v7();
    host.creator
        .create_task(
            &users.owner,
            id,
            "Personal task",
            "Body",
            &Default::default(),
            &Default::default(),
            None,
            None,
            ImportVisibility::Personal,
        )
        .await?;
    let unavailable = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://user:password@127.0.0.1:1/unavailable")?;
    unavailable.close().await;
    host.creator.team_repository = crate::tool_context::build_team_repository(unavailable);
    let result = host
        .creator
        .reapply_task_assignee(
            &users.owner,
            id,
            users.teammate.email_str(),
            ImportVisibility::Shared,
        )
        .await;
    assert!(
        result.is_err(),
        "a roster outage must not report successful assignment replay"
    );
    assert_eq!(
        PgAccessRepository::new(pool)
            .get_document_access(&id.to_string(), Some(&users.teammate.0),)
            .await?,
        None
    );
    Ok(())
}
