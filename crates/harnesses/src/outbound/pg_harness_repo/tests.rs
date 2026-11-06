use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::{
    models::{
        PatchHarnessRequest, ReportWorkspacesRequest, ReportedWorkspace, ReportedWorkspaceKind,
        RequestedHarnessOwner, RequestedHarnessWorkspace,
    },
    ports::{HarnessError, HarnessService},
    service::HarnessServiceImpl,
    tokens,
};

const OWNER_ID: &str = "macro|harness-repo@example.com";

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(OWNER_ID.to_string()).unwrap()
}

async fn insert_user(pool: &PgPool, user_id: &str) {
    let email = user_id.split_once('|').map(|(_, email)| email).unwrap();
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        macro_user_id,
        email,
        format!("stripe_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn new_pairing(code: &str, secret: &str) -> NewPairing {
    NewPairing {
        id: Uuid::new_v4(),
        code: code.to_owned(),
        device_secret_hash: harness_token::hash_token(secret),
        requested_name: "erics-macbook".to_owned(),
        host: Some("eric@macbook / darwin".to_owned()),
        expires_at: Utc::now() + Duration::minutes(15),
    }
}

fn new_harness() -> NewHarness {
    NewHarness {
        allow_permission_bypass: false,
        id: HarnessId::new_from_uuid(Uuid::new_v4()),
        name: "erics-macbook".to_owned(),
        owner: HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        },
        created_by: caller(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pairing_walks_create_approve_claim_exactly_once(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let pairing = new_pairing("KX7M-4QHD", "secret");
    assert!(repo.insert_pairing(pairing.clone()).await.unwrap());
    // The code is unique while the pairing is open.
    assert!(!repo.insert_pairing(pairing.clone()).await.unwrap());

    let row = repo.get_pairing("KX7M-4QHD").await.unwrap().unwrap();
    assert_eq!(row.status, PairingStatus::Pending);
    assert_eq!(row.details.requested_name, "erics-macbook");
    let harness = repo
        .approve_pairing("KX7M-4QHD", new_harness())
        .await
        .unwrap()
        .expect("pending pairing approves");
    assert_eq!(harness.name, "erics-macbook");
    assert!(!harness.connected);

    // A second approval races to nothing and leaks no harness row.
    assert!(
        repo.approve_pairing("KX7M-4QHD", new_harness())
            .await
            .unwrap()
            .is_none()
    );
    let harness_count = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM harnesses"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(harness_count, 1);

    let facts = repo
        .pairing_claim_facts(pairing.id)
        .await
        .unwrap()
        .expect("facts exist");
    assert_eq!(facts.status, PairingStatus::Approved);
    assert_eq!(facts.harness_id, Some(harness.id));
    assert_eq!(
        facts.device_secret_hash,
        harness_token::hash_token("secret")
    );

    let token = tokens::generate_harness_token();
    let claimed = repo
        .claim_pairing(
            pairing.id,
            Uuid::new_v4(),
            HashedHarnessToken::from_raw(&token),
        )
        .await
        .unwrap()
        .expect("approved pairing claims");
    assert_eq!(claimed.id, harness.id);

    // Claiming is single-use.
    assert!(
        repo.claim_pairing(
            pairing.id,
            Uuid::new_v4(),
            HashedHarnessToken::from_raw(&token)
        )
        .await
        .unwrap()
        .is_none()
    );

    let token_count = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM harness_tokens"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(token_count, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn open_pairing_counts_and_expiry_cleanup(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    assert!(
        repo.insert_pairing(new_pairing("AAAA-AAAA", "one"))
            .await
            .unwrap()
    );
    let mut expired = new_pairing("BBBB-BBBB", "two");
    expired.expires_at = Utc::now() - Duration::minutes(1);
    assert!(repo.insert_pairing(expired).await.unwrap());
    let mut other_name = new_pairing("CCCC-CCCC", "three");
    other_name.requested_name = "other".to_owned();
    assert!(repo.insert_pairing(other_name).await.unwrap());

    let counts = repo.count_open_pairings("erics-macbook").await.unwrap();
    assert_eq!(counts.total, 2);
    assert_eq!(counts.with_same_name, 1);

    repo.delete_expired_pairings().await.unwrap();
    assert!(repo.get_pairing("BBBB-BBBB").await.unwrap().is_none());
    assert!(repo.get_pairing("AAAA-AAAA").await.unwrap().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn visibility_spans_own_and_team_harnesses(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());

    // A private harness owned by the caller.
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'mine', $2, $2)
        "#,
        Uuid::new_v4(),
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();

    // A team harness registered by someone else on the caller's team.
    insert_user(&pool, OWNER_ID).await;
    let team_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)"#,
        team_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'member'::team_role)
        "#,
        OWNER_ID,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, team_id, created_by)
        VALUES ($1, 'teams', $2, 'macro|teammate@example.com')
        "#,
        Uuid::new_v4(),
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Someone else's private harness stays invisible.
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'theirs', $2, $2)
        "#,
        Uuid::new_v4(),
        "macro|stranger@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();

    let visible = repo.list_visible_harnesses(caller()).await.unwrap();
    let mut names: Vec<_> = visible.iter().map(|h| h.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["mine", "teams"]);

    assert!(repo.user_has_team(caller(), team_id).await.unwrap());
    assert!(!repo.user_owns_team(caller(), team_id).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletion_soft_deletes_and_revokes_tokens(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'mine', $2, $2)
        "#,
        harness_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let hashed = HashedHarnessToken::from_raw("mhns_abc_secret");
    sqlx::query!(
        r#"
        INSERT INTO harness_tokens (id, harness_id, token_hash, token_prefix)
        VALUES ($1, $2, $3, $4)
        "#,
        Uuid::new_v4(),
        harness_id,
        &hashed.hash[..],
        hashed.prefix,
    )
    .execute(&pool)
    .await
    .unwrap();

    let harness_id = HarnessId::new_from_uuid(harness_id);
    assert!(repo.delete_harness(harness_id).await.unwrap());
    assert!(repo.get_harness(harness_id).await.unwrap().is_none());
    assert!(!repo.delete_harness(harness_id).await.unwrap());

    let unrevoked = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM harness_tokens WHERE revoked_at IS NULL"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unrevoked, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn connected_state_falls_back_to_timestamps_without_connection_rows(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by, last_connected_at)
        VALUES ($1, 'mine', $2, $2, now())
        "#,
        harness_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let harness_id = HarnessId::new_from_uuid(harness_id);

    let harness = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert!(harness.connected);

    sqlx::query!(r#"UPDATE harnesses SET last_disconnected_at = now() + interval '1 second'"#)
        .execute(&pool)
        .await
        .unwrap();
    let harness = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert!(!harness.connected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn connected_state_follows_connection_leases_over_timestamps(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by, last_connected_at, last_disconnected_at)
        VALUES ($1, 'mine', $2, $2, now(), now() + interval '1 hour')
        "#,
        harness_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let connection_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harness_runtime_connection (harness_id, id, replica_id, lease_expires_at)
        VALUES ($1, $2, $3, now() + interval '30 seconds')
        "#,
        harness_id,
        connection_id,
        Uuid::new_v4(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let harness_id = HarnessId::new_from_uuid(harness_id);

    // A live lease wins over a later disconnect stamp.
    let harness = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert!(harness.connected);

    sqlx::query!(
        r#"
        UPDATE harnesses SET last_disconnected_at = NULL;
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE harness_runtime_connection SET lease_expires_at = now() - interval '1 second'"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // A crashed replica writes no disconnect; the lapsed lease is what ends it.
    let harness = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert!(!harness.connected);
    let listed = repo.list_visible_harnesses(caller()).await.unwrap();
    assert!(!listed.iter().any(|harness| harness.connected));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bound_agents_lists_only_live_agents_of_this_harness(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'mine', $2, $2)
        "#,
        harness_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();

    let bot_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
        VALUES ($1, 'owned', $2, 'Bound agent', $3, true)
        "#,
        bot_id,
        OWNER_ID,
        format!("bound-{bot_id}"),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id, is_coding)
        VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2, true)
        "#,
        bot_id,
        harness_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    // An unbound agent on another runtime.
    let other_bot = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
        VALUES ($1, 'owned', $2, 'Unbound agent', $3, true)
        "#,
        other_bot,
        OWNER_ID,
        format!("unbound-{other_bot}"),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, is_coding)
        VALUES ($1, 'prompt', 'in-memory', 'default', 'all', false)
        "#,
        other_bot,
    )
    .execute(&pool)
    .await
    .unwrap();

    let agents = repo
        .list_bound_agents(HarnessId::new_from_uuid(harness_id))
        .await
        .unwrap();
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].bot_id.as_uuid(), bot_id);
    assert_eq!(agents[0].name, "Bound agent");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_list_only_this_harness_newest_first(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    // Sessions reference their owner row.
    insert_user(&pool, OWNER_ID).await;
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'mine', $2, $2)
        "#,
        harness_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();

    let bot_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
        VALUES ($1, 'owned', $2, 'Bound agent', $3, true)
        "#,
        bot_id,
        OWNER_ID,
        format!("bound-{bot_id}"),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id, is_coding)
        VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2, true)
        "#,
        bot_id,
        harness_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    for (offset, status, event_name) in [
        (2_i32, "no_messages", None),
        (1_i32, "event", Some("prompted")),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO agent_session
                (id, owner_id, bot_id, model, harness, workspace, status, status_event_name,
                 created_at, modified_at)
            VALUES ($1, $2, $3, 'default', 'macrod', '/workspace', $4, $5,
                    now() - make_interval(mins => $6), now() - make_interval(mins => $6))
            "#,
            Uuid::new_v4(),
            OWNER_ID,
            bot_id,
            status,
            event_name as Option<&str>,
            offset,
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    // A session on a bot bound to no harness stays invisible.
    let other_bot = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
        VALUES ($1, 'owned', $2, 'Other agent', $3, true)
        "#,
        other_bot,
        OWNER_ID,
        format!("other-{other_bot}"),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, is_coding)
        VALUES ($1, 'prompt', 'in-memory', 'default', 'all', false)
        "#,
        other_bot,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace)
        VALUES ($1, $2, $3, 'default', 'in-memory', '/workspace')
        "#,
        Uuid::new_v4(),
        OWNER_ID,
        other_bot,
    )
    .execute(&pool)
    .await
    .unwrap();

    let sessions = repo
        .list_sessions(HarnessId::new_from_uuid(harness_id))
        .await
        .unwrap();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].status, "event");
    assert_eq!(sessions[1].status, "no_messages");
    assert_eq!(sessions[0].bot_name, "Bound agent");
    assert_eq!(sessions[0].owner_id, OWNER_ID);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn permission_bypass_survives_registration_and_listing(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    insert_user(&pool, OWNER_ID).await;
    for (code, allowed) in [("AAAA-BBBB", false), ("CCCC-DDDD", true)] {
        repo.insert_pairing(new_pairing(code, "secret"))
            .await
            .unwrap();
        let mut registration = new_harness();
        registration.allow_permission_bypass = allowed;
        let harness = repo
            .approve_pairing(code, registration)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(harness.allow_permission_bypass, allowed);
        assert_eq!(
            repo.get_harness(harness.id)
                .await
                .unwrap()
                .unwrap()
                .allow_permission_bypass,
            allowed
        );
        let listed = repo.list_visible_harnesses(caller()).await.unwrap();
        assert_eq!(
            listed
                .iter()
                .find(|item| item.id == harness.id)
                .unwrap()
                .allow_permission_bypass,
            allowed
        );
    }
}

