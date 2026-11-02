use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const OWNER: &str = "macro|owner@example.com";

fn encrypted() -> EncryptedProviderApiKey {
    EncryptedProviderApiKey {
        key_ciphertext: vec![1, 2, 3],
        encryption_version: 1,
        kms_key_id: "arn:aws:kms:us-east-1:123456789012:key/1".to_owned(),
    }
}

/// A user-owned in-memory agent on `model`.
async fn insert_agent(pool: &PgPool, model: &str) -> anyhow::Result<Uuid> {
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES (gen_random_uuid(), 'owner@example.com', 'owner@example.com', 'stripe_owner')
            RETURNING id
        )
        INSERT INTO "User" ("id", "email", "macro_user_id")
        SELECT $1, 'owner@example.com', new_macro_user.id FROM new_macro_user
        "#,
        OWNER,
    )
    .execute(pool)
    .await?;
    let bot_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO bots (id, kind, name, handle, has_agent, owner_user_id) VALUES ($1, 'owned', 'Agent', 'agent', true, $2)",
        bot_id,
        OWNER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO agent_configs (bot_id, instructions, harness, default_model, channel_scope, is_coding)
        VALUES ($1, 'Be brief.', 'in-memory', $2, 'all', false)
        "#,
        bot_id,
        model,
    )
    .execute(pool)
    .await?;
    Ok(bot_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stored_key_carries_the_agent_as_configured_now(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = insert_agent(&pool, "anthropic/claude-sonnet-5-5").await?;
    let repo = PgAgentKeyRepo::new(pool.clone());
    let saved = repo
        .upsert(bot_id, ModelProvider::Anthropic, &encrypted(), "sk-ant-")
        .await?;
    assert_eq!(repo.status(bot_id).await?, Some(saved));

    let stored = repo.stored(bot_id).await?.expect("the agent has a key");
    assert_eq!(stored.provider, ModelProvider::Anthropic);
    assert_eq!(stored.encrypted, encrypted());
    assert_eq!(
        stored.agent.owner,
        AgentOwner::User(MacroUserIdStr::try_from(OWNER.to_owned())?)
    );
    assert_eq!(stored.agent.model, "anthropic/claude-sonnet-5-5");
    assert_eq!(stored.agent.harness, "in-memory");

    sqlx::query!("UPDATE bots SET deleted_at = NOW() WHERE id = $1", bot_id)
        .execute(&pool)
        .await?;
    assert!(
        repo.stored(bot_id).await?.is_none(),
        "a deleted agent's key is never used"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn registering_again_replaces_the_key(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = insert_agent(&pool, "openai/gpt-6-astra").await?;
    let repo = PgAgentKeyRepo::new(pool);
    repo.upsert(bot_id, ModelProvider::Anthropic, &encrypted(), "sk-ant-")
        .await?;
    let second = repo
        .upsert(bot_id, ModelProvider::OpenAi, &encrypted(), "sk-")
        .await?;

    assert_eq!(repo.status(bot_id).await?, Some(second));
    assert!(repo.delete(bot_id).await?);
    assert!(!repo.delete(bot_id).await?);
    assert!(repo.status(bot_id).await?.is_none());
    Ok(())
}

/// Postgres cannot read the ciphertext, so the stored prefix is how it
/// refuses a key filed under the wrong provider.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_table_refuses_a_prefix_that_is_not_the_providers(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = insert_agent(&pool, "openai/gpt-6-astra").await?;
    let repo = PgAgentKeyRepo::new(pool);
    for (provider, prefix) in [
        (ModelProvider::OpenAi, "sk-ant-"),
        (ModelProvider::OpenAi, "grok_"),
        (ModelProvider::Anthropic, "sk-"),
    ] {
        assert!(
            repo.upsert(bot_id, provider, &encrypted(), prefix)
                .await
                .is_err(),
            "{prefix:?} must be refused for {provider:?}"
        );
    }
    Ok(())
}
