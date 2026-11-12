use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);

async fn insert_team(pool: &PgPool) {
    let macro_user_id = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0011);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'admin@example.com', 'admin@example.com', 'cus_admin')
        "#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|admin@example.com', 'admin@example.com', $1)"#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Agents', 'macro|admin@example.com')",
        TEAM,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn sam() -> NewAgentAccount {
    NewAgentAccount {
        user_id: MacroUserIdStr::parse_from_str("macro|sam-rivera-abc123@agents.macro.invalid")
            .unwrap()
            .into_owned(),
        email: "sam-rivera-abc123@agents.macro.invalid".to_owned(),
        team_id: TEAM,
        created_by: MacroUserIdStr::parse_from_str("macro|admin@example.com")
            .unwrap()
            .into_owned(),
        name: "Sam Rivera".to_owned(),
        avatar_url: None,
        persona_seed: PersonaSeed {
            creator_id: Some(
                MacroUserIdStr::parse_from_str("macro|admin@example.com")
                    .unwrap()
                    .into_owned(),
            ),
            name: "Sam Rivera".to_owned(),
            job_description: "Runs vendor relations.".to_owned(),
            personality: "Dry, direct, kind.".to_owned(),
            voice: None,
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_account_round_trips_and_is_marked_as_an_agent(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    let account = sam();

    repo.create_account(&account).await.unwrap();

    let stored = repo.get(&account.user_id).await.unwrap().unwrap();
    assert_eq!(stored.team_id, TEAM);
    assert_eq!(stored.persona_seed, account.persona_seed);
    assert_eq!(stored.created_by, Some(account.created_by.clone()));
    assert_eq!(
        repo.list_for_team(TEAM).await.unwrap(),
        vec![stored.clone()]
    );
    let is_agent: bool = sqlx::query_scalar!(
        r#"SELECT "isAgent" FROM "User" WHERE id = $1"#,
        account.user_id.as_ref()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_agent);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_account_deletes_the_agent(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool);
    let account = sam();
    repo.create_account(&account).await.unwrap();

    repo.delete_account(&account.user_id).await.unwrap();

    assert_eq!(repo.get(&account.user_id).await.unwrap(), None);
    assert!(repo.list_for_team(TEAM).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_facts_read_the_row_the_agent_flag_membership_and_creator(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    let account = sam();
    repo.create_account(&account).await.unwrap();

    // Created, but not yet joined to the team.
    let facts = repo.account_facts(&account.user_id).await.unwrap().unwrap();
    assert_eq!(
        facts,
        AgentAccountFacts {
            team_id: TEAM,
            is_agent: true,
            member: false,
            created_by: Some(account.created_by.clone()),
            created_by_is_agent: false,
        }
    );

    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        TEAM,
        account.user_id.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.account_facts(&account.user_id)
            .await
            .unwrap()
            .unwrap()
            .member
    );

    // The creator marked as an agent is no responsible human.
    sqlx::query!(r#"UPDATE "User" SET "isAgent" = TRUE WHERE id = 'macro|admin@example.com'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.account_facts(&account.user_id)
            .await
            .unwrap()
            .unwrap()
            .created_by_is_agent
    );

    let human = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    assert_eq!(repo.account_facts(&human).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_an_agent_keeps_what_it_owns_and_its_key_stops_working(pool: PgPool) {
    use std::sync::Arc;

    use user_api_key::domain::models::UserApiKey;
    use user_api_key::domain::ports::{UserApiKeyService, UserApiKeysRepo};
    use user_api_key::domain::service::UserApiKeyServiceImpl;
    use user_api_key::outbound::pg_user_api_keys_repo::PgUserApiKeysRepo;

    use crate::domain::ports::AgentApiKeys;
    use crate::outbound::agent_api_keys::UserApiKeys;

    insert_team(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    let account = sam();
    repo.create_account(&account).await.unwrap();
    let agent = account.user_id.as_ref();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ('0193a1b2-0000-7000-8000-0000000000d0', 'Vendor notes', $1, 'md')"#,
        agent,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('0193a1b2-0000-7000-8000-0000000000d0', 'document', $1, 'team', 'edit')
        "#,
        TEAM.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let keys = Arc::new(UserApiKeyServiceImpl::new(PgUserApiKeysRepo::new(
        pool.clone(),
    )));
    let key = keys
        .create_key(&account.user_id, "Brain")
        .await
        .unwrap()
        .key;
    let lookup = PgUserApiKeysRepo::new(pool.clone());
    assert!(
        lookup
            .find_user_id_by_key(&UserApiKey::from_raw(key.clone()))
            .await
            .unwrap()
            .is_some()
    );

    UserApiKeys::new(keys)
        .revoke_all(&account.user_id)
        .await
        .unwrap();
    repo.remove_seat(&account.user_id).await.unwrap();

    assert_eq!(
        lookup
            .find_user_id_by_key(&UserApiKey::from_raw(key))
            .await
            .unwrap(),
        None
    );
    assert_eq!(repo.get(&account.user_id).await.unwrap(), None);
    assert_eq!(repo.account_facts(&account.user_id).await.unwrap(), None);
    let surviving: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT (SELECT count(*) FROM "User" WHERE id = $1),
               (SELECT count(*) FROM "Document" WHERE id = '0193a1b2-0000-7000-8000-0000000000d0' AND owner = $1),
               (SELECT count(*) FROM entity_access WHERE entity_id = '0193a1b2-0000-7000-8000-0000000000d0' AND source_type = 'team')
        "#,
    )
    .bind(agent)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(surviving, (1, 1, 1));
}
