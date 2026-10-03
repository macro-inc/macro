use entity_access_db_utils::AccessLevel;

mod access;
mod history;
#[cfg(feature = "resources")]
mod initial_properties;
#[cfg(feature = "toolset")]
mod toolset;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareCreation, TeamShareGrant, TeamShareLevel,
    TeamShareRequest, authorize_team_share,
};
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::PgInitiativeRepo;
use crate::domain::models::{
    CreateInitiativeRepoArgs, InitiativeError, InitiativeId, UpdateInitiativeRepoArgs,
};
use crate::domain::ports::InitiativeRepo;

const OWNER: &str = "macro|initiative-repo-owner@corp.test";
const MEMBER: &str = "macro|initiative-repo-member@corp.test";
const TEAMMATE: &str = "macro|initiative-repo-teammate@corp.test";
const CHANNEL_USER: &str = "macro|initiative-repo-channel@corp.test";
const STRANGER: &str = "macro|initiative-repo-stranger@corp.test";
const OTHER_OWNER: &str = "macro|initiative-repo-other-owner@corp.test";

const INITIATIVE: &str = "initiative";

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

fn update_args(id: InitiativeId) -> UpdateInitiativeRepoArgs {
    UpdateInitiativeRepoArgs {
        id,
        name: None,
        member_ids_added: Vec::new(),
        member_ids_removed: Vec::new(),
        share_permission: None,
        team_share: None,
    }
}

fn add_channel(channel_id: Uuid) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: Some(vec![UpdateChannelSharePermission {
            operation: UpdateOperation::Add,
            channel_id: channel_id.to_string(),
            access_level: Some(AccessLevel::View),
        }]),
    }
}

fn set_team_share(level: AccessLevel) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(Some(level)),
        channel_share_permissions: None,
    }
}

fn create_args(owner: &str, name: &str, members: &[&str]) -> CreateInitiativeRepoArgs {
    CreateInitiativeRepoArgs {
        id: InitiativeId::generate(),
        owner_id: user(owner),
        name: name.to_string(),
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

async fn seed_owner_with_team(pool: &PgPool) -> anyhow::Result<Uuid> {
    insert_user(pool, OWNER).await?;
    let team_id = Uuid::now_v7();
    insert_team(pool, team_id, OWNER).await?;
    add_team_user(pool, team_id, OWNER, "owner").await?;
    Ok(team_id)
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

/// Put a task in a project the way the properties domain does: through its Project
/// system property (`SystemPropertyKey::PROJECT_UUID`).
async fn set_project(pool: &PgPool, task_id: &str, project: InitiativeId) -> anyhow::Result<()> {
    set_task_reference(pool, task_id, PROJECT_PROPERTY, &project.to_string()).await
}

const PROJECT_PROPERTY: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000014);

async fn set_task_reference(
    pool: &PgPool,
    task_id: &str,
    property_definition_id: Uuid,
    initiative_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES (
            gen_random_uuid(),
            $1,
            'TASK',
            $2,
            jsonb_build_object(
                'type', 'EntityReference',
                'value', jsonb_build_array(jsonb_build_object(
                    'entity_id', $3::text,
                    'entity_type', 'INITIATIVE'
                ))
            )
        )
        ON CONFLICT (entity_id, entity_type, property_definition_id)
        DO UPDATE SET values = EXCLUDED.values
        "#,
        task_id,
        property_definition_id,
        initiative_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn project_rows_referencing(pool: &PgPool, project: InitiativeId) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "count!"
        FROM entity_properties
        WHERE property_definition_id = $1
          AND values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $2::text))
        "#,
        PROJECT_PROPERTY,
        project.to_string(),
    )
    .fetch_one(pool)
    .await?)
}

async fn access_level(
    pool: &PgPool,
    entity_id: Uuid,
    entity_type: &str,
    source_id: &str,
) -> anyhow::Result<Option<String>> {
    let row = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = $2
          AND source_id = $3
          AND granted_from_project_id IS NULL
        "#,
        entity_id,
        entity_type,
        source_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.flatten())
}

async fn initiative_access(
    pool: &PgPool,
    initiative_id: InitiativeId,
    source_id: &str,
) -> anyhow::Result<Option<String>> {
    access_level(pool, initiative_id.as_uuid(), INITIATIVE, source_id).await
}