const TEAMMATE_ID: &str = "macro|teammate@example.com";
const STRANGER_ID: &str = "macro|stranger@example.com";

fn service(pool: &PgPool) -> HarnessServiceImpl<PgHarnessRepo> {
    HarnessServiceImpl::new(PgHarnessRepo::new(pool.clone()))
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

async fn insert_team(pool: &PgPool, members: &[&str]) -> Uuid {
    let team_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)"#,
        team_id,
        members[0],
    )
    .execute(pool)
    .await
    .unwrap();
    for member in members {
        sqlx::query!(
            r#"
            INSERT INTO team_user (user_id, team_id, team_role)
            VALUES ($1, $2, 'member'::team_role)
            "#,
            member,
            team_id,
        )
        .execute(pool)
        .await
        .unwrap();
    }
    team_id
}

async fn insert_bound_agent(
    pool: &PgPool,
    name: &str,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
    harness_id: Uuid,
) -> Uuid {
    let bot_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle, has_agent)
        VALUES ($1, 'owned', $2, $3, $4, $5, true)
        "#,
        bot_id,
        owner_user_id,
        team_id,
        name,
        format!("agent-{bot_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id, is_coding)
        VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2, true)
        "#,
        bot_id,
        harness_id,
    )
    .execute(pool)
    .await
    .unwrap();
    bot_id
}

