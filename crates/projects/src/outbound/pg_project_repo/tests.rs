use std::collections::HashMap;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::document::FileType;
use model::folder::{FileSystemNode, FileSystemNodeWithIds, FolderItem};
use model::item::Item;
use model::project::ProjectPreviewV2;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2, access_level::AccessLevel,
};
use sqlx::{Pool, Postgres};

use super::PgProjectRepo;
use crate::domain::models::{
    CreateProjectArgs, EditProjectArgs, ProjectEditError, UploadFolderRepoArgs,
};
use crate::domain::ports::ProjectRepo;
use models_permissions::share_permission::team_share::{
    TeamShareLevel, TeamShareRequest, authorize_team_share,
};

const ROOT_ID: &str = "10000000-0000-0000-0000-000000000001";
const CHILD_ID: &str = "10000000-0000-0000-0000-000000000002";
const DELETED_ID: &str = "10000000-0000-0000-0000-000000000009";

async fn setup_team(pool: &Pool<Postgres>) -> rootcause::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id, seat_count)
        VALUES ('90000000-0000-0000-0000-000000000001', 'Team', 'macro|owner@test.com', 2)"#
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ('90000000-0000-0000-0000-000000000001', 'macro|owner@test.com', 'owner')"#
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn metadata_edit(project_id: &str) -> EditProjectArgs {
    EditProjectArgs {
        project_id: project_id.to_owned(),
        name: None,
        update_parent: false,
        parent_id: None,
        share_permission: None,
        team_share: None,
    }
}

