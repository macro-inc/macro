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

fn hosted_pairing(pairing_id: Uuid, secret: &str) -> NewPairing {
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

fn hosted_harness(team_id: Uuid, computer_id: Uuid) -> NewHarness {
    NewHarness {
        allow_permission_bypass: false,
        id: HarnessId::new_from_uuid(Uuid::new_v4()),
        name: "Standard computer".to_owned(),
        owner: HarnessOwner::Team { team_id },
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
    let computer_id = Uuid::new_v4();
    let pairing_id = Uuid::new_v4();
    let harness = hosted_harness(team_id, computer_id);
    let harness_id = harness.id;

    let created = repo
        .upsert_hosted_pairing(hosted_pairing(pairing_id, "first-secret"), harness)
        .await
        .unwrap();
    assert_eq!(created, HostedPairingUpsert::Created);
    let row = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert_eq!(row.owner, HarnessOwner::Team { team_id });
    assert_eq!(row.computer_id, Some(computer_id));
    assert_eq!(row.capabilities, HarnessCapabilities { screen: false });
    assert_eq!(
        repo.computer_harness(computer_id).await.unwrap(),
        Some(harness_id)
    );
    assert_eq!(
        repo.harness_computer(harness_id).await.unwrap(),
        Some(computer_id)
    );

    repo.set_capabilities(harness_id, HarnessCapabilities { screen: true })
        .await
        .unwrap();
    repo.set_claude_mode(harness_id, ClaudeMode::OwnAccount)
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
    assert_eq!(renamed.owner, HarnessOwner::Team { team_id });
    assert_eq!(renamed.computer_id, Some(computer_id));
    assert_eq!(renamed.capabilities, HarnessCapabilities { screen: true });
    assert_eq!(renamed.claude_mode, ClaudeMode::OwnAccount);

    // A retry keeps the pairing and harness and takes the new secret.
    let rotated = repo
        .upsert_hosted_pairing(
            hosted_pairing(Uuid::new_v4(), "second-secret"),
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
    let claimed = repo
        .claim_pairing(
            pairing_id,
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
    let replacement_id = Uuid::now_v7();
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

    // Re-key still works after cleanup removes a claimed pairing.
    sqlx::query!(
        "DELETE FROM harness_pairing_requests WHERE id = $1",
        replacement_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let next_pairing = Uuid::now_v7();
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
            hosted_pairing(Uuid::new_v4(), "fresh-secret"),
            hosted_harness(team_id, computer_id),
        )
        .await
        .unwrap(),
        HostedPairingUpsert::Created
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn capabilities_replace_the_previous_report(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let harness_id = HarnessId::new_from_uuid(Uuid::new_v4());
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

    let fresh = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert_eq!(fresh.capabilities, HarnessCapabilities { screen: false });
    assert_eq!(fresh.computer_id, None);

    assert!(
        repo.set_capabilities(harness_id, HarnessCapabilities { screen: true })
            .await
            .unwrap()
    );
    let reported = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert_eq!(reported.capabilities, HarnessCapabilities { screen: true });
    assert_eq!(reported.claude_mode, ClaudeMode::MacroCredits);
    assert!(
        repo.set_claude_mode(harness_id, ClaudeMode::OwnAccount)
            .await
            .unwrap()
    );
    assert_eq!(
        repo.get_harness(harness_id)
            .await
            .unwrap()
            .unwrap()
            .claude_mode,
        ClaudeMode::OwnAccount
    );

    assert!(repo.delete_harness(harness_id).await.unwrap());
    assert!(
        !repo
            .set_capabilities(harness_id, HarnessCapabilities { screen: false })
            .await
            .unwrap()
    );
}
