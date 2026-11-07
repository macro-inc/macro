use super::*;

/// Shared real-database fixture for transactional folder and discovery regressions.
pub(crate) async fn folder_fixture(pool: PgPool) -> (PgRepository, Actor, Record) {
    let team = TeamId(Uuid::now_v7());
    let account = Uuid::now_v7();
    let actor = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|folder@example.test")
            .expect("fixture")
            .into_owned(),
    };
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,'folder@example.test','folder@example.test',$2)",account,format!("fixture-{account}"))
        .execute(&pool).await.expect("account");
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES($1,'folder@example.test',$2)"#,
        actor.user_id.as_ref(),
        account
    )
    .execute(&pool)
    .await
    .expect("user");
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES($1,'Fixture',$2)",
        team.0,
        actor.user_id.as_ref()
    )
    .execute(&pool)
    .await
    .expect("team");
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES($1,$2,'owner')",
        actor.user_id.as_ref(),
        team.0
    )
    .execute(&pool)
    .await
    .expect("membership");
    let now = Utc::now();
    let record = Record {
        user_id: actor.user_id.clone(),
        grants: vec![],
        deleting: false,
        revision: 0,
        totp_key_id: None,
        metadata: ItemMetadata {
            id: ItemId(Uuid::now_v7()),
            team_id: team,
            name: "literal %_\\ Login".into(),
            kind: ItemKind::Login,
            url: None,
            folder_id: None,
            favorite: false,
            version: 1,
            has_totp: false,
            shared: false,
            share_count: 0,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        },
    };
    let repository = PgRepository::new(pool).expect("repository");
    repository.save(&record, None).await.expect("item");
    let record = repository
        .get(team, record.metadata.id)
        .await
        .expect("stored item");
    (repository, actor, record)
}

/// A distinct human owner keeps the canonical one-team-per-owner fixture valid.
pub(crate) async fn another_team(pool: &PgPool) -> (TeamId, Actor) {
    let team = TeamId(Uuid::now_v7());
    let account = Uuid::now_v7();
    let actor = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|other-folder@example.test")
            .expect("fixture")
            .into_owned(),
    };
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,'other-folder@example.test','other-folder@example.test',$2)",account,format!("fixture-{account}"))
        .execute(pool).await.expect("other account");
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES($1,'other-folder@example.test',$2)"#,
        actor.user_id.as_ref(),
        account
    )
    .execute(pool)
    .await
    .expect("other user");
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES($1,'Other',$2)",
        team.0,
        actor.user_id.as_ref()
    )
    .execute(pool)
    .await
    .expect("other team");
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES($1,$2,'owner')",
        actor.user_id.as_ref(),
        team.0
    )
    .execute(pool)
    .await
    .expect("other membership");
    (team, actor)
}
