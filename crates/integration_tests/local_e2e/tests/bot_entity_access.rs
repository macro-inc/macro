use anyhow::{Context, ensure};
use local_e2e_test_support::{LocalE2eConfig, LocalE2eServices};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

const DEFAULT_LOCAL_DATABASE_URL: &str = "postgres://user:password@localhost:5432/macrodb";
const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
const BOT_SCOPE_HEADER: &str = "x-macro-bot-scope";
const BOT_FOR_MACRO_USER_ID_HEADER: &str = "x-macro-bot-for-macro-user-id";
const BOT_FOR_FUSIONAUTH_USER_ID_HEADER: &str = "x-macro-bot-for-fusionauth-user-id";

#[tokio::test]
#[ignore = "requires `just local-e2e-rust` plus document_storage_service"]
async fn scoped_bot_resolves_document_access_through_dss() -> anyhow::Result<()> {
    let config = LocalE2eConfig::load()?;
    let services = LocalE2eServices::from_config(&config)?;
    let pool = connect_db(&config).await?;
    let fixture = ScopedBotFixture::seed(pool, services).await?;

    let verification_result = verify_scoped_access(&fixture).await;
    let cleanup_result = fixture.cleanup().await;

    combine_verification_and_cleanup(verification_result, cleanup_result)
}

struct ScopedBotFixture {
    pool: PgPool,
    services: LocalE2eServices,
    http: Client,
    macro_user_uuid: Uuid,
    acting_user_id: String,
    fusion_user_id: String,
    team_id: Uuid,
    bot_id: Uuid,
    bot_token: String,
    bot_private_channel_id: Uuid,
    user_private_channel_id: Uuid,
    public_channel_id: Uuid,
    team_document_id: Uuid,
    bot_channel_document_id: Uuid,
    user_channel_document_id: Uuid,
}

