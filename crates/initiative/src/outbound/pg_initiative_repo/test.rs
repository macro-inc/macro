use entity_access_db_utils::AccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::team_share::{
    TeamShareCreation, TeamShareGrant, TeamShareLevel, TeamShareRequest, authorize_team_share,
};
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::PgInitiativeRepo;
use crate::domain::models::{
    AssignTaskStatus, CreateInitiativeRepoArgs, DescriptionDocumentId, InitiativeError,
    InitiativeId, LockstepTeamShare, UpdateInitiativeRepoArgs,
};
use crate::domain::ports::InitiativeRepo;

const OWNER: &str = "macro|initiative-repo-owner@corp.test";
const MEMBER: &str = "macro|initiative-repo-member@corp.test";
const TEAMMATE: &str = "macro|initiative-repo-teammate@corp.test";
const CHANNEL_USER: &str = "macro|initiative-repo-channel@corp.test";
const STRANGER: &str = "macro|initiative-repo-stranger@corp.test";
const OTHER_OWNER: &str = "macro|initiative-repo-other-owner@corp.test";

const INITIATIVE: &str = "initiative";
const DOCUMENT: &str = "document";

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

async fn seed_description_document(
    pool: &PgPool,
    owner: &str,
) -> anyhow::Result<DescriptionDocumentId> {
    let id = Uuid::now_v7();
    let id_text = id.to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, "fileType", owner) VALUES ($1, 'Launch', 'md', $2)"#,
        id_text,
        owner,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO document_sub_type (document_id, sub_type)
        VALUES ($1, 'initiative_description')
        "#,
        id_text,
    )
    .execute(pool)
    .await?;
    let share_permission_id = sqlx::query_scalar!(
        r#"
        INSERT INTO "SharePermission" ("createdAt", "updatedAt")
        VALUES (NOW(), NOW())
        RETURNING id
        "#,
    )
    .fetch_one(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES ($1, $2)"#,
        id_text,
        share_permission_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', $2, 'user', 'owner')
        "#,
        id,
        owner,
    )
    .execute(pool)
    .await?;
    Ok(DescriptionDocumentId::from_uuid(id))
}

