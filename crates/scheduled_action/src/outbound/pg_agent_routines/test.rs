use chrono::{Duration, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;
use sqlx::PgPool;

use super::*;
use crate::domain::event_trigger::ActionTrigger;
use crate::domain::models::{ScheduledAction, SubRoutine};
use crate::domain::ports::ScheduledActionRepo;
use crate::outbound::pg_scheduled_action_repo::test::{
    USER_A, USER_B, insert_user, sample_action, test_repo, user_owner,
};

const AGENT: &str = "macro|agent-routines@macro.com";
const OWNER: &str = "macro|agent-owner@macro.com";
const ADMIN: &str = "macro|agent-admin@macro.com";
const MEMBER: &str = "macro|agent-member@macro.com";
const OTHER_ADMIN: &str = "macro|other-admin@macro.com";

fn id(user: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(user).unwrap()
}

async fn team(pool: &PgPool, owner: &str, members: &[(&str, &str)]) {
    let team_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'team', $2)"#,
        team_id,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    for (user, role) in members {
        sqlx::query!(
            r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::text::team_role)"#,
            user,
            team_id,
            role,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn mark_agent(pool: &PgPool, user: &str) {
    sqlx::query!(r#"UPDATE "User" SET "isAgent" = TRUE WHERE id = $1"#, user)
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owners_and_admins_of_an_agents_team_oversee_it(pool: PgPool) {
    for user in [AGENT, OWNER, ADMIN, MEMBER, OTHER_ADMIN, USER_A] {
        insert_user(&pool, user).await;
    }
    mark_agent(&pool, AGENT).await;
    team(
        &pool,
        OWNER,
        &[
            (AGENT, "member"),
            (OWNER, "owner"),
            (ADMIN, "admin"),
            (MEMBER, "member"),
            (USER_A, "member"),
        ],
    )
    .await;
    team(&pool, OTHER_ADMIN, &[(OTHER_ADMIN, "admin")]).await;
    let store = PgAgentRoutines::new(pool);

    assert!(store.oversees(&id(OWNER), &id(AGENT)).await.unwrap());
    assert!(store.oversees(&id(ADMIN), &id(AGENT)).await.unwrap());
    assert!(!store.oversees(&id(MEMBER), &id(AGENT)).await.unwrap());
    assert!(!store.oversees(&id(OTHER_ADMIN), &id(AGENT)).await.unwrap());
    // A person on the team is no agent, so their admins don't oversee them.
    assert!(!store.oversees(&id(ADMIN), &id(USER_A)).await.unwrap());
}

/// A one-time sub-routine of `parent` that already ran.
fn finished_child(parent: &ScheduledAction, name: &str) -> ScheduledAction {
    ScheduledAction {
        trigger: ActionTrigger::Once {
            at: Utc.with_ymd_and_hms(2026, 1, 1, 9, 0, 0).unwrap(),
        },
        next_run_at: None,
        sub_routine: Some(SubRoutine {
            parent_id: parent.id.unwrap(),
            created_by_run_id: macro_uuid::generate_uuid_v7(),
            key: None,
            paused_by_parent: false,
        }),
        ..sample_action(parent.owner.clone(), name)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lists_an_owners_top_level_routines_oldest_first_up_to_the_limit(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = test_repo(pool.clone());
    // Created newest first, then dated oldest first: the list follows
    // `created_at`, not id order.
    let start = Utc::now() - Duration::days(10);
    let mut top_level = Vec::new();
    for n in (0..3).rev() {
        let created = repo
            .create_action(sample_action(user_owner(USER_A), &format!("routine {n}")))
            .await
            .unwrap();
        sqlx::query!(
            "UPDATE scheduled_action SET created_at = $2 WHERE id = $1",
            created.id.unwrap(),
            start + Duration::days(n),
        )
        .execute(&pool)
        .await
        .unwrap();
        top_level.insert(0, created);
    }
    // Sub-routines are newer than every parent, and another owner's
    // routines sit beside them.
    for n in 0..3 {
        repo.create_action(finished_child(&top_level[0], &format!("child {n}")))
            .await
            .unwrap();
    }
    repo.create_action(sample_action(user_owner(USER_B), "not mine"))
        .await
        .unwrap();

    // The middle routine is in a run.
    let middle = &top_level[1];
    repo.claim_action(
        &middle.id.unwrap(),
        middle.configuration_revision,
        middle.next_run_at,
    )
    .await
    .unwrap();

    let store = PgAgentRoutines::new(pool);
    let listed = store.top_level_routines(&id(USER_A), 10).await.unwrap();
    let names: Vec<_> = listed.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["routine 0", "routine 1", "routine 2"]);
    let running: Vec<_> = listed.iter().map(|r| r.running).collect();
    assert_eq!(running, [false, true, false]);
    assert_eq!(listed[0].trigger_kind, TriggerKind::Cron);
    assert_eq!(listed[0].next_run_at, top_level[0].next_run_at);
    assert!(listed.iter().all(|r| r.last_run.is_none()));

    let first_two = store.top_level_routines(&id(USER_A), 2).await.unwrap();
    let ids: Vec<Uuid> = first_two.iter().map(|r| r.id).collect();
    assert_eq!(ids, [top_level[0].id.unwrap(), top_level[1].id.unwrap()]);
}