impl ScopedBotFixture {
    #[allow(
        clippy::disallowed_methods,
        reason = "local E2E fixture SQL is validated against the runtime stack"
    )]
    async fn seed(pool: PgPool, services: LocalE2eServices) -> anyhow::Result<Self> {
        let macro_user_uuid = Uuid::new_v4();
        let fusion_user_id = Uuid::new_v4().to_string();
        let email = format!("bot-entity-access-{macro_user_uuid}@macro.local");
        let acting_user_id = format!("macro|{email}");
        let team_id = Uuid::new_v4();
        let bot_id = Uuid::new_v4();
        let bot_token_id = Uuid::new_v4();
        let bot_token = format!("mbot_local_e2e_{}", Uuid::new_v4().simple());
        let bot_private_channel_id = Uuid::new_v4();
        let user_private_channel_id = Uuid::new_v4();
        let public_channel_id = Uuid::new_v4();
        let team_document_id = Uuid::new_v4();
        let bot_channel_document_id = Uuid::new_v4();
        let user_channel_document_id = Uuid::new_v4();
        let mut transaction = pool
            .begin()
            .await
            .context("failed to begin scoped bot fixture transaction")?;

        sqlx::query(
            r#"
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(macro_user_uuid)
        .bind(&email)
        .bind(&email)
        .bind(format!("local_e2e_{macro_user_uuid}"))
        .execute(&mut *transaction)
        .await
        .context("failed to insert scoped bot acting macro user")?;

        sqlx::query(
            r#"
            INSERT INTO "User" (id, email, macro_user_id)
            VALUES ($1, $2, $3)
            "#,
        )
        .bind(&fusion_user_id)
        .bind(&email)
        .bind(macro_user_uuid)
        .execute(&mut *transaction)
        .await
        .context("failed to insert scoped bot acting user")?;

        sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)")
            .bind(team_id)
            .bind(format!("Scoped bot E2E {team_id}"))
            .bind(&fusion_user_id)
            .execute(&mut *transaction)
            .await
            .context("failed to insert scoped bot team")?;

        sqlx::query(
            r#"
            INSERT INTO team_user (user_id, team_id, team_role)
            VALUES ($1, $2, 'owner'::team_role)
            "#,
        )
        .bind(&fusion_user_id)
        .bind(team_id)
        .execute(&mut *transaction)
        .await
        .context("failed to add acting user to scoped bot team")?;

        sqlx::query(
            r#"
            INSERT INTO bots (id, kind, team_id, name, handle, created_by)
            VALUES ($1, 'owned', $2, $3, $4, $5)
            "#,
        )
        .bind(bot_id)
        .bind(team_id)
        .bind(format!("Scoped bot E2E {bot_id}"))
        .bind(format!("scoped-bot-{bot_id}"))
        .bind(&acting_user_id)
        .execute(&mut *transaction)
        .await
        .context("failed to insert scoped bot")?;

        sqlx::query(
            r#"
            INSERT INTO bot_tokens (id, bot_id, token, label)
            VALUES ($1, $2, $3, 'local E2E scoped access')
            "#,
        )
        .bind(bot_token_id)
        .bind(bot_id)
        .bind(&bot_token)
        .execute(&mut *transaction)
        .await
        .context("failed to insert scoped bot token")?;

        for (channel_id, channel_name, channel_type) in [
            (
                bot_private_channel_id,
                "Scoped bot private channel",
                "private",
            ),
            (
                user_private_channel_id,
                "Scoped acting-user private channel",
                "private",
            ),
            (public_channel_id, "Scoped bot public channel", "public"),
        ] {
            sqlx::query(
                r#"
                INSERT INTO comms_channels (id, name, channel_type, owner_id)
                VALUES ($1, $2, $3::comms_channel_type, $4)
                "#,
            )
            .bind(channel_id)
            .bind(format!("{channel_name} {channel_id}"))
            .bind(channel_type)
            .bind(&acting_user_id)
            .execute(&mut *transaction)
            .await
            .with_context(|| format!("failed to insert {channel_type} channel {channel_id}"))?;
        }

        sqlx::query(
            r#"
            INSERT INTO comms_channel_participants (channel_id, role, user_id)
            VALUES ($1, 'member'::comms_participant_role, $2)
            "#,
        )
        .bind(bot_private_channel_id)
        .bind(format!("bot|{bot_id}"))
        .execute(&mut *transaction)
        .await
        .context("failed to add bot to private channel")?;

        sqlx::query(
            r#"
            INSERT INTO comms_channel_participants (channel_id, role, user_id)
            VALUES ($1, 'member'::comms_participant_role, $2)
            "#,
        )
        .bind(user_private_channel_id)
        .bind(&acting_user_id)
        .execute(&mut *transaction)
        .await
        .context("failed to add acting user to private channel")?;

        let grants = [
            (team_document_id, team_id.to_string(), "team"),
            (
                bot_channel_document_id,
                bot_private_channel_id.to_string(),
                "channel",
            ),
            (
                user_channel_document_id,
                user_private_channel_id.to_string(),
                "channel",
            ),
        ];
        for (document_id, source_id, source_type) in grants {
            sqlx::query(
                r#"
                INSERT INTO entity_access (
                    entity_id,
                    entity_type,
                    source_id,
                    source_type,
                    access_level
                )
                VALUES (
                    $1,
                    'document',
                    $2,
                    $3::entity_access_source_type,
                    'view'::"AccessLevel"
                )
                "#,
            )
            .bind(document_id)
            .bind(source_id)
            .bind(source_type)
            .execute(&mut *transaction)
            .await
            .with_context(|| format!("failed to grant access to document {document_id}"))?;
        }

        transaction
            .commit()
            .await
            .context("failed to commit scoped bot fixture")?;

        Ok(Self {
            pool,
            services,
            http: Client::new(),
            macro_user_uuid,
            acting_user_id,
            fusion_user_id,
            team_id,
            bot_id,
            bot_token,
            bot_private_channel_id,
            user_private_channel_id,
            public_channel_id,
            team_document_id,
            bot_channel_document_id,
            user_channel_document_id,
        })
    }

    async fn permission(
        &self,
        entity_type: &str,
        entity_id: Uuid,
        scope: &str,
        include_acting_user: bool,
    ) -> anyhow::Result<PermissionResponse> {
        let url = format!(
            "{}/entity/{entity_type}/{entity_id}/permissions",
            self.services.document_storage_url()
        );
        let mut request = self
            .http
            .get(&url)
            .header(BOT_TOKEN_HEADER, &self.bot_token)
            .header(BOT_SCOPE_HEADER, scope);
        if include_acting_user {
            request = request
                .header(BOT_FOR_MACRO_USER_ID_HEADER, &self.acting_user_id)
                .header(BOT_FOR_FUSIONAUTH_USER_ID_HEADER, &self.fusion_user_id);
        }

        let response = request
            .send()
            .await
            .with_context(|| format!("failed to request entity permission from {url}"))?;
        let status = response.status();
        let body_text = response
            .text()
            .await
            .with_context(|| format!("failed to read entity permission response from {url}"))?;
        let body = serde_json::from_str(&body_text).with_context(|| {
            format!("failed to decode entity permission response from {url}: {body_text}")
        })?;

        Ok(PermissionResponse { status, body })
    }

    #[allow(
        clippy::disallowed_methods,
        reason = "local E2E cleanup SQL is validated against the runtime stack"
    )]
    async fn cleanup(&self) -> anyhow::Result<()> {
        let document_ids = [
            self.team_document_id,
            self.bot_channel_document_id,
            self.user_channel_document_id,
        ];
        let channel_ids = [
            self.bot_private_channel_id,
            self.user_private_channel_id,
            self.public_channel_id,
        ];
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("failed to begin scoped bot cleanup transaction")?;

        sqlx::query("DELETE FROM entity_access WHERE entity_id = ANY($1)")
            .bind(&document_ids[..])
            .execute(&mut *transaction)
            .await
            .context("failed to delete scoped bot entity access")?;
        sqlx::query("DELETE FROM comms_channels WHERE id = ANY($1)")
            .bind(&channel_ids[..])
            .execute(&mut *transaction)
            .await
            .context("failed to delete scoped bot channels")?;
        sqlx::query("DELETE FROM bots WHERE id = $1")
            .bind(self.bot_id)
            .execute(&mut *transaction)
            .await
            .context("failed to delete scoped bot")?;
        sqlx::query("DELETE FROM team WHERE id = $1")
            .bind(self.team_id)
            .execute(&mut *transaction)
            .await
            .context("failed to delete scoped bot team")?;
        sqlx::query("DELETE FROM \"User\" WHERE id = $1")
            .bind(&self.fusion_user_id)
            .execute(&mut *transaction)
            .await
            .context("failed to delete scoped bot acting user")?;
        sqlx::query("DELETE FROM macro_user WHERE id = $1")
            .bind(self.macro_user_uuid)
            .execute(&mut *transaction)
            .await
            .context("failed to delete scoped bot acting macro user")?;

        transaction
            .commit()
            .await
            .context("failed to commit scoped bot cleanup")
    }
}