async fn team_share_command(
    repo: &PgInitiativeRepo,
    id: InitiativeId,
    level: AccessLevel,
) -> anyhow::Result<AuthorizedTeamShareCommand> {
    let facts = repo.get_team_share_facts(id).await?;
    let request = TeamShareRequest {
        access_level: Some(Some(level)),
        legacy_enabled: None,
    };
    let owner = user(OWNER);
    authorize_team_share(Some(&owner), &facts, request, TeamShareLevel::Edit)
        .map_err(|error| anyhow::anyhow!("{error}"))?
        .ok_or_else(|| anyhow::anyhow!("a supplied level always yields a command"))
}

fn ids(list: &crate::domain::models::InitiativeList) -> Vec<Uuid> {
    list.initiatives
        .iter()
        .map(|summary| summary.id.as_uuid())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_grants_owner_member_and_team_access_as_tracked(pool: PgPool) -> anyhow::Result<()> {
    let team_id = seed_owner_with_team(&pool).await?;
    insert_user(&pool, MEMBER).await?;
    add_team_user(&pool, team_id, MEMBER, "member").await?;

    let repo = repo(pool.clone());
    let args = create_args(OWNER, "Launch", &[MEMBER]);
    let id = args.id;
    let detail = repo
        .create(args, share_off(), TeamShareCreation::Initiative)
        .await?;

    assert_eq!(detail.name, "Launch");
    assert_eq!(detail.owner_id.as_ref(), OWNER);
    assert_eq!(
        detail
            .member_ids
            .iter()
            .map(|id| id.as_ref())
            .collect::<Vec<_>>(),
        vec![MEMBER]
    );
    assert_eq!(
        detail.share_permission.team_share_access_level,
        Some(AccessLevel::Edit)
    );
    assert_eq!(detail.user_access_level, AccessLevel::View);

    let edit = Some("edit".to_string());
    assert_eq!(
        initiative_access(&pool, id, OWNER).await?,
        Some("owner".to_string())
    );
    assert_eq!(initiative_access(&pool, id, MEMBER).await?, edit);
    assert_eq!(
        initiative_access(&pool, id, &team_id.to_string()).await?,
        edit
    );

    let facts = repo.get_team_share_facts(id).await?;
    assert_eq!(
        facts.current,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::Edit,
        })
    );
    assert_eq!(facts.revision, 1);
    assert_eq!(facts.owner.principal_id(), OWNER);

    let basic = repo.get_basic(id).await?.expect("created initiative");
    assert_eq!(basic.name, "Launch");
    assert_eq!(
        ids(&repo.list_accessible(&user(MEMBER)).await?),
        vec![id.as_uuid()]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_with_unshared_team_leaves_the_initiative_untracked_and_unshared(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_owner_with_team(&pool).await?;
    let repo = repo(pool.clone());
    let args = create_args(OWNER, "Private", &[]);
    let id = args.id;
    repo.create(args, share_off(), TeamShareCreation::Unshared)
        .await?;

    let facts = repo.get_team_share_facts(id).await?;
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);
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

    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(OWNER, "Busy", &[MEMBER, TEAMMATE]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.update(UpdateInitiativeRepoArgs {
        share_permission: Some(add_channel(channel_id)),
        ..update_args(created.id)
    })
    .await?;
    set_project(&pool, &task_a, created.id).await?;
    set_project(&pool, &task_b, created.id).await?;

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
async fn create_share_with_team_without_owner_team_succeeds_unshared(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(OWNER, "Solo", &[]),
            share_off(),
            TeamShareCreation::Initiative,
        )
        .await?;
    let facts = repo.get_team_share_facts(created.id).await?;
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_accessible_includes_owner_member_team_channel_and_team_link(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = seed_owner_with_team(&pool).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;
    insert_user(&pool, CHANNEL_USER).await?;
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
        share_permission: Some(add_channel(channel_id)),
        ..update_args(channel_shared.id)
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

    let repo = repo(pool.clone());
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
async fn update_member_diff_grants_and_revokes_initiative_access(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;
    insert_user(&pool, STRANGER).await?;

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
            name: Some("Renamed".to_string()),
            member_ids_added: vec![user(STRANGER)],
            member_ids_removed: vec![user(MEMBER)],
            ..update_args(created.id)
        })
        .await?;

    assert_eq!(updated.name, "Renamed");
    let mut members: Vec<&str> = updated.member_ids.iter().map(|id| id.as_ref()).collect();
    members.sort_unstable();
    assert_eq!(members, vec![STRANGER, TEAMMATE]);
    let edit = Some("edit".to_string());
    assert_eq!(
        initiative_access(&pool, created.id, OWNER).await?,
        Some("owner".to_string())
    );
    assert_eq!(initiative_access(&pool, created.id, MEMBER).await?, None);
    assert_eq!(initiative_access(&pool, created.id, TEAMMATE).await?, edit);
    assert_eq!(initiative_access(&pool, created.id, STRANGER).await?, edit);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_share_patch_sets_link_columns_and_channel_grants(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, CHANNEL_USER).await?;
    let channel_id = Uuid::now_v7();
    insert_channel(&pool, channel_id, OWNER, CHANNEL_USER).await?;

    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(OWNER, "Shared", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    let updated = repo
        .update(UpdateInitiativeRepoArgs {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Team)),
                link_share_access_level: Some(Some(AccessLevel::View)),
                ..add_channel(channel_id)
            }),
            ..update_args(created.id)
        })
        .await?;

    assert_eq!(updated.share_permission.link_share, Some(LinkShare::Team));
    assert_eq!(
        updated.share_permission.link_share_access_level,
        Some(AccessLevel::View)
    );
    assert_eq!(
        initiative_access(&pool, created.id, &channel_id.to_string()).await?,
        Some("view".to_string())
    );

    let cleared = repo
        .update(UpdateInitiativeRepoArgs {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                link_share: Some(None),
                link_share_access_level: None,
                team_share_access_level: None,
                channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                    operation: UpdateOperation::Remove,
                    channel_id: channel_id.to_string(),
                    access_level: None,
                }]),
            }),
            ..update_args(created.id)
        })
        .await?;
    assert_eq!(cleared.share_permission.link_share, None);
    assert!(
        cleared
            .share_permission
            .channel_share_permissions
            .unwrap_or_default()
            .is_empty()
    );
    assert_eq!(
        initiative_access(&pool, created.id, &channel_id.to_string()).await?,
        None
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_team_share_applies_the_command_and_a_second_apply_is_not_untracked(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = seed_owner_with_team(&pool).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(OWNER, "Later shared", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let team = team_id.to_string();

    let updated = repo
        .update(UpdateInitiativeRepoArgs {
            share_permission: Some(set_team_share(AccessLevel::Edit)),
            team_share: Some(team_share_command(&repo, created.id, AccessLevel::Edit).await?),
            ..update_args(created.id)
        })
        .await?;
    assert_eq!(
        updated.share_permission.team_share_access_level,
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        initiative_access(&pool, created.id, &team).await?,
        Some("edit".to_string())
    );
    let facts = repo.get_team_share_facts(created.id).await?;
    assert_eq!(
        facts.current,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::Edit,
        })
    );
    assert_eq!(facts.revision, 1);

    repo.update(UpdateInitiativeRepoArgs {
        share_permission: Some(set_team_share(AccessLevel::View)),
        team_share: Some(team_share_command(&repo, created.id, AccessLevel::View).await?),
        ..update_args(created.id)
    })
    .await?;
    assert_eq!(
        initiative_access(&pool, created.id, &team).await?,
        Some("view".to_string())
    );
    let facts = repo.get_team_share_facts(created.id).await?;
    assert_eq!(
        facts.current,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::View,
        })
    );
    assert_eq!(facts.revision, 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_rejects_team_share_commands_naming_another_initiative(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_owner_with_team(&pool).await?;
    let repo = repo(pool.clone());
    let target = repo
        .create(
            create_args(OWNER, "Target", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let other = repo
        .create(
            create_args(OWNER, "Other", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    let error = repo
        .update(UpdateInitiativeRepoArgs {
            share_permission: Some(set_team_share(AccessLevel::Edit)),
            team_share: Some(team_share_command(&repo, other.id, AccessLevel::Edit).await?),
            ..update_args(target.id)
        })
        .await
        .expect_err("commands must name the initiative being edited");
    assert!(matches!(error, InitiativeError::BadRequest(_)), "{error:?}");
    let facts = repo.get_team_share_facts(target.id).await?;
    assert_eq!(facts.current, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_share_facts_report_a_missing_initiative(pool: PgPool) -> anyhow::Result<()> {
    assert!(matches!(
        repo(pool)
            .get_team_share_facts(InitiativeId::generate())
            .await,
        Err(InitiativeError::NotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn task_memberships_read_each_tasks_project_property(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool.clone());
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
    let [
        in_first,
        in_second,
        moved,
        unassigned,
        other_property,
        dangling,
        not_requested,
    ] = std::array::from_fn(|_| Uuid::now_v7().to_string());
    for task in [
        &in_first,
        &in_second,
        &moved,
        &unassigned,
        &other_property,
        &dangling,
        &not_requested,
    ] {
        insert_document(&pool, task, OWNER, true).await?;
    }
    set_project(&pool, &in_first, first.id).await?;
    set_project(&pool, &in_second, second.id).await?;
    set_project(&pool, &moved, first.id).await?;
    set_project(&pool, &moved, second.id).await?;
    set_project(&pool, &not_requested, first.id).await?;
    // Another entity property referencing a project is not membership.
    set_task_reference(
        &pool,
        &other_property,
        Uuid::from_u128(0x00000001_0000_0000_0000_00000000000c),
        &first.id.to_string(),
    )
    .await?;
    set_task_reference(
        &pool,
        &dangling,
        PROJECT_PROPERTY,
        &Uuid::now_v7().to_string(),
    )
    .await?;

    let memberships = repo
        .task_memberships(vec![
            in_first.clone(),
            in_second.clone(),
            moved.clone(),
            unassigned,
            other_property,
            dangling,
        ])
        .await?;
    assert_eq!(
        memberships,
        std::collections::HashMap::from([
            (in_first, first.id),
            (in_second, second.id),
            (moved, second.id),
        ])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_lists_existing_tasks_whose_project_property_names_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool.clone());
    let project = repo
        .create(
            create_args(OWNER, "Project", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let other = repo
        .create(
            create_args(OWNER, "Other", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    assert!(
        repo.get_detail(project.id)
            .await?
            .expect("project")
            .task_ids
            .is_empty()
    );
    let [task_a, task_b, elsewhere, deleted] = std::array::from_fn(|_| Uuid::now_v7().to_string());
    for task in [&task_a, &task_b, &elsewhere] {
        insert_document(&pool, task, OWNER, true).await?;
    }
    set_project(&pool, &task_b, project.id).await?;
    set_project(&pool, &task_a, project.id).await?;
    set_project(&pool, &elsewhere, other.id).await?;
    // A property row whose task document no longer exists is not a member.
    set_project(&pool, &deleted, project.id).await?;

    let detail = repo.get_detail(project.id).await?.expect("project");
    assert_eq!(detail.task_ids, vec![task_a.clone(), task_b.clone()]);
    assert_eq!(
        repo.get_detail(other.id).await?.expect("other").task_ids,
        vec![elsewhere.clone()]
    );

    // Moving a task is one property write: it leaves the old project.
    set_project(&pool, &task_a, other.id).await?;
    assert_eq!(
        repo.get_detail(project.id)
            .await?
            .expect("project")
            .task_ids,
        vec![task_b]
    );
    assert_eq!(
        repo.get_detail(other.id).await?.expect("other").task_ids,
        vec![task_a, elsewhere]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_leaves_no_initiative_rows(pool: PgPool) -> anyhow::Result<()> {
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
        share_permission: Some(add_channel(channel_id)),
        ..update_args(created.id)
    })
    .await?;
    set_project(&pool, &task_id, created.id).await?;
    let survivor = repo
        .create(
            create_args(OWNER, "Survivor", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let surviving_task = Uuid::now_v7().to_string();
    insert_document(&pool, &surviving_task, OWNER, true).await?;
    set_project(&pool, &surviving_task, survivor.id).await?;
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
    let leftover_task = project_rows_referencing(&pool, created.id).await? > 0;

    assert!(!leftover_share);
    assert!(!leftover_channel);
    assert!(!leftover_access);
    assert!(!leftover_member);
    assert!(!leftover_task);
    // Its tasks leave the project with it; other projects keep theirs.
    assert!(repo.task_memberships(vec![task_id]).await?.is_empty());
    assert_eq!(project_rows_referencing(&pool, survivor.id).await?, 1);
    assert_eq!(
        repo.get_detail(survivor.id)
            .await?
            .expect("survivor")
            .task_ids,
        vec![surviving_task]
    );
    assert!(repo.get_detail(created.id).await?.is_none());
    assert!(matches!(
        repo.delete(created.id).await,
        Err(InitiativeError::NotFound)
    ));
    Ok(())
}
