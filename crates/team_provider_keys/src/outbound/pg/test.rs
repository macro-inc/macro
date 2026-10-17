use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const MEMBER: &str = "macro|member@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";

fn encrypted() -> EncryptedProviderApiKey {
    EncryptedProviderApiKey {
        key_ciphertext: vec![1, 2, 3],
        encryption_version: 1,
        kms_key_id: "arn:aws:kms:us-east-1:123456789012:key/1".to_owned(),
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("valid user id")
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let email = user_id.trim_start_matches("macro|");
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES (gen_random_uuid(), $2, $2, $3)
            RETURNING id
        )
        INSERT INTO "User" ("id", "email", "macro_user_id")
        SELECT $1, $2, new_macro_user.id FROM new_macro_user
        "#,
        user_id,
        email,
        format!("stripe_{email}"),
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A team owned by `MEMBER`, who is also its only member.
async fn insert_team(pool: &PgPool) -> anyhow::Result<Uuid> {
    insert_user(pool, MEMBER).await?;
    insert_user(pool, OUTSIDER).await?;
    let team_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        MEMBER
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'owner')",
        MEMBER,
        team_id
    )
    .execute(pool)
    .await?;
    Ok(team_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_current_members_find_the_teams_key(pool: PgPool) -> anyhow::Result<()> {
    let team_id = insert_team(&pool).await?;
    let repo = PgProviderKeyRepo::new(pool.clone());
    repo.upsert(team_id, ModelProvider::Anthropic, &encrypted(), "sk-ant-")
        .await?;

    let found = repo
        .for_member(&user(MEMBER), ModelProvider::Anthropic)
        .await?
        .expect("a member finds the key");
    assert_eq!(found.team_id, team_id);
    assert_eq!(found.encrypted, encrypted());
    assert!(
        repo.for_member(&user(OUTSIDER), ModelProvider::Anthropic)
            .await?
            .is_none()
    );
    assert!(
        repo.for_member(&user(MEMBER), ModelProvider::OpenAi)
            .await?
            .is_none()
    );
    assert_eq!(
        repo.providers_for_member(&user(MEMBER)).await?,
        vec![ModelProvider::Anthropic]
    );

    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", MEMBER)
        .execute(&pool)
        .await?;
    assert!(
        repo.for_member(&user(MEMBER), ModelProvider::Anthropic)
            .await?
            .is_none(),
        "leaving the team ends access on the next lookup"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn registering_again_replaces_the_teams_key(pool: PgPool) -> anyhow::Result<()> {
    let team_id = insert_team(&pool).await?;
    let repo = PgProviderKeyRepo::new(pool);
    let first = repo
        .upsert(team_id, ModelProvider::OpenAi, &encrypted(), "sk-")
        .await?;
    let second = repo
        .upsert(team_id, ModelProvider::OpenAi, &encrypted(), "sk-")
        .await?;

    assert!(second.updated_at >= first.updated_at);
    assert_eq!(repo.list(team_id).await?, vec![second]);
    assert!(repo.delete(team_id, ModelProvider::OpenAi).await?);
    assert!(!repo.delete(team_id, ModelProvider::OpenAi).await?);
    assert!(repo.list(team_id).await?.is_empty());
    Ok(())
}

/// Postgres cannot read the ciphertext, so the stored prefix is how it
/// refuses a key filed under the wrong provider.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_table_refuses_a_prefix_that_is_not_the_providers(pool: PgPool) -> anyhow::Result<()> {
    let team_id = insert_team(&pool).await?;
    let repo = PgProviderKeyRepo::new(pool);
    for (provider, prefix) in [
        (ModelProvider::OpenAi, "sk-ant-"),
        (ModelProvider::OpenAi, "grok_"),
        (ModelProvider::Anthropic, "sk-"),
        (ModelProvider::Anthropic, "crsr_"),
    ] {
        assert!(
            repo.upsert(team_id, provider, &encrypted(), prefix)
                .await
                .is_err(),
            "{prefix:?} must be refused for {provider:?}"
        );
    }
    Ok(())
}
