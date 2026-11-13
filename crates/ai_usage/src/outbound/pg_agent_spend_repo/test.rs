use super::*;
use crate::domain::UsageError;
use crate::domain::spend::{
    AgentSpendService, AgentSpendServiceImpl, ENABLE_AGENT_DASHBOARDS, SpendBucket,
};
use crate::outbound::FlaggedAgentDashboards;
use chrono::{DateTime, Duration, TimeZone, Utc};
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;

const AGENT: &str = "macro|agent@example.com";
const OWNER: &str = "macro|owner@example.com";
const ADMIN: &str = "macro|admin@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";
const STRANGER: &str = "macro|stranger@example.com";
/// An owner of another team.
const OTHER_OWNER: &str = "macro|other-owner@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

async fn insert_user(pool: &PgPool, id: &str, is_agent: bool) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $1, $2, $3)"#,
        id,
        macro_user_id,
        is_agent,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_team(pool: &PgPool, members: &[(&str, &str)]) {
    let team_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO team (id, owner_id, name) VALUES ($1, $2, 'team')"#,
        team_id,
        members[0].0,
    )
    .execute(pool)
    .await
    .unwrap();
    for (member, role) in members {
        sqlx::query!(
            r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::text::team_role)"#,
            *member,
            team_id,
            *role,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

/// The agent and a human teammate on one team with an owner and an admin;
/// a stranger on no team; another team's owner.
async fn seed_people(pool: &PgPool) {
    insert_user(pool, AGENT, true).await;
    for id in [OWNER, ADMIN, TEAMMATE, STRANGER, OTHER_OWNER] {
        insert_user(pool, id, false).await;
    }
    insert_team(
        pool,
        &[
            (OWNER, "owner"),
            (ADMIN, "admin"),
            (TEAMMATE, "member"),
            (AGENT, "member"),
        ],
    )
    .await;
    insert_team(pool, &[(OTHER_OWNER, "owner")]).await;
}

async fn insert_usage(
    pool: &PgPool,
    user_id: &str,
    total: Option<f32>,
    created_at: DateTime<Utc>,
    agent_api_key_id: Option<Uuid>,
) {
    sqlx::query!(
        r#"
        INSERT INTO ai_usage (id, feature, user_id, model, input_tokens, output_tokens, total, created_at, agent_api_key_id)
        VALUES ($1, 'agent_session', $2, 'claude-opus-5', 10, 10, $3, $4, $5)
        "#,
        Uuid::now_v7(),
        user_id,
        total,
        created_at,
        agent_api_key_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn flags_on_for(users: &[&str]) -> FakeFeatureFlags {
    let mut flags = FakeFeatureFlags::default();
    for id in [AGENT, OWNER, ADMIN, TEAMMATE, STRANGER, OTHER_OWNER] {
        let on = users.contains(&id);
        flags.set(
            user(id),
            Ok(FlagSnapshot::new([(
                ENABLE_AGENT_DASHBOARDS.to_owned(),
                FlagValue::Boolean(on),
            )])),
        );
    }
    flags
}

type Service = AgentSpendServiceImpl<
    PgAgentSpendRepo,
    PgAgentSpendRepo,
    FlaggedAgentDashboards<FakeFeatureFlags>,
>;

fn service(pool: &PgPool, flags: Option<FakeFeatureFlags>) -> Service {
    let repo = PgAgentSpendRepo::new(pool.clone());
    AgentSpendServiceImpl::new(repo.clone(), repo, FlaggedAgentDashboards(flags))
}

fn everyone_flagged(pool: &PgPool) -> Service {
    service(
        pool,
        Some(flags_on_for(&[
            AGENT,
            OWNER,
            ADMIN,
            TEAMMATE,
            STRANGER,
            OTHER_OWNER,
        ])),
    )
}

async fn read(service: &Service, actor: &str, target: &str) -> Result<usize> {
    service
        .agent_spend(&user(actor), &user(target), SpendBucket::Day)
        .await
        .map(|spend| spend.buckets.len())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_agent_and_its_team_owners_and_admins_read_its_spend(pool: PgPool) {
    seed_people(&pool).await;
    insert_usage(&pool, AGENT, Some(1.0), Utc::now(), None).await;
    let service = everyone_flagged(&pool);

    for actor in [AGENT, OWNER, ADMIN] {
        assert_eq!(read(&service, actor, AGENT).await.unwrap(), 1, "{actor}");
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn teammates_strangers_and_other_teams_get_not_found(pool: PgPool) {
    seed_people(&pool).await;
    let service = everyone_flagged(&pool);

    for actor in [TEAMMATE, STRANGER, OTHER_OWNER] {
        assert!(
            matches!(
                read(&service, actor, AGENT).await,
                Err(UsageError::NotFound)
            ),
            "{actor}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_is_not_an_agent_so_nobody_reads_their_spend(pool: PgPool) {
    seed_people(&pool).await;
    let service = everyone_flagged(&pool);

    for actor in [OWNER, ADMIN, TEAMMATE] {
        assert!(
            matches!(
                read(&service, actor, TEAMMATE).await,
                Err(UsageError::NotFound)
            ),
            "{actor}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_agent_is_not_found(pool: PgPool) {
    seed_people(&pool).await;
    let service = everyone_flagged(&pool);

    assert!(matches!(
        read(&service, ADMIN, "macro|ghost@example.com").await,
        Err(UsageError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_flag_off_for_the_caller_is_not_found(pool: PgPool) {
    seed_people(&pool).await;
    // On for the agent, off for the admin reading it.
    let flagged = service(&pool, Some(flags_on_for(&[AGENT])));
    assert!(matches!(
        read(&flagged, ADMIN, AGENT).await,
        Err(UsageError::NotFound)
    ));
    assert_eq!(read(&flagged, AGENT, AGENT).await.unwrap(), 0);

    // No PostHog key configured: off for everyone.
    let unconfigured = service(&pool, None);
    assert!(matches!(
        read(&unconfigured, AGENT, AGENT).await,
        Err(UsageError::NotFound)
    ));

    // A failed flag read is off.
    let failing = service(&pool, Some(FakeFeatureFlags::default()));
    assert!(matches!(
        read(&failing, AGENT, AGENT).await,
        Err(UsageError::NotFound)
    ));
}

fn utc(year: i32, month: u32, day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, 0, 0).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sums_priced_usage_per_bucket_in_the_window(pool: PgPool) {
    seed_people(&pool).await;
    let key_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, name, handle, has_agent, owner_user_id)
        VALUES ($1, 'owned', 'Agent', 'agent', true, $2)
        "#,
        key_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_api_keys (bot_id, provider, key_prefix, key_ciphertext, encryption_version, kms_key_id)
        VALUES ($1, 'anthropic', 'sk-ant-', '\x00', 1, 'kms')
        "#,
        key_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Monday 2026-11-09 and Tuesday 2026-11-10; Sunday 2026-11-08 is in
    // the previous ISO week.
    insert_usage(&pool, AGENT, Some(1.0), utc(2026, 11, 9, 1), None).await;
    insert_usage(&pool, AGENT, Some(2.0), utc(2026, 11, 9, 23), Some(key_id)).await;
    insert_usage(&pool, AGENT, Some(4.0), utc(2026, 11, 10, 12), None).await;
    insert_usage(&pool, AGENT, Some(8.0), utc(2026, 11, 8, 12), None).await;
    // Unpriced, someone else's, and before the window: none count.
    insert_usage(&pool, AGENT, None, utc(2026, 11, 10, 13), None).await;
    insert_usage(&pool, TEAMMATE, Some(16.0), utc(2026, 11, 10, 12), None).await;
    insert_usage(
        &pool,
        AGENT,
        Some(32.0),
        utc(2026, 11, 1, 0) - Duration::days(400),
        None,
    )
    .await;

    let repo = PgAgentSpendRepo::new(pool.clone());
    let now = utc(2026, 11, 13, 7);
    let agent = user(AGENT);
    let spend = |bucket: SpendBucket| {
        let repo = repo.clone();
        let agent = agent.clone();
        async move {
            let window = bucket.window(now).unwrap();
            repo.spend_by_bucket(&agent, &window)
                .await
                .unwrap()
                .into_iter()
                .map(|point| (point.start, point.cost_usd))
                .collect::<Vec<_>>()
        }
    };

    assert_eq!(
        spend(SpendBucket::Day).await,
        vec![
            (utc(2026, 11, 8, 0), 8.0),
            (utc(2026, 11, 9, 0), 3.0),
            (utc(2026, 11, 10, 0), 4.0),
        ]
    );
    assert_eq!(
        spend(SpendBucket::Week).await,
        vec![(utc(2026, 11, 2, 0), 8.0), (utc(2026, 11, 9, 0), 7.0)]
    );
    assert_eq!(
        spend(SpendBucket::Month).await,
        vec![(utc(2026, 11, 1, 0), 15.0)]
    );
    assert_eq!(
        spend(SpendBucket::Year).await,
        vec![(utc(2025, 1, 1, 0), 32.0), (utc(2026, 1, 1, 0), 15.0)]
    );
}
