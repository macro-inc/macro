use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::subteam::{SubteamDescription, SubteamName};

const TEAM1: uuid::Uuid = uuid::uuid!("11111111-1111-1111-1111-111111111111");
const TEAM2: uuid::Uuid = uuid::uuid!("22222222-2222-2222-2222-222222222222");

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

fn new_subteam(name: &str, parent_id: Option<uuid::Uuid>) -> NewSubteam {
    NewSubteam {
        parent_id,
        name: SubteamName::parse(name).unwrap(),
        description: SubteamDescription::parse("").unwrap(),
        color: SubteamColor::Blue,
        join_policy: SubteamJoinPolicy::Open,
    }
}

async fn create(
    repository: &PgSubteamRepository,
    name: &str,
    parent_id: Option<uuid::Uuid>,
) -> anyhow::Result<Subteam> {
    let outcome = repository
        .create_subteam(
            TEAM1,
            &new_subteam(name, parent_id),
            &user("macro|ada@example.com"),
            &[],
        )
        .await?;

    match outcome {
        CreateSubteamOutcome::Created(subteam) => Ok(subteam),
        other => anyhow::bail!("expected a created team, got {other:?}"),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn creates_a_team_with_its_manager_and_members(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);

    let outcome = repository
        .create_subteam(
            TEAM1,
            &new_subteam("Engineering", None),
            &user("macro|ada@example.com"),
            &[user("macro|grace@example.com")],
        )
        .await?;

    let CreateSubteamOutcome::Created(created) = outcome else {
        anyhow::bail!("expected a created team, got {outcome:?}");
    };
    assert_eq!(created.name, "Engineering");
    assert_eq!(
        created.members,
        vec![
            SubteamMember {
                user_id: user("macro|ada@example.com"),
                role: SubteamRole::Manager,
            },
            SubteamMember {
                user_id: user("macro|grace@example.com"),
                role: SubteamRole::Member,
            },
        ]
    );
    assert_eq!(repository.list_subteams(TEAM1).await?, vec![created]);
    assert_eq!(repository.list_subteams(TEAM2).await?, vec![]);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn refuses_members_from_outside_the_workspace(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);

    // Linus is on team2.
    let outcome = repository
        .create_subteam(
            TEAM1,
            &new_subteam("Engineering", None),
            &user("macro|ada@example.com"),
            &[user("macro|linus@example.com")],
        )
        .await?;

    assert_eq!(outcome, CreateSubteamOutcome::NotWorkspaceMember);
    assert_eq!(repository.list_subteams(TEAM1).await?, vec![]);

    let engineering = create(&repository, "Engineering", None).await?;
    let saved = repository
        .save_subteam_member(
            TEAM1,
            engineering.id,
            &user("macro|linus@example.com"),
            SubteamRole::Member,
        )
        .await?;
    assert_eq!(saved, SaveMemberOutcome::NotWorkspaceMember);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn teams_nest_one_level(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);
    let engineering = create(&repository, "Engineering", None).await?;
    let platform = create(&repository, "Platform", Some(engineering.id)).await?;
    let design = create(&repository, "Design", None).await?;
    assert_eq!(platform.parent_id, Some(engineering.id));

    // Under a nested team.
    let too_deep = repository
        .create_subteam(
            TEAM1,
            &new_subteam("Sync", Some(platform.id)),
            &user("macro|ada@example.com"),
            &[],
        )
        .await?;
    assert_eq!(too_deep, CreateSubteamOutcome::InvalidParent);
    assert_eq!(
        repository
            .nest_subteam(TEAM1, design.id, Some(platform.id))
            .await?,
        NestOutcome::InvalidParent
    );

    // A team with teams of its own, and a team under itself.
    assert_eq!(
        repository
            .nest_subteam(TEAM1, engineering.id, Some(design.id))
            .await?,
        NestOutcome::InvalidParent
    );
    assert_eq!(
        repository
            .nest_subteam(TEAM1, design.id, Some(design.id))
            .await?,
        NestOutcome::InvalidParent
    );

    // A parent from another workspace reads as invalid; a team from another
    // workspace reads as missing.
    assert_eq!(
        repository
            .nest_subteam(TEAM2, design.id, Some(engineering.id))
            .await?,
        NestOutcome::SubteamNotFound
    );

    assert_eq!(
        repository
            .nest_subteam(TEAM1, design.id, Some(engineering.id))
            .await?,
        NestOutcome::Nested
    );
    assert_eq!(
        repository.nest_subteam(TEAM1, platform.id, None).await?,
        NestOutcome::Nested
    );
    let platform = repository.get_subteam(TEAM1, platform.id).await?.unwrap();
    assert_eq!(platform.parent_id, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn deleting_a_parent_moves_its_teams_to_the_top(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);
    let engineering = create(&repository, "Engineering", None).await?;
    let platform = create(&repository, "Platform", Some(engineering.id)).await?;

    assert!(!repository.delete_subteam(TEAM2, engineering.id).await?);
    assert!(repository.delete_subteam(TEAM1, engineering.id).await?);

    let remaining = repository.list_subteams(TEAM1).await?;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, platform.id);
    assert_eq!(remaining[0].parent_id, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn updates_settings_and_roles(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);
    let engineering = create(&repository, "Engineering", None).await?;

    let updated = repository
        .update_subteam(
            TEAM1,
            engineering.id,
            &SubteamPatch {
                name: Some(SubteamName::parse("Eng").unwrap()),
                join_policy: Some(SubteamJoinPolicy::InviteOnly),
                ..Default::default()
            },
        )
        .await?
        .unwrap();
    assert_eq!(updated.name, "Eng");
    assert_eq!(updated.color, SubteamColor::Blue);
    assert_eq!(updated.join_policy, SubteamJoinPolicy::InviteOnly);
    assert!(
        repository
            .update_subteam(TEAM2, engineering.id, &SubteamPatch::default())
            .await?
            .is_none()
    );

    let member = user("macro|grace@example.com");
    assert_eq!(
        repository
            .save_subteam_member(TEAM1, engineering.id, &member, SubteamRole::Member)
            .await?,
        SaveMemberOutcome::Saved
    );
    assert_eq!(
        repository
            .save_subteam_member(TEAM1, engineering.id, &member, SubteamRole::Manager)
            .await?,
        SaveMemberOutcome::Saved
    );
    let promoted = repository
        .get_subteam(TEAM1, engineering.id)
        .await?
        .unwrap();
    assert_eq!(promoted.role_of(&member), Some(SubteamRole::Manager));

    repository
        .remove_subteam_member(TEAM1, engineering.id, &member)
        .await?;
    let removed = repository
        .get_subteam(TEAM1, engineering.id)
        .await?
        .unwrap();
    assert_eq!(removed.role_of(&member), None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn leaving_the_workspace_leaves_its_teams(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool.clone());
    let engineering = create(&repository, "Engineering", None).await?;
    let member = user("macro|grace@example.com");
    repository
        .save_subteam_member(TEAM1, engineering.id, &member, SubteamRole::Member)
        .await?;

    sqlx::query!(
        "DELETE FROM team_user WHERE user_id = $1",
        "macro|grace@example.com"
    )
    .execute(&pool)
    .await?;

    let engineering = repository
        .get_subteam(TEAM1, engineering.id)
        .await?
        .unwrap();
    assert_eq!(engineering.role_of(&member), None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn lists_top_level_teams_first(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);
    let zeta = create(&repository, "Zeta", None).await?;
    let alpha = create(&repository, "Alpha", Some(zeta.id)).await?;

    let names: Vec<String> = repository
        .list_subteams(TEAM1)
        .await?
        .into_iter()
        .map(|subteam| subteam.name)
        .collect();
    assert_eq!(names, vec![zeta.name, alpha.name]);

    Ok(())
}

/// Whether `inner` ended up nested under `middle` while `middle` is nested in turn.
async fn has_two_levels(
    repository: &PgSubteamRepository,
    inner: uuid::Uuid,
    middle: uuid::Uuid,
) -> anyhow::Result<bool> {
    let inner = repository.get_subteam(TEAM1, inner).await?.unwrap();
    let middle = repository.get_subteam(TEAM1, middle).await?.unwrap();

    Ok(inner.parent_id == Some(middle.id) && middle.parent_id.is_some())
}

// Each round races two writes whose checks pass on their own; together they
// would make a second level. Repeated because the race needs both checks to
// run before either write commits.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn concurrent_nesting_never_makes_a_second_level(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);

    for round in 0..20 {
        let outer = create(&repository, &format!("Outer {round}"), None).await?;
        let middle = create(&repository, &format!("Middle {round}"), None).await?;
        let inner = create(&repository, &format!("Inner {round}"), None).await?;

        let (nest_inner, nest_middle) = tokio::join!(
            repository.nest_subteam(TEAM1, inner.id, Some(middle.id)),
            repository.nest_subteam(TEAM1, middle.id, Some(outer.id)),
        );
        nest_inner?;
        nest_middle?;

        assert!(
            !has_two_levels(&repository, inner.id, middle.id).await?,
            "round {round} nested a team two levels deep"
        );
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("subteams"))
)]
async fn creating_under_a_team_while_nesting_it_never_makes_a_second_level(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repository = PgSubteamRepository::new(pool);

    for round in 0..20 {
        let outer = create(&repository, &format!("Outer {round}"), None).await?;
        let middle = create(&repository, &format!("Middle {round}"), None).await?;

        let inner = new_subteam(&format!("Inner {round}"), Some(middle.id));
        let manager = user("macro|ada@example.com");
        let (created, nest_middle) = tokio::join!(
            repository.create_subteam(TEAM1, &inner, &manager, &[]),
            repository.nest_subteam(TEAM1, middle.id, Some(outer.id)),
        );
        nest_middle?;

        if let CreateSubteamOutcome::Created(inner) = created? {
            assert!(
                !has_two_levels(&repository, inner.id, middle.id).await?,
                "round {round} created a team two levels deep"
            );
        }
    }

    Ok(())
}
