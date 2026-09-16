use entity_access_db_utils::AccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::team_share::TeamShareCreation;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::PgInitiativeRepo;
use crate::domain::models::{
    AssignTaskStatus, CreateInitiativeRepoArgs, InitiativeError, InitiativeId,
    UpdateInitiativeRepoArgs,
};
use crate::domain::ports::InitiativeRepo;

const OWNER: &str = "macro|initiative-repo-owner@corp.test";
const MEMBER: &str = "macro|initiative-repo-member@corp.test";
const TEAMMATE: &str = "macro|initiative-repo-teammate@corp.test";
const CHANNEL_USER: &str = "macro|initiative-repo-channel@corp.test";
const STRANGER: &str = "macro|initiative-repo-stranger@corp.test";
const OTHER_OWNER: &str = "macro|initiative-repo-other-owner@corp.test";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .expect("valid user id")
        .into_owned()
}

fn repo(pool: PgPool) -> PgInitiativeRepo {
    PgInitiativeRepo::new(pool)
}

fn share_off() -> SharePermissionV2 {
    SharePermissionV2::new_initiative_share_permission(None)
}

fn share_link(link: LinkShare) -> SharePermissionV2 {
    let mut permission = share_off();
    permission.link_share = Some(link);
    permission.link_share_access_level = Some(AccessLevel::View);
    permission
}

