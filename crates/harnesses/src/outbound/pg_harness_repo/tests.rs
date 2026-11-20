use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::account_logins::{AccountLoginChange, AgentProvider, ProviderAccountIdentity};
use crate::domain::models::ClaudeMode;
use crate::domain::tokens;

const TEAMMATE_ID: &str = "macro|teammate@example.com";
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
        id: PairingId::new_from_uuid(Uuid::new_v4()),
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
        team_grant: None,
        computer_id: None,
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
            harness_token::hash_token("secret"),
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
            harness_token::hash_token("secret"),
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
    let shared = sqlx::query_scalar!(
        r#"INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'teams', 'macro|teammate@example.com', 'macro|teammate@example.com') RETURNING id"#,
        Uuid::new_v4(),
    ).fetch_one(&pool).await.unwrap();
    repo.set_team_access(HarnessId::new_from_uuid(shared), team_id, true)
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

    let visible = repo.list_usable_harnesses(caller()).await.unwrap();
    let mut names: Vec<_> = visible.iter().map(|h| h.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["mine", "teams"]);

    assert!(repo.user_has_team(caller(), team_id).await.unwrap());
    assert!(repo.user_owns_team(caller(), team_id).await.unwrap());
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
    let listed = repo.list_usable_harnesses(caller()).await.unwrap();
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
        let listed = repo.list_usable_harnesses(caller()).await.unwrap();
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

    let bypassed = repo
        .update_harness(
            harness.id,
            HarnessChanges {
                name: None,
                allow_permission_bypass: Some(true),
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert!(bypassed.allow_permission_bypass);
    assert_eq!(bypassed.name, harness.name);

    let renamed = repo
        .update_harness(
            harness.id,
            HarnessChanges {
                name: Some("studio".to_owned()),
                allow_permission_bypass: None,
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed.name, "studio");
    assert!(renamed.allow_permission_bypass);
    assert_eq!(
        repo.get_harness(harness.id).await.unwrap().unwrap().name,
        "studio"
    );

    assert!(repo.delete_harness(harness.id).await.unwrap());
    assert!(
        repo.update_harness(harness.id, HarnessChanges::default())
            .await
            .unwrap()
            .is_none()
    );
}

fn hosted_pairing(pairing_id: PairingId, secret: &str) -> NewPairing {
    NewPairing {
        id: pairing_id,
        code: format!("hosted:{pairing_id}"),
        device_secret_hash: harness_token::hash_token(secret),
        requested_name: "Standard computer".to_owned(),
        host: None,
        // Already past expiry: an approved pairing stays claimable.
        expires_at: Utc::now() - Duration::minutes(1),
    }
}

fn hosted_harness(team_id: Uuid, computer_id: ComputerId) -> NewHarness {
    NewHarness {
        allow_permission_bypass: false,
        id: HarnessId::new_from_uuid(Uuid::new_v4()),
        name: "Standard computer".to_owned(),
        owner: HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        },
        team_grant: Some(team_id),
        created_by: caller(),
        computer_id: Some(computer_id),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn hosted_pairing_is_born_approved_rotates_on_retry_and_claims_once(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
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
    let computer_id = ComputerId::new_from_uuid(Uuid::new_v4());
    let pairing_id = PairingId::new_from_uuid(Uuid::new_v4());
    let harness = hosted_harness(team_id, computer_id);
    let harness_id = harness.id;

    let created = repo
        .upsert_hosted_pairing(hosted_pairing(pairing_id, "first-secret"), harness)
        .await
        .unwrap();
    assert_eq!(created, HostedPairingUpsert::Created);
    let row = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert_eq!(
        row.owner,
        HarnessOwner::User {
            user_id: OWNER_ID.to_owned()
        }
    );
    assert_eq!(row.computer_id, Some(computer_id));
    assert_eq!(
        repo.computer_harness(computer_id).await.unwrap(),
        Some(harness_id)
    );
    assert_eq!(
        repo.harness_computer(harness_id).await.unwrap(),
        Some(computer_id)
    );

    repo.record_account_login(
        harness_id,
        claude_sign_in("sha256:computer", "2027-01-01T00:00:00Z", Some(caller())),
    )
    .await
    .unwrap();
    let renamed = repo
        .update_harness(
            harness_id,
            HarnessChanges {
                name: Some("Renamed computer".to_owned()),
                allow_permission_bypass: Some(true),
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed.name, "Renamed computer");
    assert!(renamed.allow_permission_bypass);
    assert_eq!(
        renamed.owner,
        HarnessOwner::User {
            user_id: OWNER_ID.to_owned()
        }
    );
    assert_eq!(renamed.computer_id, Some(computer_id));
    assert_eq!(renamed.claude_mode, ClaudeMode::OwnAccount);

    // A retry keeps the pairing and harness and takes the new secret.
    let rotated = repo
        .upsert_hosted_pairing(
            hosted_pairing(PairingId::new_from_uuid(Uuid::new_v4()), "second-secret"),
            hosted_harness(team_id, computer_id),
        )
        .await
        .unwrap();
    assert_eq!(rotated, HostedPairingUpsert::Rotated { pairing_id });
    let harness_count = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM harnesses"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(harness_count, 1);
    let facts = repo.pairing_claim_facts(pairing_id).await.unwrap().unwrap();
    assert_eq!(facts.status, PairingStatus::Approved);
    assert_eq!(facts.harness_id, Some(harness_id));
    assert_eq!(
        facts.device_secret_hash,
        harness_token::hash_token("second-secret")
    );

    // Expiry cleanup never touches an approved pairing.
    repo.delete_expired_pairings().await.unwrap();
    let token = tokens::generate_harness_token();
    // A claim whose earlier hash check raced rotation must fail under the lock.
    assert!(
        repo.claim_pairing(
            pairing_id,
            harness_token::hash_token("first-secret"),
            Uuid::now_v7(),
            HashedHarnessToken::from_raw(&token)
        )
        .await
        .unwrap()
        .is_none()
    );
    let claimed = repo
        .claim_pairing(
            pairing_id,
            harness_token::hash_token("second-secret"),
            Uuid::new_v4(),
            HashedHarnessToken::from_raw(&token),
        )
        .await
        .unwrap()
        .expect("hosted pairing claims");
    assert_eq!(claimed.id, harness_id);

    let bot_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
           VALUES ($1, 'owned', $2, 'Bound agent', $3, true)"#,
        bot_id,
        OWNER_ID,
        format!("bound-{bot_id}"),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id, is_coding)
           VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2, true)"#,
        bot_id, harness_id.as_uuid(),
    ).execute(&pool).await.unwrap();
    let second_token = HashedHarnessToken::from_raw(&tokens::generate_harness_token());
    sqlx::query!(
        "INSERT INTO harness_tokens (id, harness_id, token_hash, token_prefix) VALUES ($1, $2, $3, $4)",
        Uuid::now_v7(), harness_id.as_uuid(), &second_token.hash[..], second_token.prefix,
    ).execute(&pool).await.unwrap();

    // Re-enrollment replaces credentials without replacing the harness.
    let replacement_id = PairingId::new_from_uuid(Uuid::now_v7());
    let after_claim = repo
        .upsert_hosted_pairing(
            hosted_pairing(replacement_id, "third-secret"),
            hosted_harness(team_id, computer_id),
        )
        .await
        .unwrap();
    assert_eq!(after_claim, HostedPairingUpsert::Rekeyed);
    assert!(
        repo.pairing_claim_facts(pairing_id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.claim_pairing(
            pairing_id,
            harness_token::hash_token("second-secret"),
            Uuid::now_v7(),
            HashedHarnessToken::from_raw(&token)
        )
        .await
        .unwrap()
        .is_none()
    );
    let revoked = sqlx::query_scalar!(
        "SELECT bool_and(revoked_at IS NOT NULL) FROM harness_tokens WHERE harness_id = $1",
        harness_id.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(revoked, Some(true));
    let facts = repo
        .pairing_claim_facts(replacement_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(facts.status, PairingStatus::Approved);
    assert_eq!(facts.harness_id, Some(harness_id));
    assert_eq!(
        facts.device_secret_hash,
        harness_token::hash_token("third-secret")
    );
    let new_token = tokens::generate_harness_token();
    let reclaimed = repo
        .claim_pairing(
            replacement_id,
            harness_token::hash_token("third-secret"),
            Uuid::now_v7(),
            HashedHarnessToken::from_raw(&new_token),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reclaimed.id, harness_id);
    assert_eq!(reclaimed.created_at, claimed.created_at);
    assert_eq!(reclaimed.owner, claimed.owner);
    assert_eq!(
        reclaimed.allow_permission_bypass,
        claimed.allow_permission_bypass
    );
    assert_eq!(
        repo.computer_harness(computer_id).await.unwrap(),
        Some(harness_id)
    );
    let active_tokens = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM harness_tokens WHERE harness_id = $1 AND revoked_at IS NULL"#,
        harness_id.as_uuid(),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(active_tokens, 1);

    let bound_harness = sqlx::query_scalar!(
        "SELECT harness_id FROM agent_configs WHERE bot_id = $1",
        bot_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(bound_harness, Some(harness_id.as_uuid()));

    // Cleanup must retain the durable claim used by a fleet Create retry.
    sqlx::query!(
        "UPDATE harness_pairing_requests SET expires_at = now() - interval '1 hour' WHERE id = $1",
        replacement_id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.delete_expired_pairings().await.unwrap();
    assert_eq!(
        repo.pairing_claim_facts(replacement_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        PairingStatus::Claimed
    );

    // Explicit retirement can still be followed by re-enrollment.
    sqlx::query!(
        "DELETE FROM harness_pairing_requests WHERE id = $1",
        replacement_id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    let next_pairing = PairingId::new_from_uuid(Uuid::now_v7());
    assert_eq!(
        repo.upsert_hosted_pairing(
            hosted_pairing(next_pairing, "fourth-secret"),
            hosted_harness(team_id, computer_id),
        )
        .await
        .unwrap(),
        HostedPairingUpsert::Rekeyed
    );
    assert_eq!(
        repo.pairing_claim_facts(next_pairing)
            .await
            .unwrap()
            .unwrap()
            .harness_id,
        Some(harness_id)
    );

    // Revoked, the computer has no live harness and may be paired afresh.
    assert!(repo.delete_harness(harness_id).await.unwrap());
    assert_eq!(repo.computer_harness(computer_id).await.unwrap(), None);
    assert_eq!(repo.harness_computer(harness_id).await.unwrap(), None);
    assert_eq!(
        repo.upsert_hosted_pairing(
            hosted_pairing(PairingId::new_from_uuid(Uuid::new_v4()), "fresh-secret"),
            hosted_harness(team_id, computer_id),
        )
        .await
        .unwrap(),
        HostedPairingUpsert::Created
    );
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

async fn team_of(pool: &PgPool, members: &[&str]) -> Uuid {
    let team_id = Uuid::new_v4();
    for member in members {
        insert_user(pool, member).await;
    }
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

async fn private_harness(pool: &PgPool, owner: &str) -> HarnessId {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'box', $2, $2)
        "#,
        id,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    HarnessId::new_from_uuid(id)
}

async fn grant_directly(pool: &PgPool, harness: HarnessId, user: &str) {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'harness', $2, 'user', 'edit')
        "#,
        harness.as_uuid(),
        user,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_directory_lists_teammates_runtimes_with_the_callers_access(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    team_of(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness = private_harness(&pool, TEAMMATE_ID).await;
    private_harness(&pool, "macro|stranger@example.com").await;

    let directory = repo.list_directory_harnesses(user(OWNER_ID)).await.unwrap();
    assert_eq!(directory.len(), 1, "a stranger's runtime stays out of it");
    assert_eq!(directory[0].id, harness);
    assert_eq!(directory[0].access, HarnessAccess::None);
    assert!(
        repo.list_usable_harnesses(user(OWNER_ID))
            .await
            .unwrap()
            .is_empty(),
        "seeing a runtime is not being able to use it"
    );

    grant_directly(&pool, harness, OWNER_ID).await;
    let usable = repo.list_usable_harnesses(user(OWNER_ID)).await.unwrap();
    assert_eq!(usable[0].access, HarnessAccess::User);
    assert_eq!(
        repo.list_usable_harnesses(user(TEAMMATE_ID)).await.unwrap()[0].access,
        HarnessAccess::Owner
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_direct_grant_lasts_only_while_its_holder_shares_a_team_with_the_owner(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let team_id = team_of(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness = private_harness(&pool, TEAMMATE_ID).await;
    grant_directly(&pool, harness, OWNER_ID).await;
    assert_eq!(
        repo.harness_access(harness, user(OWNER_ID)).await.unwrap(),
        HarnessAccess::User
    );

    sqlx::query!(
        "DELETE FROM team_user WHERE user_id = $1 AND team_id = $2",
        OWNER_ID,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.harness_access(harness, user(OWNER_ID)).await.unwrap(),
        HarnessAccess::None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn closing_a_runtime_to_a_team_ends_its_members_access(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let team_id = team_of(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness = private_harness(&pool, TEAMMATE_ID).await;

    repo.set_team_access(harness, team_id, true).await.unwrap();
    assert_eq!(
        repo.get_harness(harness)
            .await
            .unwrap()
            .unwrap()
            .shared_team_ids,
        [team_id]
    );
    assert_eq!(
        repo.harness_access(harness, user(OWNER_ID)).await.unwrap(),
        HarnessAccess::User
    );

    repo.set_team_access(harness, team_id, false).await.unwrap();
    assert_eq!(
        repo.harness_access(harness, user(OWNER_ID)).await.unwrap(),
        HarnessAccess::None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn approving_for_a_team_keeps_a_person_as_owner_and_grants_the_team(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let team_id = team_of(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let code = "KX7M-4QHD";
    repo.insert_pairing(new_pairing(code, "secret"))
        .await
        .unwrap();

    let mut registration = new_harness();
    registration.team_grant = Some(team_id);
    let harness = repo
        .approve_pairing(code, registration)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        harness.owner,
        HarnessOwner::User {
            user_id: OWNER_ID.to_owned()
        }
    );
    assert_eq!(harness.shared_team_ids, [team_id]);
    assert_eq!(
        repo.harness_access(harness.id, user(TEAMMATE_ID))
            .await
            .unwrap(),
        HarnessAccess::User
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reader_sees_a_runtime_but_cannot_run_on_it(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    team_of(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness = private_harness(&pool, TEAMMATE_ID).await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'harness', $2, 'user', 'view')
        "#,
        harness.as_uuid(),
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.harness_access(harness, user(OWNER_ID)).await.unwrap(),
        HarnessAccess::Read
    );
    assert!(
        repo.list_usable_harnesses(user(OWNER_ID))
            .await
            .unwrap()
            .is_empty(),
        "a reader cannot pick it to run agents on"
    );
    assert_eq!(
        repo.list_directory_harnesses(user(OWNER_ID)).await.unwrap()[0].access,
        HarnessAccess::Read
    );
}

fn claude_sign_in(
    credential_id: &str,
    expires_at: &str,
    signed_in_by: Option<MacroUserIdStr<'static>>,
) -> AccountLoginChange {
    AccountLoginChange::SignedIn {
        provider: AgentProvider::Claude,
        account: ProviderAccountIdentity {
            external_account_id: credential_id.to_owned(),
        },
        expires_at: Some(expires_at.parse().unwrap()),
        signed_in_by,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_claude_sign_in_is_a_login_and_one_account_spans_machines(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    insert_user(&pool, OWNER_ID).await;
    insert_user(&pool, TEAMMATE_ID).await;
    let mine = HarnessId::new_from_uuid(Uuid::new_v4());
    let spare = HarnessId::new_from_uuid(Uuid::new_v4());
    for harness_id in [mine, spare] {
        sqlx::query!(
            r#"
            INSERT INTO harnesses (id, name, owner_user_id, created_by)
            VALUES ($1, 'mine', $2, $2)
            "#,
            harness_id.as_uuid(),
            OWNER_ID,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let teammate = MacroUserIdStr::try_from(TEAMMATE_ID.to_owned()).unwrap();

    assert!(
        repo.record_account_login(
            mine,
            claude_sign_in(
                "sha256:first",
                "2027-01-01T00:00:00Z",
                Some(teammate.clone())
            )
        )
        .await
        .unwrap()
    );
    let first = repo
        .active_account_login(mine, AgentProvider::Claude)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.signed_in_by, Some(teammate.clone()));
    assert_eq!(first.account.identity.external_account_id, "sha256:first");
    assert_eq!(
        first.expires_at,
        Some("2027-01-01T00:00:00Z".parse().unwrap())
    );
    assert_eq!(
        repo.get_harness(mine).await.unwrap().unwrap().claude_mode,
        ClaudeMode::OwnAccount
    );

    // The machine reporting the same credential again moves only its expiry.
    assert!(
        repo.record_account_login(
            mine,
            claude_sign_in("sha256:first", "2027-06-01T00:00:00Z", None)
        )
        .await
        .unwrap()
    );
    let reported = repo
        .active_account_login(mine, AgentProvider::Claude)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reported.id, first.id);
    assert_eq!(reported.signed_in_by, Some(teammate.clone()));
    assert_eq!(
        reported.expires_at,
        Some("2027-06-01T00:00:00Z".parse().unwrap())
    );

    // A new credential starts a new login; the old one stays as history.
    assert!(
        repo.record_account_login(
            mine,
            claude_sign_in("sha256:second", "2027-02-01T00:00:00Z", Some(caller()))
        )
        .await
        .unwrap()
    );
    let second = repo
        .active_account_login(mine, AgentProvider::Claude)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(second.id, first.id);
    assert_eq!(second.signed_in_by, Some(caller()));
    assert_eq!(
        second.expires_at,
        Some("2027-02-01T00:00:00Z".parse().unwrap())
    );
    // The same account on another machine is the same provider account.
    assert!(
        repo.record_account_login(
            spare,
            claude_sign_in("sha256:second", "2027-02-01T00:00:00Z", Some(caller()))
        )
        .await
        .unwrap()
    );
    let elsewhere = repo
        .active_account_login(spare, AgentProvider::Claude)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(elsewhere.account.id, second.account.id);

    assert!(
        repo.record_account_login(
            mine,
            AccountLoginChange::SignedOut {
                provider: AgentProvider::Claude
            }
        )
        .await
        .unwrap()
    );
    assert_eq!(
        repo.active_account_login(mine, AgentProvider::Claude)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        repo.get_harness(mine).await.unwrap().unwrap().claude_mode,
        ClaudeMode::MacroCredits
    );
    let history = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM harness_account_logins WHERE harness_id = $1 AND signed_out_at IS NOT NULL"#,
        mine.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(history, 2);
    assert!(
        !repo
            .record_account_login(
                HarnessId::new_from_uuid(Uuid::new_v4()),
                claude_sign_in("sha256:second", "2027-02-01T00:00:00Z", Some(caller()))
            )
            .await
            .unwrap(),
        "an unknown harness records nothing"
    );
}

/// Binds a new agent owned by `owner` to `harness`, returning its id.
async fn bound_agent(pool: &PgPool, harness: HarnessId, owner: &str, is_coding: bool) -> Uuid {
    let bot_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
        VALUES ($1, 'owned', $2, 'Agent', $3, true)
        "#,
        bot_id,
        owner,
        format!("agent-{bot_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id, is_coding)
        VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2, $3)
        "#,
        bot_id,
        harness.as_uuid(),
        is_coding,
    )
    .execute(pool)
    .await
    .unwrap();
    bot_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bound_agents_leave_out_residents_whose_owner_lost_access(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    team_of(&pool, &[OWNER_ID, TEAMMATE_ID]).await;
    let harness = private_harness(&pool, OWNER_ID).await;
    grant_directly(&pool, harness, TEAMMATE_ID).await;
    let own_resident = bound_agent(&pool, harness, OWNER_ID, false).await;
    let teammate_resident = bound_agent(&pool, harness, TEAMMATE_ID, false).await;
    let teammate_coder = bound_agent(&pool, harness, TEAMMATE_ID, true).await;

    let listed = |agents: Vec<HarnessAgent>| {
        agents
            .into_iter()
            .map(|agent| agent.bot_id.as_uuid())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        listed(repo.list_bound_agents(harness).await.unwrap()),
        [own_resident, teammate_resident, teammate_coder]
    );

    // Lowered to Read: the teammate's resident stops; a coding agent is
    // checked per prompt instead, so it stays.
    sqlx::query!(
        r#"
        UPDATE entity_access SET access_level = 'view'
        WHERE entity_id = $1 AND source_id = $2
        "#,
        harness.as_uuid(),
        TEAMMATE_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        listed(repo.list_bound_agents(harness).await.unwrap()),
        [own_resident, teammate_coder]
    );
}

/// A computer's harness follows its team: admins own it, members use it,
/// and its buyer keeps nothing once they leave.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_harness_belongs_to_its_team_not_its_buyer(pool: PgPool) {
    const ADMIN_ID: &str = "macro|admin@example.com";
    const MEMBER_ID: &str = "macro|member@example.com";
    let repo = PgHarnessRepo::new(pool.clone());
    // OWNER_ID is the team's owner and buys the computer.
    let team_id = team_of(&pool, &[OWNER_ID, ADMIN_ID, MEMBER_ID]).await;
    sqlx::query!(
        "UPDATE team_user SET team_role = 'admin'::team_role WHERE user_id = $1",
        ADMIN_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let computer_id = ComputerId::new_from_uuid(Uuid::new_v4());
    let harness = hosted_harness(team_id, computer_id);
    let harness_id = harness.id;
    repo.upsert_hosted_pairing(
        hosted_pairing(PairingId::new_from_uuid(Uuid::new_v4()), "secret"),
        harness,
    )
    .await
    .unwrap();
    let host_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO hosted_runtime_host (id, name, awake_capacity_units, sold_capacity_units)
        VALUES ($1, 'host-1', 8, 8)
        "#,
        host_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO hosted_runtime (
            id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry,
            purchase_key, host_id, state, harness_id, created_by
        )
        VALUES ($1, $2, 'Computer', 'standard', 2, 8, 40, 'standard-v1', 'buy-1', $3, '{}', $4, $5)
        "#,
        computer_id.as_uuid(),
        team_id,
        host_id,
        harness_id.as_uuid(),
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.harness_access(harness_id, user(OWNER_ID))
            .await
            .unwrap(),
        HarnessAccess::Owner
    );
    assert_eq!(
        repo.harness_access(harness_id, user(ADMIN_ID))
            .await
            .unwrap(),
        HarnessAccess::Owner
    );
    assert_eq!(
        repo.harness_access(harness_id, user(MEMBER_ID))
            .await
            .unwrap(),
        HarnessAccess::User
    );

    // The team changes hands and the buyer leaves.
    sqlx::query!(
        "UPDATE team SET owner_id = $1 WHERE id = $2",
        ADMIN_ID,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM team_user WHERE user_id = $1 AND team_id = $2",
        OWNER_ID,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.harness_access(harness_id, user(OWNER_ID))
            .await
            .unwrap(),
        HarnessAccess::None
    );
    assert!(
        repo.list_usable_harnesses(user(OWNER_ID))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.list_directory_harnesses(user(OWNER_ID))
            .await
            .unwrap()
            .is_empty(),
        "a former member does not see the team's computer"
    );
    assert_eq!(
        repo.harness_access(harness_id, user(ADMIN_ID))
            .await
            .unwrap(),
        HarnessAccess::Owner
    );
}

/// The Anthropic gateway serves a session only through this lookup: a bot
/// on a live computer harness has its computer; a paired machine, a deleted
/// computer harness or no harness at all has none.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_bot_has_a_computer_only_on_a_live_computer_harness(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let team_id = team_of(&pool, &[OWNER_ID]).await;
    let computer_id = ComputerId::new_from_uuid(Uuid::new_v4());
    let harness = hosted_harness(team_id, computer_id);
    let harness_id = harness.id;
    repo.upsert_hosted_pairing(
        hosted_pairing(PairingId::new_from_uuid(Uuid::new_v4()), "secret"),
        harness,
    )
    .await
    .unwrap();
    let paired_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, 'laptop', $2, $2)
        "#,
        paired_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let on_computer = Uuid::new_v4();
    let on_laptop = Uuid::new_v4();
    let unbound = Uuid::new_v4();
    for (bot, handle, harness) in [
        (on_computer, "on-computer", Some(harness_id.as_uuid())),
        (on_laptop, "on-laptop", Some(paired_id)),
        (unbound, "unbound", None),
    ] {
        sqlx::query!(
            r#"
            INSERT INTO bots (id, kind, owner_user_id, name, handle, has_agent)
            VALUES ($1, 'owned', $2, 'Agent', $3, true)
            "#,
            bot,
            OWNER_ID,
            handle,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"
            INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, harness_id, is_coding)
            VALUES ($1, 'prompt', 'macrod', 'default', 'all', $2, true)
            "#,
            bot,
            harness,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let computer_for = |bot: Uuid| repo.computer_for_bot(bot_id::BotId::new_from_uuid(bot));

    assert_eq!(computer_for(on_computer).await.unwrap(), Some(computer_id));
    assert_eq!(computer_for(on_laptop).await.unwrap(), None);
    assert_eq!(computer_for(unbound).await.unwrap(), None);

    sqlx::query!(
        "UPDATE harnesses SET deleted_at = now() WHERE id = $1",
        harness_id.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(computer_for(on_computer).await.unwrap(), None);
}
