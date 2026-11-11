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