async fn team_edit(
    repo: &PgProjectRepo,
    project_id: &str,
    level: Option<AccessLevel>,
) -> rootcause::Result<EditProjectArgs> {
    let facts = repo.get_team_share_facts(project_id).await?;
    let team_share = authorize_team_share(
        Some(&facts.owner),
        &facts,
        TeamShareRequest {
            access_level: Some(level),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )?;
    Ok(EditProjectArgs {
        share_permission: Some(UpdateSharePermissionRequestV2 {
            team_share_access_level: Some(level),
            link_share: None,
            link_share_access_level: None,
            channel_share_permissions: None,
        }),
        team_share,
        ..metadata_edit(project_id)
    })
}

async fn create_child(repo: &PgProjectRepo, parent_id: &str) -> rootcause::Result<String> {
    Ok(repo
        .create_project(CreateProjectArgs {
            user_id: "macro|owner@test.com".to_owned(),
            name: "Child".to_owned(),
            parent_id: Some(parent_id.to_owned()),
            share_permission: SharePermissionV2::new_project_share_permission(None),
        })
        .await?
        .id)
}

async fn team_grants(
    pool: &Pool<Postgres>,
    entity_id: &str,
) -> rootcause::Result<Vec<(Option<String>, AccessLevel)>> {
    Ok(sqlx::query!(
        r#"SELECT granted_from_project_id, access_level AS "access_level: AccessLevel"
        FROM entity_access WHERE entity_id::text = $1 AND source_type = 'team'
        ORDER BY granted_from_project_id NULLS FIRST"#,
        entity_id
    )
    .map(|row| (row.granted_from_project_id, row.access_level))
    .fetch_all(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn explicit_sharing_downgrades_and_revokes_only_its_root_contribution(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_team(&pool).await?;
    let repo = PgProjectRepo::new(pool.clone());
    repo.edit_project(team_edit(&repo, ROOT_ID, Some(AccessLevel::Edit)).await?)
        .await?;
    let child = create_child(&repo, ROOT_ID).await?;
    repo.edit_project(team_edit(&repo, &child, Some(AccessLevel::Comment)).await?)
        .await?;
    let grandchild = create_child(&repo, &child).await?;
    repo.edit_project(team_edit(&repo, &grandchild, Some(AccessLevel::View)).await?)
        .await?;
    assert_eq!(team_grants(&pool, &grandchild).await?.len(), 3);

    for level in [Some(AccessLevel::View), None] {
        repo.edit_project(team_edit(&repo, ROOT_ID, level).await?)
            .await?;
        let grants = team_grants(&pool, &grandchild).await?;
        assert!(grants.contains(&(None, AccessLevel::View)));
        assert!(grants.contains(&(Some(child.clone()), AccessLevel::Comment)));
        assert_eq!(
            grants
                .iter()
                .find(|(root, _)| root.as_deref() == Some(ROOT_ID))
                .map(|(_, level)| *level),
            level
        );
        assert_eq!(
            repo.get_project_share_permission(ROOT_ID)
                .await?
                .team_share_access_level,
            level
        );
    }
    // A share-only patch and a rename leave the parent and independent ancestor grant intact.
    let before = team_grants(&pool, &grandchild).await?;
    let facts = repo.get_team_share_facts(&grandchild).await?;
    let mut rename = metadata_edit(&grandchild);
    rename.name = Some("Renamed".to_owned());
    repo.edit_project(rename).await?;
    assert_eq!(repo.get_team_share_facts(&grandchild).await?, facts);
    assert_eq!(team_grants(&pool, &grandchild).await?, before);
    assert_eq!(
        repo.get_basic_project(&grandchild)
            .await?
            .unwrap()
            .parent_id
            .as_deref(),
        Some(child.as_str())
    );

    // Same-value clears are still supplied operations and advance the revision.
    let revision = repo.get_team_share_facts(ROOT_ID).await?.revision;
    repo.edit_project(team_edit(&repo, ROOT_ID, None).await?)
        .await?;
    assert_eq!(
        repo.get_team_share_facts(ROOT_ID).await?.revision,
        revision + 1
    );
    repo.edit_project(team_edit(&repo, ROOT_ID, Some(AccessLevel::Edit)).await?)
        .await?;
    assert_eq!(team_grants(&pool, &grandchild).await?.len(), 3);

    // Detaching the subtree drops ancestors, but retains its own direct/descendant shares.
    let mut detach = metadata_edit(&child);
    detach.update_parent = true;
    repo.edit_project(detach).await?;
    assert_eq!(team_grants(&pool, &grandchild).await?, before);
    assert_eq!(
        team_grants(&pool, &child).await?,
        vec![(None, AccessLevel::Comment)]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn stale_team_commands_and_later_failures_roll_back_metadata_and_grants(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_team(&pool).await?;
    let repo = PgProjectRepo::new(pool.clone());
    let mut stale = team_edit(&repo, ROOT_ID, Some(AccessLevel::Edit)).await?;
    stale.name = Some("Must not commit".to_owned());
    stale.update_parent = true;
    stale.parent_id = Some("10000000-0000-0000-0000-000000000005".to_owned());
    repo.edit_project(team_edit(&repo, ROOT_ID, Some(AccessLevel::Comment)).await?)
        .await?;
    let before = repo.get_team_share_facts(ROOT_ID).await?;
    let grants = team_grants(&pool, CHILD_ID).await?;
    assert_eq!(
        *repo
            .edit_project(stale)
            .await
            .unwrap_err()
            .current_context(),
        ProjectEditError::ChangedFacts
    );

    let mut failing = team_edit(&repo, ROOT_ID, Some(AccessLevel::View)).await?;
    failing.name = Some("Must not commit".to_owned());
    failing.update_parent = true;
    failing.parent_id = Some("10000000-0000-0000-0000-000000000005".to_owned());
    // The canonical operation runs first; a duplicate channel insertion fails afterward.
    failing.share_permission.as_mut().unwrap().channel_share_permissions = Some(vec![
        models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission {
            channel_id: "channel-one".to_owned(), access_level: Some(AccessLevel::View),
            operation: models_permissions::share_permission::channel_share_permission::UpdateOperation::Add,
        }
    ]);
    assert!(repo.edit_project(failing).await.is_err());
    assert_eq!(repo.get_team_share_facts(ROOT_ID).await?, before);
    assert_eq!(team_grants(&pool, CHILD_ID).await?, grants);
    let project = repo.get_project_by_id(ROOT_ID).await?.unwrap();
    assert_eq!(project.name, "Root");
    assert_eq!(project.parent_id, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn restore_uses_current_parent_and_does_not_reconstruct_cleared_consent(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_team(&pool).await?;
    let repo = PgProjectRepo::new(pool.clone());
    repo.edit_project(team_edit(&repo, ROOT_ID, Some(AccessLevel::Edit)).await?)
        .await?;
    let child = create_child(&repo, ROOT_ID).await?;
    repo.edit_project(team_edit(&repo, &child, Some(AccessLevel::View)).await?)
        .await?;
    let original = repo.get_team_share_facts(&child).await?;
    repo.soft_delete_project(ROOT_ID).await?;
    assert_eq!(repo.get_team_share_facts(&child).await?, original);

    // Restore a child beneath a still-deleted parent, even with an omitted/stale snapshot.
    repo.revert_delete_project(&child, None).await?;
    assert_eq!(
        repo.get_basic_project(&child).await?.unwrap().parent_id,
        None
    );
    assert_eq!(
        team_grants(&pool, &child).await?,
        vec![(None, AccessLevel::View)]
    );
    assert_eq!(repo.get_team_share_facts(&child).await?, original);

    // Lifecycle cleanup while deleted must remain authoritative on restoration.
    repo.soft_delete_project(&child).await?;
    let mut tx = pool.begin().await?;
    let facts = share_permission_db_utils::team_share::load_facts(
        &mut tx,
        &model_entity::EntityType::Project.with_entity_str(&child),
    )
    .await?;
    share_permission_db_utils::team_share::maintain(
        &mut tx,
        &models_permissions::share_permission::team_share::TeamShareMaintenance::Clear {
            expected: facts,
        },
    )
    .await?;
    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|owner@test.com'")
        .execute(tx.as_mut())
        .await?;
    tx.commit().await?;
    repo.revert_delete_project(&child, Some(ROOT_ID.to_owned()))
        .await?;
    assert!(repo.get_team_share_facts(&child).await?.current.is_none());
    assert!(team_grants(&pool, &child).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn concurrent_move_rechecks_cycles_after_acquiring_guard(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let other = "10000000-0000-0000-0000-000000000005";
    assert!(!repo.is_project_recursively_nested(ROOT_ID, other).await?);
    let mut first = pool.begin().await?;
    let mut first_move = metadata_edit(other);
    first_move.update_parent = true;
    first_move.parent_id = Some(CHILD_ID.to_owned());
    super::edit::edit_project(&mut first, &first_move).await?;

    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let other_barrier = barrier.clone();
    let contender = tokio::spawn(async move {
        let mut second_move = metadata_edit(ROOT_ID);
        second_move.update_parent = true;
        second_move.parent_id = Some(other.to_owned());
        other_barrier.wait().await;
        repo.edit_project(second_move).await
    });
    barrier.wait().await;
    // Wait for an actual database lock wait, not a scheduling-dependent sleep.
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))")
                .fetch_one(first.as_mut()).await?;
            if waiting == Some(true) { break; }
            tokio::task::yield_now().await;
        }
        Ok::<_, sqlx::Error>(())
    }).await??;
    first.commit().await?;
    let error = contender.await?.unwrap_err();
    assert_eq!(*error.current_context(), ProjectEditError::RecursiveNesting);
    assert_eq!(
        PgProjectRepo::new(pool)
            .get_basic_project(ROOT_ID)
            .await?
            .unwrap()
            .parent_id,
        None
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn owner_and_membership_are_rechecked_before_explicit_writes(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_team(&pool).await?;
    let repo = PgProjectRepo::new(pool.clone());
    let command = team_edit(&repo, ROOT_ID, Some(AccessLevel::Edit)).await?;
    let mut tx = pool.begin().await?;
    entity_access_db_utils::team_share::acquire_guard(&mut tx).await?;
    sqlx::query!(
        r#"UPDATE "Project" SET "userId" = 'macro|viewer@test.com' WHERE id = $1"#,
        ROOT_ID
    )
    .execute(tx.as_mut())
    .await?;
    tx.commit().await?;
    assert_eq!(
        *repo
            .edit_project(command)
            .await
            .unwrap_err()
            .current_context(),
        ProjectEditError::ChangedFacts
    );

    let mut tx = pool.begin().await?;
    entity_access_db_utils::team_share::acquire_guard(&mut tx).await?;
    sqlx::query!(
        r#"UPDATE "Project" SET "userId" = 'macro|owner@test.com' WHERE id = $1"#,
        ROOT_ID
    )
    .execute(tx.as_mut())
    .await?;
    tx.commit().await?;
    let command = team_edit(&repo, ROOT_ID, Some(AccessLevel::Edit)).await?;
    let mut tx = pool.begin().await?;
    entity_access_db_utils::team_share::acquire_guard(&mut tx).await?;
    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|owner@test.com'")
        .execute(tx.as_mut())
        .await?;
    tx.commit().await?;
    assert_eq!(
        *repo
            .edit_project(command)
            .await
            .unwrap_err()
            .current_context(),
        ProjectEditError::ChangedFacts
    );
    assert!(team_grants(&pool, CHILD_ID).await?.is_empty());
    assert_eq!(repo.get_team_share_facts(ROOT_ID).await?.revision, 0);
    Ok(())
}

#[derive(Debug, Eq, PartialEq)]
struct StoredSharePermission {
    link_share: Option<String>,
    link_share_access_level: Option<String>,
}

async fn project_share_permission_columns(
    pool: &Pool<Postgres>,
    project_id: &str,
) -> StoredSharePermission {
    sqlx::query_as!(
        StoredSharePermission,
        r#"
        SELECT
            permission."linkShare" AS "link_share?",
            permission."linkShareAccessLevel"::text AS "link_share_access_level?"
        FROM "SharePermission" permission
        JOIN "ProjectPermission" project_permission
            ON project_permission."sharePermissionId" = permission.id
        WHERE project_permission."projectId" = $1
        "#,
        project_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn history_listing_differs_from_owner_pending_listing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);

    let viewed = repo.get_projects_for_user("macro|viewer@test.com").await?;
    assert_eq!(
        viewed
            .iter()
            .map(|project| project.id.as_str())
            .collect::<Vec<_>>(),
        vec!["10000000-0000-0000-0000-000000000005", ROOT_ID]
    );

    let owner_pending = repo
        .get_pending_root_projects("macro|owner@test.com")
        .await?;
    assert_eq!(owner_pending.len(), 1);
    assert_eq!(
        owner_pending[0].project.id,
        "10000000-0000-0000-0000-000000000006"
    );
    assert_eq!(
        owner_pending[0].upload_request_id.as_deref(),
        Some("request-owner")
    );

    let viewer_pending = repo
        .get_pending_root_projects("macro|viewer@test.com")
        .await?;
    assert_eq!(viewer_pending.len(), 1);
    assert_eq!(
        viewer_pending[0].project.id,
        "10000000-0000-0000-0000-000000000007"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn basic_lookup_includes_deleted_but_full_lookup_excludes_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);

    let basic = repo
        .get_basic_project(DELETED_ID)
        .await?
        .expect("deleted project");
    assert!(basic.deleted_at.is_some());
    assert!(repo.get_project_by_id(DELETED_ID).await?.is_none());
    assert!(repo.get_project_by_id(ROOT_ID).await?.is_some());
    assert!(repo.get_basic_project("missing").await?.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn children_are_depth_one_filtered_and_type_ordered(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);
    let children = repo.get_project_children(ROOT_ID).await?;

    let children = children
        .into_iter()
        .map(|item| match item {
            Item::Project(project) => ("project", project.id),
            Item::Document(document) => ("document", document.document_id),
            Item::Chat(chat) => ("chat", chat.id),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        children,
        vec![
            ("project", CHILD_ID.to_owned()),
            (
                "document",
                "20000000-0000-0000-0000-000000000001".to_owned()
            ),
            ("chat", "30000000-0000-0000-0000-000000000001".to_owned()),
        ]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn preview_preserves_found_and_missing_input_entries(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);
    let missing = "10000000-0000-0000-0000-000000000099".to_owned();
    let previews = repo
        .batch_get_project_preview(&[CHILD_ID.to_owned(), missing.clone()])
        .await?;

    match &previews[0] {
        ProjectPreviewV2::Found(project) => {
            assert_eq!(project.id, CHILD_ID);
            assert_eq!(project.path, vec!["Root", "First child"]);
        }
        ProjectPreviewV2::DoesNotExist(_) => panic!("child should exist"),
    }
    match &previews[1] {
        ProjectPreviewV2::DoesNotExist(project) => assert_eq!(project.id, missing),
        ProjectPreviewV2::Found(_) => panic!("missing project should not be found"),
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn reads_share_permissions_and_bumps_modified_timestamp(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let permission = repo.get_project_share_permission(ROOT_ID).await?;
    assert_eq!(permission.id, "share-root");
    assert_eq!(permission.owner, "macro|owner@test.com");
    assert_eq!(permission.link_share, Some(LinkShare::Public));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::Edit));
    assert_eq!(permission.team_share_access_level, None);
    let team_id = uuid::Uuid::now_v7();
    for level in [
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
        None,
    ] {
        sqlx::query!(
            r#"
            UPDATE "SharePermission"
            SET team_share_access_level = $2,
                team_share_team_id = $3
            WHERE id = $1
            "#,
            permission.id,
            level as _,
            level.map(|_| team_id),
        )
        .execute(&pool)
        .await?;
        let fresh_permission = repo.get_project_share_permission(ROOT_ID).await?;
        assert_eq!(fresh_permission.team_share_access_level, level);
        assert_eq!(fresh_permission.link_share, permission.link_share);
        assert_eq!(
            fresh_permission.link_share_access_level,
            permission.link_share_access_level
        );
        assert_eq!(
            fresh_permission.channel_share_permissions,
            permission.channel_share_permissions
        );
    }
    assert_eq!(
        permission.channel_share_permissions.expect("channel").len(),
        1
    );

    let before = repo
        .get_project_by_id(ROOT_ID)
        .await?
        .expect("root")
        .updated_at;
    repo.update_project_modified(ROOT_ID).await?;
    let after = repo
        .get_project_by_id(ROOT_ID)
        .await?
        .expect("root")
        .updated_at;
    assert!(after > before);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn create_is_atomic_and_inserts_all_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let permission = SharePermissionV2::new_project_share_permission(None);
    let project = repo
        .create_project(CreateProjectArgs {
            user_id: "macro|owner@test.com".to_owned(),
            name: "Created".to_owned(),
            parent_id: Some(ROOT_ID.to_owned()),
            share_permission: permission.clone(),
        })
        .await?;

    let inherited = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access
        WHERE entity_id::text = $1 AND granted_from_project_id = $2"#,
        project.id,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(inherited, 2, "creation commits current ancestor grants");

    let metadata_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM "ProjectPermission" permission
        JOIN "UserHistory" history ON history."itemId" = permission."projectId"
        JOIN entity_access access ON access.entity_id::text = permission."projectId"
        WHERE permission."projectId" = $1
          AND history."itemType" = 'project'
          AND access.access_level = 'owner'
          AND access.granted_from_project_id IS NULL
        "#,
        project.id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(metadata_count, 1);
    assert_eq!(
        project_share_permission_columns(&pool, &project.id).await,
        StoredSharePermission {
            link_share: None,
            link_share_access_level: None,
        }
    );

    assert!(
        repo.create_project(CreateProjectArgs {
            user_id: "macro|owner@test.com".to_owned(),
            name: "Must roll back".to_owned(),
            parent_id: Some("missing-parent".to_owned()),
            share_permission: permission,
        })
        .await
        .is_err()
    );
    let rolled_back = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE name = 'Must roll back'"#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(rolled_back, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn create_defaults_enabled_link_share_to_view(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let mut permission = SharePermissionV2::new_project_share_permission(None);
    permission.link_share = Some(LinkShare::Team);

    let project = repo
        .create_project(CreateProjectArgs {
            user_id: "macro|owner@test.com".to_owned(),
            name: "Team project".to_owned(),
            parent_id: None,
            share_permission: permission,
        })
        .await?;

    assert_eq!(
        project_share_permission_columns(&pool, &project.id).await,
        StoredSharePermission {
            link_share: Some("TEAM".to_owned()),
            link_share_access_level: Some("view".to_owned()),
        }
    );
    let permission = repo.get_project_share_permission(&project.id).await?;
    assert_eq!(permission.link_share, Some(LinkShare::Team));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn edit_supports_parent_flags_and_sharing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let unchanged = repo
        .edit_project(EditProjectArgs {
            team_share: None,
            project_id: CHILD_ID.to_owned(),
            name: Some("Renamed".to_owned()),
            update_parent: false,
            parent_id: None,
            share_permission: None,
        })
        .await?;
    assert_eq!(unchanged.parent_id.as_deref(), Some(ROOT_ID));

    let moved = repo
        .edit_project(EditProjectArgs {
            team_share: None,
            project_id: CHILD_ID.to_owned(),
            name: None,
            update_parent: true,
            parent_id: Some("10000000-0000-0000-0000-000000000005".to_owned()),
            share_permission: None,
        })
        .await?;
    assert_eq!(
        moved.parent_id.as_deref(),
        Some("10000000-0000-0000-0000-000000000005")
    );

    let updated = repo
        .edit_project(EditProjectArgs {
            team_share: None,
            project_id: ROOT_ID.to_owned(),
            name: None,
            update_parent: true,
            parent_id: None,
            share_permission: Some(UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Team)),
                link_share_access_level: Some(None),
                team_share_access_level: None,
                channel_share_permissions: None,
            }),
        })
        .await?;
    assert!(updated.parent_id.is_none());
    assert_eq!(
        project_share_permission_columns(&pool, ROOT_ID).await,
        StoredSharePermission {
            link_share: Some("TEAM".to_owned()),
            link_share_access_level: Some("view".to_owned()),
        }
    );

    repo.edit_project(EditProjectArgs {
        project_id: ROOT_ID.to_owned(),
        name: None,
        update_parent: false,
        parent_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: Some(Some(AccessLevel::Comment)),
            team_share_access_level: None,
            channel_share_permissions: None,
        }),
        team_share: None,
    })
    .await?;
    assert_eq!(
        project_share_permission_columns(&pool, ROOT_ID).await,
        StoredSharePermission {
            link_share: Some("TEAM".to_owned()),
            link_share_access_level: Some("comment".to_owned()),
        }
    );

    repo.edit_project(EditProjectArgs {
        project_id: ROOT_ID.to_owned(),
        name: None,
        update_parent: false,
        parent_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: Some(Some(LinkShare::Public)),
            link_share_access_level: Some(Some(AccessLevel::Edit)),
            team_share_access_level: None,
            channel_share_permissions: None,
        }),
        team_share: None,
    })
    .await?;
    let before_omitted_update = project_share_permission_columns(&pool, ROOT_ID).await;
    assert_eq!(
        before_omitted_update,
        StoredSharePermission {
            link_share: Some("PUBLIC".to_owned()),
            link_share_access_level: Some("edit".to_owned()),
        }
    );

    repo.edit_project(EditProjectArgs {
        project_id: ROOT_ID.to_owned(),
        name: None,
        update_parent: false,
        parent_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: None,
        }),
        team_share: None,
    })
    .await?;
    assert_eq!(
        project_share_permission_columns(&pool, ROOT_ID).await,
        before_omitted_update
    );

    repo.edit_project(EditProjectArgs {
        project_id: ROOT_ID.to_owned(),
        name: None,
        update_parent: false,
        parent_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: Some(None),
            link_share_access_level: Some(Some(AccessLevel::Edit)),
            team_share_access_level: None,
            channel_share_permissions: None,
        }),
        team_share: None,
    })
    .await?;
    assert_eq!(
        project_share_permission_columns(&pool, ROOT_ID).await,
        StoredSharePermission {
            link_share: None,
            link_share_access_level: None,
        }
    );
    let permission = repo.get_project_share_permission(ROOT_ID).await?;
    assert_eq!(permission.link_share, None);
    assert_eq!(permission.link_share_access_level, None);
    assert_eq!(
        permission.channel_share_permissions.expect("channel").len(),
        1
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn recursive_detection_and_soft_delete_output(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    assert!(repo.is_project_recursively_nested(ROOT_ID, ROOT_ID).await?);
    assert!(
        repo.is_project_recursively_nested(ROOT_ID, CHILD_ID)
            .await?
    );
    assert!(
        !repo
            .is_project_recursively_nested(CHILD_ID, "10000000-0000-0000-0000-000000000005")
            .await?
    );

    let result = repo.soft_delete_project(ROOT_ID).await?;
    assert_eq!(result.project_ids.len(), 3);
    assert_eq!(result.document_ids.len(), 2);
    assert_eq!(result.chat_ids.len(), 2);
    let remaining_history = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "UserHistory" WHERE "itemId" = $1"#,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_history, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn revert_restores_subtree_and_handles_parent_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = $2 WHERE id = $1"#,
        ROOT_ID,
        DELETED_ID
    )
    .execute(&pool)
    .await?;
    repo.soft_delete_project(ROOT_ID).await?;
    let restored = repo
        .revert_delete_project(ROOT_ID, Some(DELETED_ID.to_owned()))
        .await?;
    assert_eq!(restored.project_ids.len(), 4);
    assert!(
        repo.get_basic_project(ROOT_ID)
            .await?
            .expect("root")
            .parent_id
            .is_none()
    );
    assert!(repo.get_project_by_id(CHILD_ID).await?.is_some());

    repo.soft_delete_project(CHILD_ID).await?;
    repo.revert_delete_project(CHILD_ID, Some(ROOT_ID.to_owned()))
        .await?;
    assert_eq!(
        repo.get_basic_project(CHILD_ID)
            .await?
            .expect("child")
            .parent_id
            .as_deref(),
        Some(ROOT_ID)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn purge_returns_outputs_and_removes_access_and_permissions(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let deleted = repo.soft_delete_project(ROOT_ID).await?;
    let document_id = &deleted.document_ids[0];
    let bom_id = sqlx::query_scalar!(
        r#"INSERT INTO "DocumentBom" ("documentId") VALUES ($1) RETURNING id"#,
        document_id,
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO "BomPart" (sha, path, "documentBomId")
        VALUES ('shared-sha', 'one', $1), ('shared-sha', 'two', $1), ('other-sha', 'three', $1)
        "#,
        bom_id,
    )
    .execute(&pool)
    .await?;

    let result = repo.purge_deleted_project_tree(ROOT_ID).await?;
    assert_eq!(result.project_ids.len(), 4);
    assert_eq!(result.documents.len(), 2);
    assert_eq!(result.chat_ids.len(), 2);
    assert_eq!(
        result.bom_shas,
        vec![("other-sha".to_owned(), 1), ("shared-sha".to_owned(), 2)]
    );

    let purged_ids = result
        .project_ids
        .iter()
        .chain(result.documents.iter().map(|(id, _)| id))
        .chain(&result.chat_ids)
        .cloned()
        .collect::<Vec<_>>();
    let remaining_access = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id::text = ANY($1)"#,
        &purged_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_access, 0);
    let remaining_permissions = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "ProjectPermission" WHERE "projectId" = ANY($1)"#,
        &result.project_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_permissions, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn purge_rolls_back_all_deletions(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    repo.soft_delete_project(ROOT_ID).await?;

    let mut transaction = pool.begin().await?;
    let result = super::delete::purge_deleted_project_tree(&mut transaction, ROOT_ID).await?;
    assert!(!result.project_ids.is_empty());
    transaction.rollback().await?;

    assert!(repo.get_basic_project(ROOT_ID).await?.is_some());
    let access_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id::text = $1"#,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(access_count, 2);
    let permission_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "ProjectPermission" WHERE "projectId" = $1"#,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(permission_count, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn upload_folder_preserves_tree_metadata_and_compensates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    setup_team(&pool).await?;
    let repo = PgProjectRepo::new(pool.clone());
    repo.edit_project(team_edit(&repo, ROOT_ID, Some(AccessLevel::Comment)).await?)
        .await?;
    let file = FolderItem {
        name: "nested.pdf".to_owned(),
        full_name: "nested.pdf".to_owned(),
        file_type: Some(FileType::Pdf),
        relative_path: "/Upload/Nested".to_owned(),
        sha: "upload-sha".to_owned(),
    };
    let root_folder = FileSystemNode::Folder(HashMap::from([
        (
            "Nested".to_owned(),
            FileSystemNode::Folder(HashMap::from([(
                "nested.pdf".to_owned(),
                FileSystemNode::File(file),
            )])),
        ),
        ("Empty".to_owned(), FileSystemNode::Folder(HashMap::new())),
    ]));
    let mut share_permission = SharePermissionV2::new_project_share_permission(None);
    share_permission.link_share = Some(LinkShare::Team);
    let result = repo
        .upload_folder(UploadFolderRepoArgs {
            user_id: MacroUserIdStr::parse_from_str("macro|owner@test.com")?.into_owned(),
            share_permission,
            root_folder,
            root_folder_name: "Upload".to_owned(),
            upload_request_id: "lambda-request-id".to_owned(),
            parent_id: Some(ROOT_ID.to_owned()),
        })
        .await?;

    assert_eq!(result.project_ids.len(), 3);
    assert_eq!(result.documents.len(), 1);
    let FileSystemNodeWithIds::Folder { project_id, .. } = &result.file_system else {
        panic!("root must be a folder");
    };
    let root = sqlx::query!(
        r#"
        SELECT "parentId" AS parent_id, "uploadPending" AS upload_pending,
               "uploadRequestId" AS upload_request_id
        FROM "Project" WHERE id = $1
        "#,
        project_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(root.parent_id.as_deref(), Some(ROOT_ID));
    assert!(root.upload_pending);
    assert_eq!(root.upload_request_id.as_deref(), Some("lambda-request-id"));
    assert_eq!(result.documents[0].project_name.as_deref(), Some("Nested"));

    let document_ids = result
        .documents
        .iter()
        .map(|document| document.document_id.clone())
        .collect::<Vec<_>>();
    let created_permissions = sqlx::query_scalar!(
        r#"
        WITH created_permission_ids AS (
            SELECT "sharePermissionId" AS id
            FROM "ProjectPermission"
            WHERE "projectId" = ANY($1)
            UNION
            SELECT "sharePermissionId" AS id
            FROM "DocumentPermission"
            WHERE "documentId" = ANY($2)
        )
        SELECT COUNT(*) AS "count!"
        FROM "SharePermission" permission
        WHERE permission.id IN (SELECT id FROM created_permission_ids)
          AND permission."linkShare" = 'TEAM'
          AND permission."linkShareAccessLevel" = 'view'
        "#,
        &result.project_ids,
        &document_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(created_permissions, 4);
    for id in result.project_ids.iter().chain(&document_ids) {
        assert_eq!(
            team_grants(&pool, id).await?,
            vec![(Some(ROOT_ID.to_owned()), AccessLevel::Comment)]
        );
    }
    for id in &result.project_ids {
        assert_eq!(
            repo.get_project_share_permission(id)
                .await?
                .team_share_access_level,
            None
        );
    }

    repo.delete_uploaded_tree(&result.project_ids, &document_ids)
        .await?;
    let remaining = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE id = ANY($1)"#,
        &result.project_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining, 0);
    let remaining_access = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id::text = ANY($1)"#,
        &document_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_access, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn mark_uploaded_is_recursive_and_rejects_missing_root(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let uploaded_tree = repo
        .mark_projects_uploaded("10000000-0000-0000-0000-000000000006")
        .await?;
    assert_eq!(uploaded_tree.id, "10000000-0000-0000-0000-000000000006");
    assert_eq!(uploaded_tree.name, "Owner pending");
    assert_eq!(uploaded_tree.user_id.as_ref(), "macro|owner@test.com");
    assert_eq!(uploaded_tree.parent_id, None);
    assert!(uploaded_tree.upload_pending_transitioned);

    let mut project_ids = uploaded_tree.project_ids;
    project_ids.sort();
    assert_eq!(
        project_ids,
        [
            "10000000-0000-0000-0000-000000000006".to_owned(),
            "10000000-0000-0000-0000-000000000008".to_owned(),
        ]
    );
    let pending = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE id = ANY($1) AND "uploadPending""#,
        &project_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(pending, 0);

    let repeated = repo
        .mark_projects_uploaded("10000000-0000-0000-0000-000000000006")
        .await?;
    assert!(!repeated.upload_pending_transitioned);
    let mut repeated_project_ids = repeated.project_ids;
    repeated_project_ids.sort();
    assert_eq!(repeated_project_ids, project_ids);

    let missing_error = repo.mark_projects_uploaded("missing").await.unwrap_err();
    assert!(matches!(missing_error, sqlx::Error::RowNotFound));
    Ok(())
}