async fn insert_harness_owned_by(
    pool: &PgPool,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
) -> Uuid {
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, team_id, created_by)
        VALUES ($1, 'desk', $2, $3, $4)
        "#,
        harness_id,
        owner_user_id,
        team_id,
        OWNER_ID,
    )
    .execute(pool)
    .await
    .unwrap();
    harness_id
}

async fn stored_owner(pool: &PgPool, harness_id: Uuid) -> (Option<String>, Option<Uuid>) {
    let row = sqlx::query!(
        "SELECT owner_user_id, team_id FROM harnesses WHERE id = $1",
        harness_id,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.owner_user_id, row.team_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_harness_changes_only_the_named_columns(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    insert_user(&pool, OWNER_ID).await;
    repo.insert_pairing(new_pairing("AAAA-BBBB", "secret"))
        .await
        .unwrap();
    let harness = repo
        .approve_pairing("AAAA-BBBB", new_harness())
        .await
        .unwrap()
        .unwrap();

    let bypassed = service(&pool)
        .patch_harness(
            caller(),
            harness.id,
            PatchHarnessRequest {
                allow_permission_bypass: Some(true),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();
    assert!(bypassed.allow_permission_bypass);
    assert_eq!(bypassed.name, harness.name);

    let renamed = service(&pool)
        .patch_harness(
            caller(),
            harness.id,
            PatchHarnessRequest {
                name: Some("studio".to_owned()),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "studio");
    assert!(renamed.allow_permission_bypass);
    assert_eq!(renamed.owner, harness.owner);
    assert_eq!(
        repo.get_harness(harness.id).await.unwrap().unwrap().name,
        "studio"
    );

    service(&pool)
        .delete_harness(caller(), harness.id)
        .await
        .unwrap();
    let result = service(&pool)
        .patch_harness(
            caller(),
            harness.id,
            PatchHarnessRequest {
                name: Some("gone".to_owned()),
                ..PatchHarnessRequest::default()
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_private_harness_moves_to_its_owners_team_with_their_agents(pool: PgPool) {
    insert_user(&pool, OWNER_ID).await;
    let team_id = insert_team(&pool, &[OWNER_ID]).await;
    let harness_id = insert_harness_owned_by(&pool, Some(OWNER_ID), None).await;
    insert_bound_agent(&pool, "Mine", Some(OWNER_ID), None, harness_id).await;

    let updated = service(&pool)
        .patch_harness(
            caller(),
            HarnessId::new_from_uuid(harness_id),
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::Team { team_id }),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.owner, HarnessOwner::Team { team_id });
    assert_eq!(stored_owner(&pool, harness_id).await, (None, Some(team_id)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_harness_stays_shared_while_others_agents_use_it(pool: PgPool) {
    insert_user(&pool, OWNER_ID).await;
    insert_user(&pool, TEAMMATE_ID).await;
    let team_id = insert_team(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness_id = insert_harness_owned_by(&pool, None, Some(team_id)).await;
    insert_bound_agent(&pool, "Mine", Some(OWNER_ID), None, harness_id).await;
    let teammates =
        insert_bound_agent(&pool, "Teammate's", Some(TEAMMATE_ID), None, harness_id).await;
    let teams = insert_bound_agent(&pool, "Team's", None, Some(team_id), harness_id).await;

    let result = service(&pool)
        .patch_harness(
            caller(),
            HarnessId::new_from_uuid(harness_id),
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    let Err(HarnessError::OwnerChangeBlocked(blocking)) = result else {
        panic!("expected the owner change to be blocked, got {result:?}");
    };
    let blocking: Vec<_> = blocking
        .into_iter()
        .map(|agent| (agent.bot_id.as_uuid(), agent.name, agent.owner))
        .collect();
    assert_eq!(
        blocking,
        [
            (
                teammates,
                "Teammate's".to_owned(),
                HarnessAgentOwner::User {
                    user_id: TEAMMATE_ID.to_owned()
                }
            ),
            (
                teams,
                "Team's".to_owned(),
                HarnessAgentOwner::Team { team_id }
            ),
        ]
    );
    assert_eq!(stored_owner(&pool, harness_id).await, (None, Some(team_id)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_harness_goes_private_when_only_the_callers_agents_use_it(pool: PgPool) {
    insert_user(&pool, OWNER_ID).await;
    insert_user(&pool, TEAMMATE_ID).await;
    let team_id = insert_team(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness_id = insert_harness_owned_by(&pool, None, Some(team_id)).await;
    insert_bound_agent(&pool, "Mine", Some(OWNER_ID), None, harness_id).await;
    // A deleted teammate agent no longer binds anything.
    let deleted = insert_bound_agent(&pool, "Gone", Some(TEAMMATE_ID), None, harness_id).await;
    sqlx::query!("UPDATE bots SET deleted_at = now() WHERE id = $1", deleted)
        .execute(&pool)
        .await
        .unwrap();

    let updated = service(&pool)
        .patch_harness(
            caller(),
            HarnessId::new_from_uuid(harness_id),
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        updated.owner,
        HarnessOwner::User {
            user_id: OWNER_ID.to_owned()
        }
    );
    assert_eq!(
        stored_owner(&pool, harness_id).await,
        (Some(OWNER_ID.to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn moving_between_teams_is_blocked_by_the_old_teams_agents(pool: PgPool) {
    // A user belongs to one team at a time: the registrant has left the
    // harness's team for another one.
    insert_user(&pool, OWNER_ID).await;
    insert_user(&pool, TEAMMATE_ID).await;
    let team_id = insert_team(&pool, &[TEAMMATE_ID]).await;
    let other_team_id = insert_team(&pool, &[OWNER_ID]).await;
    let harness_id = insert_harness_owned_by(&pool, None, Some(team_id)).await;
    let teams = insert_bound_agent(&pool, "Team's", None, Some(team_id), harness_id).await;
    // The caller's private agent may follow them to the other team.
    insert_bound_agent(&pool, "Mine", Some(OWNER_ID), None, harness_id).await;

    let result = service(&pool)
        .patch_harness(
            caller(),
            HarnessId::new_from_uuid(harness_id),
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::Team {
                    team_id: other_team_id,
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    let Err(HarnessError::OwnerChangeBlocked(blocking)) = result else {
        panic!("expected the owner change to be blocked, got {result:?}");
    };
    let blocking: Vec<_> = blocking
        .iter()
        .map(|agent| agent.bot_id.as_uuid())
        .collect();
    assert_eq!(blocking, [teams]);
    assert_eq!(stored_owner(&pool, harness_id).await, (None, Some(team_id)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_changes_need_a_manager_and_a_team_they_belong_to(pool: PgPool) {
    insert_user(&pool, OWNER_ID).await;
    insert_user(&pool, TEAMMATE_ID).await;
    insert_user(&pool, STRANGER_ID).await;
    let team_id = insert_team(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let foreign_team_id = insert_team(&pool, &[STRANGER_ID]).await;
    let harness_id = insert_harness_owned_by(&pool, None, Some(team_id)).await;

    // A plain member who neither registered it nor owns the team.
    let result = service(&pool)
        .patch_harness(
            user(TEAMMATE_ID),
            HarnessId::new_from_uuid(harness_id),
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));

    // The registrant, moving it to a team they are not in.
    let result = service(&pool)
        .patch_harness(
            caller(),
            HarnessId::new_from_uuid(harness_id),
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::Team {
                    team_id: foreign_team_id,
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));

    assert_eq!(stored_owner(&pool, harness_id).await, (None, Some(team_id)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reported_workspace_becomes_the_runtime_and_agent_workspace(pool: PgPool) {
    insert_user(&pool, OWNER_ID).await;
    let harness_id = insert_harness_owned_by(&pool, Some(OWNER_ID), None).await;
    let bot_id = insert_bound_agent(&pool, "Mine", Some(OWNER_ID), None, harness_id).await;
    let harness = HarnessId::new_from_uuid(harness_id);

    service(&pool)
        .report_workspaces(
            harness,
            ReportWorkspacesRequest {
                workspaces: vec![
                    ReportedWorkspace {
                        path: "/home/owner/code".to_owned(),
                        kind: ReportedWorkspaceKind::AllowedRoot,
                    },
                    ReportedWorkspace {
                        path: "/home/owner/code/macro".to_owned(),
                        kind: ReportedWorkspaceKind::Repository,
                    },
                ],
            },
        )
        .await
        .unwrap();

    let refused = service(&pool)
        .patch_harness(
            caller(),
            harness,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Path {
                    path: "/etc".to_owned(),
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await;
    assert!(matches!(refused, Err(HarnessError::BadRequest(_))));

    let updated = service(&pool)
        .patch_harness(
            caller(),
            harness,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Path {
                    path: "/home/owner/code/macro".to_owned(),
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        updated.workspace_path.as_deref(),
        Some("/home/owner/code/macro")
    );
    assert_eq!(updated.reported_workspaces.len(), 2);

    sqlx::query!(
        "UPDATE agent_configs SET workspace_path = '/home/owner/code' WHERE bot_id = $1",
        bot_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let agents = service(&pool).list_bound_agents(harness).await.unwrap();
    assert_eq!(
        agents[0].workspace_path.as_deref(),
        Some("/home/owner/code")
    );

    let local = service(&pool)
        .patch_harness(
            caller(),
            harness,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Local),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(local.workspace_path, None);
    assert_eq!(
        service(&pool)
            .get_self(harness)
            .await
            .unwrap()
            .workspace_path,
        None
    );
}