struct PermissionResponse {
    status: StatusCode,
    body: Value,
}

async fn verify_scoped_access(fixture: &ScopedBotFixture) -> anyhow::Result<()> {
    assert_access(
        fixture
            .permission("document", fixture.team_document_id, "team", false)
            .await?,
        "team-shared document under team scope",
    )?;
    assert_access(
        fixture
            .permission("document", fixture.bot_channel_document_id, "team", false)
            .await?,
        "bot private-channel document under team scope",
    )?;
    assert_no_access(
        fixture
            .permission("document", fixture.user_channel_document_id, "team", false)
            .await?,
        "acting-user private-channel document under team scope",
    )?;
    assert_access(
        fixture
            .permission("document", fixture.user_channel_document_id, "user", true)
            .await?,
        "acting-user private-channel document under user scope",
    )?;
    assert_user_scope_requires_acting_user(
        fixture
            .permission("document", fixture.user_channel_document_id, "user", false)
            .await?,
    )?;
    assert_no_access(
        fixture
            .permission("channel", fixture.public_channel_id, "team", false)
            .await?,
        "public channel under team scope",
    )?;

    Ok(())
}

fn assert_access(response: PermissionResponse, context: &str) -> anyhow::Result<()> {
    let expected = json!({
        "status": "access",
        "permission": {
            "type": "access_level",
            "access_level": "view",
        },
    });
    ensure!(
        response.status == StatusCode::OK && response.body == expected,
        "expected access for {context}, got {}: {}",
        response.status,
        response.body
    );
    Ok(())
}

fn assert_no_access(response: PermissionResponse, context: &str) -> anyhow::Result<()> {
    ensure!(
        response.status == StatusCode::OK && response.body == json!({ "status": "no_access" }),
        "expected no access for {context}, got {}: {}",
        response.status,
        response.body
    );
    Ok(())
}

fn assert_user_scope_requires_acting_user(response: PermissionResponse) -> anyhow::Result<()> {
    ensure!(
        response.status == StatusCode::UNAUTHORIZED,
        "expected user scope without acting-user headers to return 401, got {}: {}",
        response.status,
        response.body
    );
    ensure!(
        response.body == json!({ "message": "bot user scope requires an acting user" }),
        "unexpected missing acting-user response: {}",
        response.body
    );
    Ok(())
}

fn combine_verification_and_cleanup(
    verification_result: anyhow::Result<()>,
    cleanup_result: anyhow::Result<()>,
) -> anyhow::Result<()> {
    match (verification_result, cleanup_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(verification_error), Err(cleanup_error)) => anyhow::bail!(
            "scoped bot verification failed: {verification_error:#}; cleanup also failed: {cleanup_error:#}"
        ),
    }
}

async fn connect_db(config: &LocalE2eConfig) -> anyhow::Result<PgPool> {
    let database_url = config
        .get("LOCAL_E2E_DATABASE_URL")
        .unwrap_or(DEFAULT_LOCAL_DATABASE_URL)
        .replace("@postgres:", "@localhost:");
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .context("failed to connect to MacroDB for scoped bot E2E setup")
}