async fn create_args(
    pool: &PgPool,
    owner: &str,
    name: &str,
    members: &[&str],
) -> anyhow::Result<CreateInitiativeRepoArgs> {
    Ok(CreateInitiativeRepoArgs {
        id: InitiativeId::generate(),
        owner_id: user(owner),
        name: name.to_string(),
        description_document_id: seed_description_document(pool, owner).await?,
        member_ids: members.iter().copied().map(user).collect(),
    })
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

async fn mirrored_access(
    pool: &PgPool,
    initiative_id: InitiativeId,
    description_document_id: DescriptionDocumentId,
    source_id: &str,
) -> anyhow::Result<(Option<String>, Option<String>)> {
    Ok((
        access_level(pool, initiative_id.as_uuid(), INITIATIVE, source_id).await?,
        access_level(pool, description_document_id.as_uuid(), DOCUMENT, source_id).await?,
    ))
}

struct StoredSharePermission {
    link_share: Option<String>,
    link_share_access_level: Option<String>,
    channel_ids: Vec<String>,
}

async fn document_share_permission(
    pool: &PgPool,
    id: DescriptionDocumentId,
) -> anyhow::Result<StoredSharePermission> {
    let row = sqlx::query!(
        r#"
        SELECT
            sp."linkShare" AS link_share,
            sp."linkShareAccessLevel"::text AS link_share_access_level,
            COALESCE(
                array_agg(csp.channel_id ORDER BY csp.channel_id)
                    FILTER (WHERE csp.channel_id IS NOT NULL),
                '{}'::text[]
            ) AS "channel_ids!"
        FROM "DocumentPermission" dp
        JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
        LEFT JOIN "ChannelSharePermission" csp ON csp.share_permission_id = sp.id
        WHERE dp."documentId" = $1
        GROUP BY sp."linkShare", sp."linkShareAccessLevel"
        "#,
        id.to_string(),
    )
    .fetch_one(pool)
    .await?;
    Ok(StoredSharePermission {
        link_share: row.link_share,
        link_share_access_level: row.link_share_access_level,
        channel_ids: row.channel_ids,
    })
}

async fn lockstep_team_share(
    repo: &PgInitiativeRepo,
    id: InitiativeId,
    level: AccessLevel,
) -> anyhow::Result<LockstepTeamShare> {
    let facts = repo.get_team_share_facts(id).await?;
    let request = TeamShareRequest {
        access_level: Some(Some(level)),
        legacy_enabled: None,
    };
    let owner = user(OWNER);
    let authorize = |entity_facts| {
        authorize_team_share(Some(&owner), entity_facts, request, TeamShareLevel::Edit)
            .map_err(|error| anyhow::anyhow!("{error}"))?
            .ok_or_else(|| anyhow::anyhow!("a supplied level always yields a command"))
    };
    Ok(LockstepTeamShare {
        initiative: authorize(&facts.initiative)?,
        description: authorize(&facts.description)?,
    })
}

fn ids(list: &crate::domain::models::InitiativeList) -> Vec<Uuid> {
    list.initiatives
        .iter()
        .map(|summary| summary.id.as_uuid())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_links_description_document_and_mirrors_member_and_team_grants_as_tracked(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = seed_owner_with_team(&pool).await?;
    insert_user(&pool, MEMBER).await?;
    add_team_user(&pool, team_id, MEMBER, "member").await?;

    let repo = repo(pool.clone());
    let args = create_args(&pool, OWNER, "Launch", &[MEMBER]).await?;
    let id = args.id;
    let document_id = args.description_document_id;
    let detail = repo
        .create(args, share_off(), TeamShareCreation::Initiative)
        .await?;

    assert_eq!(detail.name, "Launch");
    assert_eq!(detail.description_document_id, document_id);
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

    let still_empty = sqlx::query_scalar!(
        r#"SELECT description FROM initiative WHERE id = $1"#,
        id.as_uuid(),
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(still_empty, "");

    let owner = Some("owner".to_string());
    let edit = Some("edit".to_string());
    assert_eq!(
        mirrored_access(&pool, id, document_id, OWNER).await?,
        (owner.clone(), owner)
    );
    assert_eq!(
        mirrored_access(&pool, id, document_id, MEMBER).await?,
        (edit.clone(), edit.clone())
    );
    assert_eq!(
        mirrored_access(&pool, id, document_id, &team_id.to_string()).await?,
        (edit.clone(), edit)
    );

    let grant = Some(TeamShareGrant {
        team_id,
        level: TeamShareLevel::Edit,
    });
    let facts = repo.get_team_share_facts(id).await?;
    assert_eq!(facts.initiative.current, grant);
    assert_eq!(facts.initiative.revision, 1);
    assert_eq!(facts.description.current, grant);
    assert_eq!(facts.description.revision, 1);
    assert_eq!(facts.description.owner.as_ref(), OWNER);

    let basic = repo.get_basic(id).await?.expect("created initiative");
    assert_eq!(basic.name, "Launch");
    let listed = repo.list_accessible(&user(MEMBER)).await?;
    assert_eq!(
        listed
            .initiatives
            .iter()
            .map(|summary| summary.description_document_id)
            .collect::<Vec<_>>(),
        vec![document_id]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_with_unshared_team_leaves_the_document_untracked_and_unshared(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_owner_with_team(&pool).await?;
    let repo = repo(pool.clone());
    let args = create_args(&pool, OWNER, "Private", &[]).await?;
    let id = args.id;
    repo.create(args, share_off(), TeamShareCreation::Unshared)
        .await?;

    let facts = repo.get_team_share_facts(id).await?;
    assert_eq!(facts.initiative.current, None);
    assert_eq!(facts.description.current, None);
    assert_eq!(facts.description.revision, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_rejects_second_initiative_for_same_document(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool.clone());
    let first = create_args(&pool, OWNER, "First", &[]).await?;
    let document_id = first.description_document_id;
    repo.create(first, share_off(), TeamShareCreation::Unshared)
        .await?;

    let second = CreateInitiativeRepoArgs {
        description_document_id: document_id,
        ..create_args(&pool, OWNER, "Second", &[]).await?
    };
    let second_id = second.id;
    let error = repo
        .create(second, share_off(), TeamShareCreation::Unshared)
        .await
        .expect_err("one document belongs to one initiative");
    assert!(matches!(error, InitiativeError::Internal(_)), "{error:?}");
    assert!(repo.get_basic(second_id).await?.is_none());
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
            create_args(&pool, OWNER, "Busy", &[MEMBER, TEAMMATE]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.update(UpdateInitiativeRepoArgs {
        share_permission: Some(add_channel(channel_id)),
        ..update_args(created.id)
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
    let repo = repo(pool.clone());
    let error = repo
        .create(
            create_args(&pool, OWNER, "Solo", &[]).await?,
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
            create_args(&pool, OWNER, "Owned", &[MEMBER]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let team_granted = repo
        .create(
            create_args(&pool, OWNER, "Team granted", &[]).await?,
            share_off(),
            TeamShareCreation::Initiative,
        )
        .await?;
    let team_link = repo
        .create(
            create_args(&pool, OWNER, "Team link", &[]).await?,
            share_link(LinkShare::Team),
            TeamShareCreation::Unshared,
        )
        .await?;
    let channel_shared = repo
        .create(
            create_args(&pool, OWNER, "Channel", &[]).await?,
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
            create_args(&pool, OWNER, "Public only", &[]).await?,
            share_link(LinkShare::Public),
            TeamShareCreation::Unshared,
        )
        .await?;
    let unrelated = repo
        .create(
            create_args(&pool, OTHER_OWNER, "Unrelated", &[]).await?,
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
async fn update_member_diff_mirrors_document_grants(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    insert_user(&pool, TEAMMATE).await?;
    insert_user(&pool, STRANGER).await?;

    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Members", &[MEMBER, TEAMMATE]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let document_id = created.description_document_id;

    let updated = repo
        .update(UpdateInitiativeRepoArgs {
            name: Some("Renamed".to_string()),
            member_ids_added: vec![user(STRANGER)],
            member_ids_removed: vec![user(MEMBER)],
            ..update_args(created.id)
        })
        .await?;

    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.description_document_id, document_id);
    let mut members: Vec<&str> = updated.member_ids.iter().map(|id| id.as_ref()).collect();
    members.sort_unstable();
    assert_eq!(members, vec![STRANGER, TEAMMATE]);
    let owner = Some("owner".to_string());
    let edit = Some("edit".to_string());
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, OWNER).await?,
        (owner.clone(), owner)
    );
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, MEMBER).await?,
        (None, None)
    );
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, TEAMMATE).await?,
        (edit.clone(), edit.clone())
    );
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, STRANGER).await?,
        (edit.clone(), edit)
    );

    let document_name = sqlx::query_scalar!(
        r#"SELECT name FROM "Document" WHERE id = $1"#,
        document_id.to_string(),
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(document_name, "Launch", "renames are not mirrored");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_share_patch_mirrors_link_columns_and_channel_grants_onto_document(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, CHANNEL_USER).await?;
    let channel_id = Uuid::now_v7();
    insert_channel(&pool, channel_id, OWNER, CHANNEL_USER).await?;

    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Shared", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let document_id = created.description_document_id;

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
    let document = document_share_permission(&pool, document_id).await?;
    assert_eq!(document.link_share.as_deref(), Some("TEAM"));
    assert_eq!(document.link_share_access_level.as_deref(), Some("view"));
    assert_eq!(document.channel_ids, vec![channel_id.to_string()]);
    let view = Some("view".to_string());
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, &channel_id.to_string()).await?,
        (view.clone(), view)
    );

    repo.update(UpdateInitiativeRepoArgs {
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
    let document = document_share_permission(&pool, document_id).await?;
    assert_eq!(document.link_share, None);
    assert_eq!(document.link_share_access_level, None);
    assert!(document.channel_ids.is_empty());
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, &channel_id.to_string()).await?,
        (None, None)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_team_share_applies_both_commands_and_a_second_apply_is_not_untracked(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = seed_owner_with_team(&pool).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Later shared", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let document_id = created.description_document_id;
    let team = team_id.to_string();

    let updated = repo
        .update(UpdateInitiativeRepoArgs {
            share_permission: Some(set_team_share(AccessLevel::Edit)),
            team_share: Some(lockstep_team_share(&repo, created.id, AccessLevel::Edit).await?),
            ..update_args(created.id)
        })
        .await?;
    assert_eq!(
        updated.share_permission.team_share_access_level,
        Some(AccessLevel::Edit)
    );
    let edit = Some("edit".to_string());
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, &team).await?,
        (edit.clone(), edit)
    );
    let facts = repo.get_team_share_facts(created.id).await?;
    let grant = Some(TeamShareGrant {
        team_id,
        level: TeamShareLevel::Edit,
    });
    assert_eq!(facts.initiative.current, grant);
    assert_eq!(facts.description.current, grant);
    assert_eq!(facts.description.revision, 1);

    repo.update(UpdateInitiativeRepoArgs {
        share_permission: Some(set_team_share(AccessLevel::View)),
        team_share: Some(lockstep_team_share(&repo, created.id, AccessLevel::View).await?),
        ..update_args(created.id)
    })
    .await?;
    let view = Some("view".to_string());
    assert_eq!(
        mirrored_access(&pool, created.id, document_id, &team).await?,
        (view.clone(), view)
    );
    let facts = repo.get_team_share_facts(created.id).await?;
    assert_eq!(
        facts.description.current,
        Some(TeamShareGrant {
            team_id,
            level: TeamShareLevel::View,
        })
    );
    assert_eq!(facts.description.revision, 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_rejects_lockstep_commands_naming_another_initiative(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_owner_with_team(&pool).await?;
    let repo = repo(pool.clone());
    let target = repo
        .create(
            create_args(&pool, OWNER, "Target", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let other = repo
        .create(
            create_args(&pool, OWNER, "Other", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;

    let error = repo
        .update(UpdateInitiativeRepoArgs {
            share_permission: Some(set_team_share(AccessLevel::Edit)),
            team_share: Some(lockstep_team_share(&repo, other.id, AccessLevel::Edit).await?),
            ..update_args(target.id)
        })
        .await
        .expect_err("commands must name the initiative being edited");
    assert!(matches!(error, InitiativeError::BadRequest(_)), "{error:?}");
    let facts = repo.get_team_share_facts(target.id).await?;
    assert_eq!(facts.initiative.current, None);
    assert_eq!(facts.description.current, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_fail_loudly_when_description_document_id_is_null(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Pre-expand", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    sqlx::query!(
        r#"UPDATE initiative SET description_document_id = NULL WHERE id = $1"#,
        created.id.as_uuid(),
    )
    .execute(&pool)
    .await?;

    assert!(matches!(
        repo.get_detail(created.id).await,
        Err(InitiativeError::Internal(_))
    ));
    assert!(matches!(
        repo.list_accessible(&user(OWNER)).await,
        Err(InitiativeError::Internal(_))
    ));
    assert!(repo.get_basic(created.id).await?.is_some());
    assert_eq!(repo.delete(created.id).await?, None);
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

    let repo = repo(pool.clone());
    let first = repo
        .create(
            create_args(&pool, OWNER, "First", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let second = repo
        .create(
            create_args(&pool, OWNER, "Second", &[]).await?,
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

    let repo = repo(pool.clone());
    let first = repo
        .create(
            create_args(&pool, OWNER, "Keeper", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let second = repo
        .create(
            create_args(&pool, OWNER, "Other", &[]).await?,
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
async fn delete_returns_the_document_id_and_leaves_no_initiative_rows(
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
            create_args(&pool, OWNER, "To delete", &[MEMBER]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.update(UpdateInitiativeRepoArgs {
        share_permission: Some(add_channel(channel_id)),
        ..update_args(created.id)
    })
    .await?;
    repo.assign_tasks(created.id, vec![task_id.clone()]).await?;
    let share_id = created.share_permission.id.clone();
    let initiative_id = created.id.as_uuid();
    let document_id = created.description_document_id;

    assert_eq!(repo.delete(created.id).await?, Some(document_id));

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
    let document_remains = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM "Document" WHERE id = $1) AS "exists!""#,
        document_id.to_string(),
    )
    .fetch_one(&pool)
    .await?;

    assert!(!leftover_share);
    assert!(!leftover_channel);
    assert!(!leftover_access);
    assert!(!leftover_member);
    assert!(!leftover_task);
    assert!(document_remains);
    assert!(repo.get_detail(created.id).await?.is_none());
    assert!(matches!(
        repo.delete(created.id).await,
        Err(InitiativeError::NotFound)
    ));
    Ok(())
}
