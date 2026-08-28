use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::tokens;

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
        requested_scope: Some(RequestedHarnessScope::Team),
        expires_at: Utc::now() + Duration::minutes(15),
    }
}

fn new_harness() -> NewHarness {
    NewHarness {
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
    assert_eq!(
        row.details.requested_scope,
        Some(RequestedHarnessScope::Team)
    );

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
async fn connected_state_follows_the_presence_timestamps(pool: PgPool) {
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
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id)
        VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2)
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
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope)
        VALUES ($1, 'prompt', 'in-memory', 'default', 'all')
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
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id)
        VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2)
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
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope)
        VALUES ($1, 'prompt', 'in-memory', 'default', 'all')
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
