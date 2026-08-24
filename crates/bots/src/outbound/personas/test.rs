use bot_id::{MACRO_CODER_BOT_ID, MACRO_CODER_HANDLE};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AgentConfig, AgentModel, BotOwner, CreatePersonaRequest, Harness, PatchPersonaRequest,
};
use crate::domain::ports::{BotError, BotService};
use crate::domain::service::BotServiceImpl;
use crate::outbound::pg_bots_repo::PgBotsRepo;

const TEAM_ADMIN: &str = "macro|persona-admin@example.com";
const TEAM_MEMBER: &str = "macro|persona-member@example.com";
const OUTSIDER: &str = "macro|persona-outsider@example.com";

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn service(pool: &PgPool) -> BotServiceImpl<PgBotsRepo, NoopMacroEventBroker> {
    BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker)
}

fn create_req(team_id: Uuid, handle: &str) -> CreatePersonaRequest {
    CreatePersonaRequest {
        team_id,
        name: "Bug Fixer".to_string(),
        handle: handle.to_string(),
        description: Some("Fixes failing tests".to_string()),
        avatar_url: None,
        agent: AgentConfig {
            harness: Harness::OpenCode,
            model: AgentModel::Claude,
            system_prompt: Some("Always run the tests before reporting.".to_string()),
            repo_url: None,
        },
    }
}

/// Idempotent: the fixtures below name the same user more than once, so this
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

