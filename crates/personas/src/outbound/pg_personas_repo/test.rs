use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::models::MAX_PERSONA_SYSTEM_PROMPT_CHARS;
use crate::domain::ports::{PersonaRepo as _, PersonaService};
use crate::domain::service::PersonaServiceImpl;

const OWNER: &str = "macro|persona-owner@example.com";
const STRANGER: &str = "macro|persona-stranger@example.com";

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn service(pool: &PgPool) -> PersonaServiceImpl<PgPersonasRepo> {
    PersonaServiceImpl::new(PgPersonasRepo::new(pool.clone()))
}

fn create_req(handle: &str) -> CreatePersonaRequest {
    CreatePersonaRequest {
        name: "Bug Fixer".to_string(),
        handle: handle.to_string(),
        description: Some("Fixes failing tests".to_string()),
        avatar_url: None,
        system_prompt: Some("Always run the tests before reporting.".to_string()),
    }
}

/// Idempotent: fixtures may name the same user more than once, so this
/// upserts on the unique username rather than minting a fresh id each call.
async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    let macro_user_id: Uuid = sqlx::query_scalar!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        "#,
        Uuid::new_v4(),
        email,
        email,
        format!("stripe_{email}"),
    )
    .fetch_one(pool)
    .await?;

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
    .await?;
    Ok(())
}

async fn seed_users(pool: &PgPool) -> anyhow::Result<()> {
    insert_user(pool, OWNER).await?;
    insert_user(pool, STRANGER).await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_and_get_round_trip(pool: PgPool) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let service = service(&pool);

    let persona = service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await?;

    assert_eq!(persona.owner_user_id, OWNER);
    assert_eq!(persona.handle, "bug-fixer");
    assert_eq!(
        persona.system_prompt.as_deref(),
        Some("Always run the tests before reporting.")
    );

    let fetched = service.get_persona(user_id(OWNER), persona.id).await?;
    assert_eq!(fetched, persona);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_handle_is_rejected_per_owner_but_free_across_owners(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let service = service(&pool);

    service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await?;

    let err = service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::HandleTaken));

    // Personas are private, so another owner reusing the handle is fine.
    service
        .create_persona(user_id(STRANGER), create_req("bug-fixer"))
        .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_returns_only_the_callers_personas(pool: PgPool) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let service = service(&pool);

    service
        .create_persona(user_id(OWNER), create_req("first"))
        .await?;
    service
        .create_persona(user_id(OWNER), create_req("second"))
        .await?;
    service
        .create_persona(user_id(STRANGER), create_req("other"))
        .await?;

    let personas = service.list_personas(user_id(OWNER)).await?;
    let handles: Vec<_> = personas.iter().map(|p| p.handle.as_str()).collect();
    assert_eq!(handles.len(), 2);
    assert!(handles.contains(&"first") && handles.contains(&"second"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_distinguishes_absent_null_and_value(pool: PgPool) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let service = service(&pool);
    let persona = service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await?;

    let patched = service
        .patch_persona(
            user_id(OWNER),
            persona.id,
            PatchPersonaRequest {
                name: Some("Test Runner".to_string()),
                description: Some(None),
                system_prompt: Some(Some("Be terse.".to_string())),
                ..Default::default()
            },
        )
        .await?;

    assert_eq!(patched.name, "Test Runner");
    // Absent field: unchanged.
    assert_eq!(patched.handle, "bug-fixer");
    // Null: cleared.
    assert_eq!(patched.description, None);
    // Value: replaced.
    assert_eq!(patched.system_prompt.as_deref(), Some("Be terse."));
    assert!(patched.updated_at > persona.updated_at);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_soft_deletes_and_frees_the_handle(pool: PgPool) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let service = service(&pool);
    let persona = service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await?;

    service.delete_persona(user_id(OWNER), persona.id).await?;

    let err = service
        .get_persona(user_id(OWNER), persona.id)
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::NotFound));

    // The row survives for session-history identity...
    let deleted_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar!(
        r#"SELECT deleted_at FROM personas WHERE id = $1"#,
        persona.id.as_uuid(),
    )
    .fetch_one(&pool)
    .await?;
    assert!(deleted_at.is_some());

    // ...and the handle is reusable.
    service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repo_get_persona_ignores_ownership(pool: PgPool) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let repo = PgPersonasRepo::new(pool.clone());
    let service = service(&pool);
    let persona = service
        .create_persona(user_id(OWNER), create_req("bug-fixer"))
        .await?;

    // The repo-level lookup is the dispatch path: it answers regardless of
    // who asks, so mention routing can resolve any persona id.
    let found = repo.get_persona(persona.id).await?;
    assert_eq!(found, Some(persona));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn oversized_prompt_never_reaches_the_database(pool: PgPool) -> anyhow::Result<()> {
    seed_users(&pool).await?;
    let service = service(&pool);
    let mut req = create_req("bug-fixer");
    req.system_prompt = Some("x".repeat(MAX_PERSONA_SYSTEM_PROMPT_CHARS + 1));

    let err = service
        .create_persona(user_id(OWNER), req)
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::BadRequest(_)));
    Ok(())
}