fn create_args(owner: &str, name: &str, members: &[&str]) -> CreateInitiativeRepoArgs {
    CreateInitiativeRepoArgs {
        id: InitiativeId::generate(),
        owner_id: user(owner),
        name: name.to_string(),
        description: None,
        member_ids: members.iter().copied().map(user).collect(),
    }
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::now_v7();
    let email = user_id.trim_start_matches("macro|");
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $2)
        "#,
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_team(pool: &PgPool, team_id: Uuid, owner_id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Initiative Repo Team', $2)"#,
        team_id,
        owner_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn add_team_user(
    pool: &PgPool,
    team_id: Uuid,
    user_id: &str,
    role: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, $3::text::team_role)
        "#,
        user_id,
        team_id,
        role,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_channel(
    pool: &PgPool,
    channel_id: Uuid,
    owner_id: &str,
    participant_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'Initiative channel', 'public', $2)
        "#,
        channel_id,
        owner_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        VALUES ($1, 'member', $2)
        "#,
        channel_id,
        participant_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_document(pool: &PgPool, id: &str, owner: &str, task: bool) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, "fileType", owner) VALUES ($1, $2, 'md', $3)"#,
        id,
        id,
        owner,
    )
    .execute(pool)
    .await?;
    if task {
        sqlx::query!(
            r#"INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')"#,
            id,
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn access_level(
    pool: &PgPool,
    initiative_id: Uuid,
    source_id: &str,
) -> anyhow::Result<Option<String>> {
    let row = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = 'initiative'
          AND source_id = $2
          AND granted_from_project_id IS NULL
        "#,
        initiative_id,
        source_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.flatten())
}

fn ids(list: &crate::domain::models::InitiativeList) -> Vec<Uuid> {
    list.initiatives
        .iter()
        .map(|summary| summary.id.as_uuid())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_writes_initiative_share_owner_members_and_optional_team_grant(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    let team_id = Uuid::now_v7();
    insert_team(&pool, team_id, OWNER).await?;
    add_team_user(&pool, team_id, OWNER, "owner").await?;
    add_team_user(&pool, team_id, MEMBER, "member").await?;

    let repo = repo(pool.clone());
    let args = CreateInitiativeRepoArgs {
        description: Some("Ship it".to_string()),
        ..create_args(OWNER, "Launch", &[MEMBER])
    };
    let id = args.id;
    let detail = repo
        .create(args, share_off(), TeamShareCreation::Initiative)
        .await?;

    assert_eq!(detail.name, "Launch");
    assert_eq!(detail.description.as_deref(), Some("Ship it"));
    assert_eq!(detail.owner_id.as_ref(), OWNER);
    assert_eq!(
        detail
            .member_ids
            .iter()
            .map(|id| id.as_ref())
            .collect::<Vec<_>>(),
        vec![MEMBER]
    );
    assert!(!detail.share_permission.id.is_empty());
    assert_eq!(
        detail.share_permission.team_share_access_level,
        Some(AccessLevel::Edit)
    );
    assert_eq!(detail.user_access_level, AccessLevel::View);

    let share_exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM "SharePermission" WHERE id = $1) AS "exists!""#,
        detail.share_permission.id,
    )
    .fetch_one(&pool)
    .await?;
    assert!(share_exists);

    assert_eq!(
        access_level(&pool, id.as_uuid(), OWNER).await?.as_deref(),
        Some("owner")
    );
    assert_eq!(
        access_level(&pool, id.as_uuid(), MEMBER).await?.as_deref(),
        Some("edit")
    );
    assert_eq!(
        access_level(&pool, id.as_uuid(), &team_id.to_string())
            .await?
            .as_deref(),
        Some("edit")
    );

    let basic = repo.get_basic(id).await?.expect("created initiative");
    assert_eq!(basic.name, "Launch");
    assert_eq!(basic.owner_id.as_ref(), OWNER);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_detail_reports_each_channel_grant_once(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;
    let channel_id = Uuid::now_v7();
    insert_channel(&pool, channel_id, OWNER, MEMBER).await?;
    let task_a = Uuid::now_v7().to_string();
    let task_b = Uuid::now_v7().to_string();
    insert_document(&pool, &task_a, OWNER, true).await?;
    insert_document(&pool, &task_b, OWNER, true).await?;

    let repo = repo(pool);
    let created = repo
        .create(
            create_args(OWNER, "Busy", &[MEMBER, TEAMMATE]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.update(UpdateInitiativeRepoArgs {
        id: created.id,
        name: None,
        description: None,
        member_ids_added: Vec::new(),
        member_ids_removed: Vec::new(),
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: channel_id.to_string(),
                access_level: Some(AccessLevel::View),
            }]),
        }),
        team_share: None,
    })
    .await?;
    repo.assign_tasks(created.id, vec![task_a.clone(), task_b.clone()])
        .await?;

    let detail = repo.get_detail(created.id).await?.expect("busy");
    assert_eq!(
        detail.share_permission.channel_share_permissions,
        Some(vec![ChannelSharePermission {
            channel_id: channel_id.to_string(),
            access_level: AccessLevel::View,
        }])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_share_with_team_without_owner_team_is_bad_request(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool);
    let error = repo
        .create(
            create_args(OWNER, "Solo", &[]),
            share_off(),
            TeamShareCreation::Initiative,
        )
        .await
        .expect_err("teamless owner cannot share with team");
    assert!(matches!(error, InitiativeError::BadRequest(message) if message.contains("team")));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_accessible_includes_owner_member_team_channel_and_team_link(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;
    insert_user(&pool, CHANNEL_USER).await?;
    let team_id = Uuid::now_v7();
    insert_team(&pool, team_id, OWNER).await?;
    add_team_user(&pool, team_id, OWNER, "owner").await?;
    add_team_user(&pool, team_id, TEAMMATE, "member").await?;
    let channel_id = Uuid::now_v7();
    insert_channel(&pool, channel_id, OWNER, CHANNEL_USER).await?;

    let repo = repo(pool.clone());
    let owned = repo
        .create(
            create_args(OWNER, "Owned", &[MEMBER]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let team_granted = repo
        .create(
            create_args(OWNER, "Team granted", &[]),
            share_off(),
            TeamShareCreation::Initiative,
        )
        .await?;
    let team_link = repo
        .create(
            create_args(OWNER, "Team link", &[]),
            share_link(LinkShare::Team),
            TeamShareCreation::Unshared,
        )
        .await?;
    let channel_shared = repo
        .create(
            create_args(OWNER, "Channel", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.update(UpdateInitiativeRepoArgs {
        id: channel_shared.id,
        name: None,
        description: None,
        member_ids_added: Vec::new(),
        member_ids_removed: Vec::new(),
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: channel_id.to_string(),
                access_level: Some(AccessLevel::View),
            }]),
        }),
        team_share: None,
    })
    .await?;

    let owner_list = ids(&repo.list_accessible(&user(OWNER)).await?);
    let member_list = ids(&repo.list_accessible(&user(MEMBER)).await?);
    let teammate_list = ids(&repo.list_accessible(&user(TEAMMATE)).await?);
    let channel_list = ids(&repo.list_accessible(&user(CHANNEL_USER)).await?);

    assert!(owner_list.contains(&owned.id.as_uuid()));
    assert!(member_list.contains(&owned.id.as_uuid()));
    assert!(teammate_list.contains(&team_granted.id.as_uuid()));
    assert!(teammate_list.contains(&team_link.id.as_uuid()));
    assert!(channel_list.contains(&channel_shared.id.as_uuid()));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_accessible_excludes_public_only_and_unrelated(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, STRANGER).await?;
    insert_user(&pool, OTHER_OWNER).await?;

    let repo = repo(pool);
    let public_only = repo
        .create(
            create_args(OWNER, "Public only", &[]),
            share_link(LinkShare::Public),
            TeamShareCreation::Unshared,
        )
        .await?;
    let unrelated = repo
        .create(
            create_args(OTHER_OWNER, "Unrelated", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    let stranger_list = ids(&repo.list_accessible(&user(STRANGER)).await?);
    assert!(!stranger_list.contains(&public_only.id.as_uuid()));
    assert!(!stranger_list.contains(&unrelated.id.as_uuid()));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_removing_member_deletes_only_that_grant(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;

    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(OWNER, "Members", &[MEMBER, TEAMMATE]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    let updated = repo
        .update(UpdateInitiativeRepoArgs {
            id: created.id,
            name: Some("Renamed".to_string()),
            description: Some(None),
            member_ids_added: Vec::new(),
            member_ids_removed: vec![user(MEMBER)],
            share_permission: None,
            team_share: None,
        })
        .await?;

    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.description, None);
    assert_eq!(
        updated
            .member_ids
            .iter()
            .map(|id| id.as_ref())
            .collect::<Vec<_>>(),
        vec![TEAMMATE]
    );
    assert_eq!(
        access_level(&pool, created.id.as_uuid(), OWNER)
            .await?
            .as_deref(),
        Some("owner")
    );
    assert_eq!(
        access_level(&pool, created.id.as_uuid(), MEMBER).await?,
        None
    );
    assert_eq!(
        access_level(&pool, created.id.as_uuid(), TEAMMATE)
            .await?
            .as_deref(),
        Some("edit")
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assign_tasks_moves_and_reports_non_tasks(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let task_a = Uuid::now_v7().to_string();
    let task_b = Uuid::now_v7().to_string();
    let not_a_task = Uuid::now_v7().to_string();
    let missing = Uuid::now_v7().to_string();
    insert_document(&pool, &task_a, OWNER, true).await?;
    insert_document(&pool, &task_b, OWNER, true).await?;
    insert_document(&pool, &not_a_task, OWNER, false).await?;

    let repo = repo(pool);
    let first = repo
        .create(
            create_args(OWNER, "First", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let second = repo
        .create(
            create_args(OWNER, "Second", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    let first_results = repo
        .assign_tasks(first.id, vec![task_a.clone(), task_b.clone()])
        .await?;
    assert_eq!(
        first_results
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        vec![AssignTaskStatus::Assigned, AssignTaskStatus::Assigned]
    );

    let second_results = repo
        .assign_tasks(
            second.id,
            vec![task_a.clone(), not_a_task.clone(), missing.clone()],
        )
        .await?;
    assert_eq!(second_results[0].status, AssignTaskStatus::Moved);
    assert_eq!(second_results[1].status, AssignTaskStatus::NotATask);
    assert_eq!(second_results[2].status, AssignTaskStatus::NotATask);

    let first_detail = repo.get_detail(first.id).await?.expect("first");
    let second_detail = repo.get_detail(second.id).await?.expect("second");
    assert_eq!(first_detail.task_ids, vec![task_b.clone()]);
    assert_eq!(second_detail.task_ids, vec![task_a.clone()]);
    assert!(second_detail.updated_at > second.updated_at);
    assert!(matches!(
        repo.assign_tasks(InitiativeId::generate(), vec![task_a])
            .await,
        Err(InitiativeError::NotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unassign_task_ignores_links_owned_by_other_initiatives(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let task_id = Uuid::now_v7().to_string();
    insert_document(&pool, &task_id, OWNER, true).await?;

    let repo = repo(pool);
    let first = repo
        .create(
            create_args(OWNER, "Keeper", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let second = repo
        .create(
            create_args(OWNER, "Other", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.assign_tasks(first.id, vec![task_id.clone()]).await?;

    let error = repo
        .unassign_task(second.id, &task_id)
        .await
        .expect_err("other initiative cannot steal the link");
    assert!(matches!(error, InitiativeError::NotFound));

    repo.unassign_task(first.id, &task_id).await?;
    let detail = repo.get_detail(first.id).await?.expect("keeper");
    assert!(detail.task_ids.is_empty());
    assert!(detail.updated_at > first.updated_at);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_leaves_no_share_permission_channel_share_entity_access_member_or_task_rows(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    let channel_id = Uuid::now_v7();
    insert_channel(&pool, channel_id, OWNER, MEMBER).await?;
    let task_id = Uuid::now_v7().to_string();
    insert_document(&pool, &task_id, OWNER, true).await?;

    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(OWNER, "To delete", &[MEMBER]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.update(UpdateInitiativeRepoArgs {
        id: created.id,
        name: None,
        description: None,
        member_ids_added: Vec::new(),
        member_ids_removed: Vec::new(),
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: channel_id.to_string(),
                access_level: Some(AccessLevel::View),
            }]),
        }),
        team_share: None,
    })
    .await?;
    repo.assign_tasks(created.id, vec![task_id.clone()]).await?;
    let share_id = created.share_permission.id.clone();
    let initiative_id = created.id.as_uuid();

    repo.delete(created.id).await?;

    let leftover_share = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM "SharePermission" WHERE id = $1) AS "exists!""#,
        share_id,
    )
    .fetch_one(&pool)
    .await?;
    let leftover_channel = sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM "ChannelSharePermission" WHERE share_permission_id = $1
        ) AS "exists!"
        "#,
        share_id,
    )
    .fetch_one(&pool)
    .await?;
    let leftover_access = sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM entity_access
            WHERE entity_id = $1 AND entity_type = 'initiative'
        ) AS "exists!"
        "#,
        initiative_id,
    )
    .fetch_one(&pool)
    .await?;
    let leftover_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM initiative_member WHERE initiative_id = $1) AS "exists!""#,
        initiative_id,
    )
    .fetch_one(&pool)
    .await?;
    let leftover_task = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM task_initiative WHERE initiative_id = $1) AS "exists!""#,
        initiative_id,
    )
    .fetch_one(&pool)
    .await?;

    assert!(!leftover_share);
    assert!(!leftover_channel);
    assert!(!leftover_access);
    assert!(!leftover_member);
    assert!(!leftover_task);
    assert!(repo.get_detail(created.id).await?.is_none());
    Ok(())
}
