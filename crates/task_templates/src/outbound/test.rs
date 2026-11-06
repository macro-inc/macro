use super::*;
use crate::domain::Repository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_template_persists_and_cascades(pool: PgPool) {
    sqlx::query!(
        r#"WITH account AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ($1, 'template-test', 'template-test', 'template-test') RETURNING id
        )
        INSERT INTO "User" (id, email, macro_user_id)
        SELECT 'macro|template-test', 'template-test', id FROM account"#,
        Uuid::now_v7()
    )
    .execute(&pool)
    .await
    .unwrap();
    let repository = PgTaskTemplates(pool.clone());
    let template = TaskTemplate {
        id: Uuid::now_v7(),
        user_id: Some("macro|template-test".into()),
        team_id: None,
        creator_id: Some("macro|template-test".into()),
        name: "Example".into(),
        configuration: TaskTemplateConfiguration {
            property_ids: vec![],
            defaults: vec![],
            description_markdown: "private".into(),
        },
        revision: 1,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        can_manage: true,
    };
    assert!(repository.create(&template).await.unwrap());
    assert_eq!(
        repository
            .list("macro|template-test", None)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(!repository.update(&template, 2).await.unwrap());
    sqlx::query!(r#"DELETE FROM "User" WHERE id = 'macro|template-test'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert!(repository.get(template.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_template_survives_creator_deletion_and_cascades_with_team(pool: PgPool) {
    for (id, email) in [
        ("macro|creator", "creator-test"),
        ("macro|owner", "owner-test"),
    ] {
        sqlx::query!(
            r#"WITH account AS (
                INSERT INTO macro_user (id, username, email, stripe_customer_id)
                VALUES ($1, $2, $3, $2) RETURNING id
            )
            INSERT INTO "User" (id, email, macro_user_id)
            SELECT $2, $3, id FROM account"#,
            Uuid::now_v7(),
            id,
            email
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'test', 'macro|owner')",
        team
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|creator', $1, 'member')", team)
        .execute(&pool).await.unwrap();
    let repository = PgTaskTemplates(pool.clone());
    let template = TaskTemplate {
        id: Uuid::now_v7(),
        user_id: None,
        team_id: Some(team),
        creator_id: Some("macro|creator".into()),
        name: "Team".into(),
        configuration: TaskTemplateConfiguration {
            property_ids: vec![],
            defaults: vec![],
            description_markdown: "team".into(),
        },
        revision: 1,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        can_manage: true,
    };
    assert!(repository.create(&template).await.unwrap());
    assert!(!repository.update(&template, 2).await.unwrap());
    sqlx::query!(r#"DELETE FROM "User" WHERE id = 'macro|creator'"#)
        .execute(&pool)
        .await
        .unwrap();
    let remaining = repository.get(template.id).await.unwrap().unwrap();
    assert_eq!(remaining.team_id, Some(team));
    assert!(remaining.creator_id.is_none());
    sqlx::query!("DELETE FROM team WHERE id = $1", team)
        .execute(&pool)
        .await
        .unwrap();
    assert!(repository.get(template.id).await.unwrap().is_none());
}
