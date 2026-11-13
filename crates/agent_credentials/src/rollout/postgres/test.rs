use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

/// The team owner, an agent they invited, and an agent invited by someone
/// whose account is deleted afterwards.
async fn insert_fixtures(pool: &PgPool) {
    sqlx::raw_sql(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
            ('01900000-0000-7000-8000-00000000000a', 'admin', 'admin@macro.com', 'cus_a'),
            ('01900000-0000-7000-8000-00000000000b', 'gone', 'gone@macro.com', 'cus_b'),
            ('01900000-0000-7000-8000-00000000000c', 'sam', 'sam@agents.macro.invalid', 'cus_c'),
            ('01900000-0000-7000-8000-00000000000d', 'kim', 'kim@agents.macro.invalid', 'cus_d');
        INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES
            ('macro|admin@macro.com', 'admin@macro.com', '01900000-0000-7000-8000-00000000000a', FALSE),
            ('macro|gone@macro.com', 'gone@macro.com', '01900000-0000-7000-8000-00000000000b', FALSE),
            ('macro|sam@agents.macro.invalid', 'sam@agents.macro.invalid', '01900000-0000-7000-8000-00000000000c', TRUE),
            ('macro|kim@agents.macro.invalid', 'kim@agents.macro.invalid', '01900000-0000-7000-8000-00000000000d', TRUE);
        INSERT INTO team (id, name, owner_id) VALUES
            ('01900000-0000-7000-8000-000000000001', 'Agents', 'macro|admin@macro.com');
        INSERT INTO team_agents (user_id, team_id, created_by, persona_seed) VALUES
            ('macro|sam@agents.macro.invalid', '01900000-0000-7000-8000-000000000001', 'macro|admin@macro.com', '{}'),
            ('macro|kim@agents.macro.invalid', '01900000-0000-7000-8000-000000000001', 'macro|gone@macro.com', '{}');
        DELETE FROM "User" WHERE id = 'macro|gone@macro.com';
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_follows_its_creator_then_its_team_owner(pool: PgPool) {
    insert_fixtures(&pool).await;
    let creators = PgAgentCreators::new(pool);

    let sam = MacroUserIdStr::parse_from_str("macro|sam@agents.macro.invalid").unwrap();
    let kim = MacroUserIdStr::parse_from_str("macro|kim@agents.macro.invalid").unwrap();
    let admin = MacroUserIdStr::parse_from_str("macro|admin@macro.com").unwrap();

    assert_eq!(
        creators.creator_of(&sam).await.unwrap(),
        Some(admin.clone().into_owned())
    );
    // The creator's account was deleted, clearing `created_by`: the team's
    // owner decides.
    assert_eq!(
        creators.creator_of(&kim).await.unwrap(),
        Some(admin.clone().into_owned())
    );
    // A person has no `team_agents` row.
    assert_eq!(creators.creator_of(&admin).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn with_its_creator_gone_the_team_owners_rollout_decides(pool: PgPool) {
    use feature_flags::outbound::fake::FakeFeatureFlags;
    use feature_flags::{FlagSnapshot, FlagValue};

    insert_fixtures(&pool).await;
    let creators = PgAgentCreators::new(pool);
    let kim = MacroUserIdStr::parse_from_str("macro|kim@agents.macro.invalid").unwrap();
    let admin = MacroUserIdStr::parse_from_str("macro|admin@macro.com")
        .unwrap()
        .into_owned();

    let mut on = FakeFeatureFlags::default();
    on.set(
        admin.clone(),
        Ok(FlagSnapshot::new([(
            crate::AGENT_TEAMMATES_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    assert!(crate::agent_teammates_enabled(&creators, Some(&on), &kim).await);

    let mut off = FakeFeatureFlags::default();
    off.set(
        admin,
        Ok(FlagSnapshot::new([(
            crate::AGENT_TEAMMATES_FLAG.to_owned(),
            FlagValue::Boolean(false),
        )])),
    );
    assert!(!crate::agent_teammates_enabled(&creators, Some(&off), &kim).await);
}