async fn seed_team(pool: &PgPool, team_id: Uuid, owner: &str) -> anyhow::Result<()> {
    insert_user(pool, owner).await?;
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ($1, 'Platform', $2)
        ON CONFLICT (id) DO NOTHING
        "#,
        team_id,
        owner,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn add_member(pool: &PgPool, team_id: Uuid, user: &str, role: &str) -> anyhow::Result<()> {
    insert_user(pool, user).await?;
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, $3::text::team_role)
        ON CONFLICT (user_id, team_id) DO NOTHING
        "#,
        user,
        team_id,
        role,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn team_with_admin(pool: &PgPool) -> anyhow::Result<Uuid> {
    let team_id = Uuid::new_v4();
    seed_team(pool, team_id, TEAM_ADMIN).await?;
    add_member(pool, team_id, TEAM_ADMIN, "admin").await?;
    add_member(pool, team_id, TEAM_MEMBER, "member").await?;
    insert_user(pool, OUTSIDER).await?;
    Ok(team_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_persona_records_the_team_and_its_agent_config(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;

    let persona = service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, "bug-fixer"))
        .await?;

    assert_eq!(persona.bot.owner, Some(BotOwner::Team { team_id }));
    assert!(
        persona.bot.has_agent,
        "a persona is agent-backed by construction"
    );
    assert_eq!(persona.agent.harness, Harness::OpenCode);
    assert_eq!(
        persona.agent.system_prompt.as_deref(),
        Some("Always run the tests before reporting.")
    );
    assert_eq!(
        persona.agent.repo_url, None,
        "a blank repository stays blank rather than picking up a default"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_team_admins_manage_personas(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;

    for caller in [TEAM_MEMBER, OUTSIDER] {
        let err = service
            .create_persona(user_id(caller), create_req(team_id, "denied"))
            .await
            .expect_err("only admins create personas");
        assert!(matches!(err, BotError::Unauthorized), "caller {caller}");
    }

    let persona = service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, "bug-fixer"))
        .await?;

    // Membership is enough to mention a persona, but not to edit one.
    let err = service
        .get_persona(user_id(TEAM_MEMBER), persona.bot.id)
        .await
        .expect_err("an ordinary member must not read the editor view");
    assert!(matches!(err, BotError::Unauthorized));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_persona_replaces_the_agent_config(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;
    let persona = service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, "bug-fixer"))
        .await?;

    let patched = service
        .patch_persona(
            user_id(TEAM_ADMIN),
            persona.bot.id,
            PatchPersonaRequest {
                name: Some("Triager".to_string()),
                agent: Some(AgentConfig {
                    harness: Harness::OpenCode,
                    model: AgentModel::Claude,
                    system_prompt: None,
                    repo_url: Some("https://github.com/macro-inc/macro".to_string()),
                }),
                ..Default::default()
            },
        )
        .await?;

    assert_eq!(patched.bot.name, "Triager");
    assert_eq!(
        patched.bot.handle, "bug-fixer",
        "an absent field is left be"
    );
    assert_eq!(
        patched.agent.system_prompt, None,
        "a supplied agent config replaces the old one wholesale"
    );
    assert_eq!(
        patched.agent.repo_url.as_deref(),
        Some("https://github.com/macro-inc/macro")
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_persona_handle_may_not_shadow_a_built_in_agent(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;

    let err = service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, MACRO_CODER_HANDLE))
        .await
        .expect_err("@coder is reserved");
    assert!(matches!(err, BotError::BadRequest(_)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_repo_url_that_could_break_out_of_git_clone_is_rejected(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;

    for repo_url in [
        "http://github.com/macro-inc/macro",
        "https://github.com/macro-inc/macro; rm -rf /",
        "https://github.com/macro-inc/macro $(whoami)",
    ] {
        let mut req = create_req(team_id, "bug-fixer");
        req.agent.repo_url = Some(repo_url.to_string());
        let err = service
            .create_persona(user_id(TEAM_ADMIN), req)
            .await
            .expect_err("unsafe repository URLs are rejected before they are stored");
        assert!(matches!(err, BotError::BadRequest(_)), "{repo_url}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mentionable_bots_span_built_ins_and_the_callers_teams(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;
    service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, "bug-fixer"))
        .await?;

    let mentionable = service.list_mentionable_bots(user_id(TEAM_MEMBER)).await?;
    let handles: Vec<&str> = mentionable.iter().map(|bot| bot.handle.as_str()).collect();
    assert!(
        handles.contains(&"bug-fixer"),
        "a member can mention their team's persona: {handles:?}"
    );
    assert!(
        mentionable.iter().any(|bot| bot.id == MACRO_CODER_BOT_ID),
        "the ownerless first-party agents stay mentionable: {handles:?}"
    );

    let outsider = service.list_mentionable_bots(user_id(OUTSIDER)).await?;
    assert!(
        !outsider.iter().any(|bot| bot.handle == "bug-fixer"),
        "another team's persona is not mentionable"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_persona_stops_being_mentionable(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;
    let persona = service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, "bug-fixer"))
        .await?;

    service
        .delete_persona(user_id(TEAM_ADMIN), persona.bot.id)
        .await?;

    let mentionable = service.list_mentionable_bots(user_id(TEAM_MEMBER)).await?;
    assert!(!mentionable.iter().any(|bot| bot.handle == "bug-fixer"));
    assert_eq!(
        service.agent_config(persona.bot.id).await?,
        None,
        "the harness must not launch a session for a deleted persona"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personas_do_not_issue_tokens(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = team_with_admin(&pool).await?;
    let persona = service
        .create_persona(user_id(TEAM_ADMIN), create_req(team_id, "bug-fixer"))
        .await?;

    let err = service
        .create_token(
            user_id(TEAM_ADMIN),
            persona.bot.id,
            crate::domain::models::CreateBotTokenRequest {
                label: None,
                expires_at: None,
            },
        )
        .await
        .expect_err("a persona has no inbound surface to authenticate");
    assert!(matches!(err, BotError::BadRequest(_)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_seeded_coder_bot_carries_its_deployed_config(pool: PgPool) -> anyhow::Result<()> {
    let config = service(&pool)
        .agent_config(MACRO_CODER_BOT_ID)
        .await?
        .expect("the migration seeds Macro Coder's config");

    assert_eq!(config.harness, Harness::OpenCode);
    assert_eq!(config.model, AgentModel::Claude);
    assert_eq!(
        config.repo_url.as_deref(),
        Some("https://github.com/macro-inc/macro"),
        "seeding NULL would have silently dropped its checkout"
    );
    Ok(())
}
