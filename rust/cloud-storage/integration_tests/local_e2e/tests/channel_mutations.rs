use std::time::Duration;

use anyhow::{Context, ensure};
use futures::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use local_e2e_test_support::{
    LocalE2eConfig, LocalE2eSeed, LocalE2eServices, LocalJwtOptions, SeedUser,
    encode_local_jwt_with,
};
use reqwest::{Client, Method, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tokio::net::TcpStream;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::tungstenite::{Error as WebsocketError, Message as WebsocketMessage};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use uuid::Uuid;

const WEBSOCKET_TIMEOUT: Duration = Duration::from_secs(10);
const NOTIFICATION_TIMEOUT: Duration = Duration::from_secs(30);
const CONTACTS_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_LOCAL_DATABASE_URL: &str = "postgres://user:password@localhost:5432/macrodb";

#[derive(Clone, Debug)]
struct ChannelApiClient {
    label: String,
    mutation_base_url: String,
    read_base_url: String,
}

impl ChannelApiClient {
    /// Channels API under test.
    /// Override mutations with `LOCAL_E2E_CHANNELS_BASE_URL=http://.../channels`.
    /// Override the read-model API with `LOCAL_E2E_CHANNELS_READ_BASE_URL=http://.../channels`.
    fn from_config(config: &LocalE2eConfig, services: &LocalE2eServices) -> Self {
        let mutation_base_url = config
            .get("LOCAL_E2E_CHANNELS_BASE_URL")
            .or_else(|| config.get("LOCAL_E2E_NEW_CHANNELS_BASE_URL"))
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}/channels", services.document_storage_url()));
        let read_base_url = config
            .get("LOCAL_E2E_CHANNELS_READ_BASE_URL")
            .or_else(|| config.get("LOCAL_E2E_NEW_CHANNELS_READ_BASE_URL"))
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}/channels", services.document_storage_url()));
        Self {
            label: "channels".to_string(),
            mutation_base_url: trim_trailing_slash(&mutation_base_url),
            read_base_url: trim_trailing_slash(&read_base_url),
        }
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn create_channel_url(&self) -> String {
        self.mutation_base_url.clone()
    }

    fn get_or_create_dm_url(&self) -> String {
        format!("{}/get_or_create_dm", self.mutation_base_url)
    }

    fn get_or_create_private_url(&self) -> String {
        format!("{}/get_or_create_private", self.mutation_base_url)
    }

    fn channel_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}", self.mutation_base_url)
    }

    fn read_channel_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}", self.read_base_url)
    }

    fn channel_message_url(&self, channel_id: &str, message_id: &str) -> String {
        format!(
            "{}/{channel_id}/message/{message_id}",
            self.mutation_base_url
        )
    }

    fn post_channel_message_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}/message", self.mutation_base_url)
    }

    fn post_channel_reaction_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}/reaction", self.mutation_base_url)
    }

    fn post_channel_typing_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}/typing", self.mutation_base_url)
    }

    fn channel_participants_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}/participants", self.mutation_base_url)
    }

    fn join_channel_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}/join", self.mutation_base_url)
    }

    fn leave_channel_url(&self, channel_id: &str) -> String {
        format!("{}/{channel_id}/leave", self.mutation_base_url)
    }
}

fn trim_trailing_slash(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

struct ChannelContractContext {
    world: TestWorld,
    api: ChannelApiClient,
    http: Client,
    pool: PgPool,
    users: ContractUsers,
}

struct ContractUsers {
    actor: SeedUser,
    actor_token: String,
    bob: SeedUser,
    bob_token: String,
    charlie: SeedUser,
    charlie_token: String,
    dana: SeedUser,
    dana_token: String,
    eve: SeedUser,
    eve_token: String,
}

impl ChannelContractContext {
    async fn load() -> anyhow::Result<Self> {
        let world = TestWorld::load()?;
        let api = ChannelApiClient::from_config(&world.config, &world.services);
        let http = Client::new();
        let pool = connect_db(&world.config).await?;
        let actor = world.seed.smoke_user()?.clone();
        let actor_token = world.token_for(&actor)?;
        let bob = world
            .seed
            .user_by_email("bob@example.com")
            .context("missing bob fixture")?
            .clone();
        let bob_token = world.token_for(&bob)?;
        let charlie = world
            .seed
            .user_by_email("charlie@example.com")
            .context("missing charlie fixture")?
            .clone();
        let charlie_token = world.token_for(&charlie)?;
        let dana = world
            .seed
            .user_by_email("dana@example.com")
            .context("missing dana fixture")?
            .clone();
        let dana_token = world.token_for(&dana)?;
        let eve = world
            .seed
            .user_by_email("eve@example.com")
            .context("missing eve fixture")?
            .clone();
        let eve_token = world.token_for(&eve)?;

        Ok(Self {
            world,
            api,
            http,
            pool,
            users: ContractUsers {
                actor,
                actor_token,
                bob,
                bob_token,
                charlie,
                charlie_token,
                dana,
                dana_token,
                eve,
                eve_token,
            },
        })
    }

    fn suffix(&self, prefix: &str) -> String {
        format!("{prefix}-{}-{}", self.api.label(), unique_suffix())
    }
}

type GatewaySocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type GatewayWrite = SplitSink<GatewaySocket, WebsocketMessage>;
type GatewayRead = SplitStream<GatewaySocket>;

struct GatewayEvent {
    label: &'static str,
    data: Value,
}

struct ContractGatewayListeners {
    actor_write: GatewayWrite,
    actor_read: GatewayRead,
    bob_write: GatewayWrite,
    bob_read: GatewayRead,
    charlie_write: GatewayWrite,
    charlie_read: GatewayRead,
}

impl ContractGatewayListeners {
    async fn connect(ctx: &ChannelContractContext) -> anyhow::Result<Self> {
        let actor_ws = ctx
            .world
            .services
            .connection_gateway_ws_url_with_token(&ctx.users.actor_token)?;
        let bob_ws = ctx
            .world
            .services
            .connection_gateway_ws_url_with_token(&ctx.users.bob_token)?;
        let charlie_ws = ctx
            .world
            .services
            .connection_gateway_ws_url_with_token(&ctx.users.charlie_token)?;
        let (actor_socket, _) = connect_async(&actor_ws)
            .await
            .context("connect actor websocket")?;
        let (bob_socket, _) = connect_async(&bob_ws)
            .await
            .context("connect bob websocket")?;
        let (charlie_socket, _) = connect_async(&charlie_ws)
            .await
            .context("connect charlie websocket")?;
        let (mut actor_write, mut actor_read) = actor_socket.split();
        let (mut bob_write, mut bob_read) = bob_socket.split();
        let (mut charlie_write, mut charlie_read) = charlie_socket.split();
        ping_and_wait(&mut actor_write, &mut actor_read).await?;
        ping_and_wait(&mut bob_write, &mut bob_read).await?;
        ping_and_wait(&mut charlie_write, &mut charlie_read).await?;

        Ok(Self {
            actor_write,
            actor_read,
            bob_write,
            bob_read,
            charlie_write,
            charlie_read,
        })
    }

    async fn wait_for_all<F>(
        &mut self,
        expected_type: &str,
        matches: F,
        detail: &str,
    ) -> anyhow::Result<Vec<GatewayEvent>>
    where
        F: Fn(&Value) -> bool,
    {
        let actor =
            wait_for_gateway_event(&mut self.actor_read, expected_type, |data| matches(data))
                .await
                .with_context(|| format!("actor did not receive {detail}"))?;
        let bob = wait_for_gateway_event(&mut self.bob_read, expected_type, |data| matches(data))
            .await
            .with_context(|| format!("bob did not receive {detail}"))?;
        let charlie =
            wait_for_gateway_event(&mut self.charlie_read, expected_type, |data| matches(data))
                .await
                .with_context(|| format!("charlie did not receive {detail}"))?;

        Ok(vec![
            GatewayEvent {
                label: "actor",
                data: actor,
            },
            GatewayEvent {
                label: "bob",
                data: bob,
            },
            GatewayEvent {
                label: "charlie",
                data: charlie,
            },
        ])
    }

    async fn close(mut self) {
        self.actor_write
            .send(WebsocketMessage::Close(None))
            .await
            .ok();
        self.bob_write
            .send(WebsocketMessage::Close(None))
            .await
            .ok();
        self.charlie_write
            .send(WebsocketMessage::Close(None))
            .await
            .ok();
    }
}

struct ContractChannel {
    id: String,
    name: String,
}

async fn create_private_contract_channel(
    ctx: &ChannelContractContext,
    prefix: &str,
) -> anyhow::Result<ContractChannel> {
    let name = ctx.suffix(prefix);
    let created = create_channel_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        name.clone(),
        "private",
        &[&ctx.users.bob.user_id, &ctx.users.charlie.user_id],
    )
    .await
    .with_context(|| format!("{} create private contract channel", ctx.api.label()))?;
    Ok(ContractChannel {
        id: created.id,
        name,
    })
}

async fn create_public_contract_channel(
    ctx: &ChannelContractContext,
    prefix: &str,
) -> anyhow::Result<ContractChannel> {
    let name = ctx.suffix(prefix);
    let created = create_channel_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        name.clone(),
        "public",
        &[&ctx.users.bob.user_id],
    )
    .await
    .with_context(|| format!("{} create public contract channel", ctx.api.label()))?;
    Ok(ContractChannel {
        id: created.id,
        name,
    })
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn get_or_create_dm_returns_existing_dm_and_rejects_self_dm() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_get_or_create_dm_access_control_contract(&ctx).await
}

async fn assert_get_or_create_dm_access_control_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let dm = get_or_create_dm_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &ctx.users.bob.user_id,
    )
    .await
    .with_context(|| format!("{} get existing DM", ctx.api.label()))?;
    ensure!(
        dm.action == "get",
        "{} expected existing seeded DM, got {dm:?}",
        ctx.api.label()
    );

    let invalid_dm = ctx
        .http
        .post(ctx.api.get_or_create_dm_url())
        .bearer_auth(&ctx.users.actor_token)
        .json(&json!({ "recipient_id": ctx.users.actor.user_id }))
        .send()
        .await
        .with_context(|| format!("{} failed to call invalid self-DM", ctx.api.label()))?;
    ensure!(
        invalid_dm.status() == reqwest::StatusCode::BAD_REQUEST,
        "{} self-DM should be rejected with 400, got {}: {}",
        ctx.api.label(),
        invalid_dm.status(),
        invalid_dm.text().await.unwrap_or_default()
    );

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn get_or_create_private_persists_expected_participants() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_get_or_create_private_access_control_contract(&ctx).await
}

async fn assert_get_or_create_private_access_control_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let private = get_or_create_private_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &[&ctx.users.bob.user_id, &ctx.users.eve.user_id],
    )
    .await
    .with_context(|| format!("{} get/create private channel", ctx.api.label()))?;
    ensure!(
        !private.channel_id.is_empty(),
        "{} private channel id was empty",
        ctx.api.label()
    );
    assert_db_participants_include(
        &ctx.pool,
        &private.channel_id,
        &[
            &ctx.users.actor.user_id,
            &ctx.users.bob.user_id,
            &ctx.users.eve.user_id,
        ],
    )
    .await?;

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn public_channel_allows_join_and_leave_for_non_participant() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_public_join_leave_access_control_contract(&ctx).await
}

async fn assert_public_join_leave_access_control_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let public = create_public_contract_channel(ctx, "access-public").await?;

    require_success(
        ctx.http
            .post(ctx.api.join_channel_url(&public.id))
            .bearer_auth(&ctx.users.eve_token)
            .send()
            .await
            .with_context(|| format!("{} failed to join public channel", ctx.api.label()))?,
        "join public channel as non-participant",
    )
    .await?;
    let joined = get_channel_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.eve_token,
        &public.id,
    )
    .await?;
    assert_participant(&joined, &ctx.users.eve.user_id)?;
    assert_db_participants_include(&ctx.pool, &public.id, &[&ctx.users.eve.user_id]).await?;

    require_success(
        ctx.http
            .post(ctx.api.leave_channel_url(&public.id))
            .bearer_auth(&ctx.users.eve_token)
            .send()
            .await
            .with_context(|| format!("{} failed to leave public channel", ctx.api.label()))?,
        "leave public channel",
    )
    .await?;
    assert_db_participants_absent(&ctx.pool, &public.id, &[&ctx.users.eve.user_id]).await?;
    delete_channel_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &public.id,
    )
    .await?;

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service and contacts_service workers"]
async fn create_private_channel_persists_channel_participants_and_contacts() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_private_channel_create_side_effect_contract(&ctx).await
}

async fn assert_private_channel_create_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let contacts_since = db_now(&ctx.pool).await?;
    let private = create_private_contract_channel(ctx, "membership-private").await?;

    assert_db_channel(&ctx.pool, &private.id, Some(&private.name), "private").await?;
    assert_db_participants_include(
        &ctx.pool,
        &private.id,
        &[
            &ctx.users.actor.user_id,
            &ctx.users.bob.user_id,
            &ctx.users.charlie.user_id,
        ],
    )
    .await?;
    wait_for_contacts_connections(
        &ctx.pool,
        &[
            (&ctx.users.actor.user_id, &ctx.users.bob.user_id),
            (&ctx.users.actor.user_id, &ctx.users.charlie.user_id),
            (&ctx.users.bob.user_id, &ctx.users.charlie.user_id),
        ],
        &contacts_since,
    )
    .await
    .with_context(|| format!("{} create private contacts", ctx.api.label()))?;

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service, contacts_service, and notification_service workers"]
async fn adding_and_removing_participant_updates_membership_notifications_and_contacts()
-> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_participant_invite_remove_side_effect_contract(&ctx).await
}

async fn assert_participant_invite_remove_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let private = create_private_contract_channel(ctx, "membership-invite").await?;
    let contacts_since = db_now(&ctx.pool).await?;

    add_participants_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &private.id,
        &[&ctx.users.dana.user_id],
    )
    .await
    .with_context(|| format!("{} add participant", ctx.api.label()))?;
    assert_db_participants_include(&ctx.pool, &private.id, &[&ctx.users.dana.user_id]).await?;

    let invite = wait_for_notification(
        &ctx.http,
        &ctx.world.services,
        &ctx.users.dana_token,
        |notification| notification_matches(notification, "channel_invite", &private.id),
    )
    .await
    .with_context(|| format!("{} invite notification", ctx.api.label()))?;
    assert_sender(&invite, &ctx.users.actor.user_id)?;
    wait_for_contacts_connections(
        &ctx.pool,
        &[
            (&ctx.users.actor.user_id, &ctx.users.dana.user_id),
            (&ctx.users.bob.user_id, &ctx.users.dana.user_id),
            (&ctx.users.charlie.user_id, &ctx.users.dana.user_id),
        ],
        &contacts_since,
    )
    .await
    .with_context(|| format!("{} invite contacts", ctx.api.label()))?;

    remove_participants_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &private.id,
        &[&ctx.users.dana.user_id],
    )
    .await
    .with_context(|| format!("{} remove participant", ctx.api.label()))?;
    assert_db_participants_absent(&ctx.pool, &private.id, &[&ctx.users.dana.user_id]).await?;

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service and contacts_service workers"]
async fn public_join_and_leave_updates_membership_and_contacts() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_public_join_leave_side_effect_contract(&ctx).await
}

async fn assert_public_join_leave_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let public = create_public_contract_channel(ctx, "membership-public").await?;
    assert_db_channel(&ctx.pool, &public.id, Some(&public.name), "public").await?;

    let contacts_since = db_now(&ctx.pool).await?;
    require_success(
        ctx.http
            .post(ctx.api.join_channel_url(&public.id))
            .bearer_auth(&ctx.users.charlie_token)
            .send()
            .await
            .context("failed to join public channel")?,
        "join public channel",
    )
    .await?;
    assert_db_participants_include(&ctx.pool, &public.id, &[&ctx.users.charlie.user_id]).await?;
    wait_for_contacts_connections(
        &ctx.pool,
        &[
            (&ctx.users.actor.user_id, &ctx.users.charlie.user_id),
            (&ctx.users.bob.user_id, &ctx.users.charlie.user_id),
        ],
        &contacts_since,
    )
    .await
    .with_context(|| format!("{} join contacts", ctx.api.label()))?;

    require_success(
        ctx.http
            .post(ctx.api.leave_channel_url(&public.id))
            .bearer_auth(&ctx.users.charlie_token)
            .send()
            .await
            .context("failed to leave public channel")?,
        "leave public channel",
    )
    .await?;
    assert_db_participants_absent(&ctx.pool, &public.id, &[&ctx.users.charlie.user_id]).await?;

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn delete_channel_removes_channel() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_channel_delete_side_effect_contract(&ctx).await
}

async fn assert_channel_delete_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let private = create_private_contract_channel(ctx, "membership-delete").await?;
    delete_channel_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &private.id,
    )
    .await?;
    assert_db_channel_absent(&ctx.pool, &private.id).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn channel_rename_persists_name() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_channel_rename_side_effect_contract(&ctx).await
}

async fn assert_channel_rename_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let channel = create_public_contract_channel(ctx, "rename-channel").await?;
    let renamed = ctx.suffix("renamed-channel");
    patch_channel_name_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &renamed,
    )
    .await?;
    assert_db_channel(&ctx.pool, &channel.id, Some(&renamed), "public").await?;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway, document_storage_service, and notification_service workers"]
async fn message_with_document_attachment_updates_channel_share_permissions_and_side_effects()
-> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_document_attachment_share_permission_side_effect_contract(&ctx).await
}

async fn assert_document_attachment_share_permission_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let document = ctx.world.seed.project_roadmap_document()?;
    let channel = create_private_contract_channel(ctx, "message-first").await?;
    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let suffix = ctx.suffix("first-message");
    let content = format!("root {suffix}");
    let nonce = format!("root-nonce-{suffix}");

    let root = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &content,
            mentions: Vec::new(),
            thread_id: None,
            attachments: vec![json!({
                "entity_type": "document",
                "entity_id": document.document_id,
                "width": 320,
                "height": 240,
            })],
            nonce: &nonce,
        },
    )
    .await
    .with_context(|| format!("{} post root message", ctx.api.label()))?;
    assert_db_message(
        &ctx.pool,
        &root.id,
        &channel.id,
        &ctx.users.actor.user_id,
        &content,
        None,
    )
    .await?;
    assert_db_attachment_count(&ctx.pool, &root.id, 1).await?;
    assert_db_document_channel_share_permission(&ctx.pool, &document.document_id, &channel.id)
        .await?;

    for event in listeners
        .wait_for_all(
            "comms_message",
            |data| {
                data.get("id").and_then(Value::as_str) == Some(root.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "root realtime message",
        )
        .await?
    {
        ensure!(
            event.data.get("content").and_then(Value::as_str) == Some(content.as_str()),
            "{} {} root content mismatch: {}",
            ctx.api.label(),
            event.label,
            event.data
        );
    }

    listeners
        .wait_for_all(
            "comms_attachment",
            |data| {
                data.get("message_id").and_then(Value::as_str) == Some(root.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "root attachment realtime event",
        )
        .await?;

    let bob_invite = wait_for_notification(
        &ctx.http,
        &ctx.world.services,
        &ctx.users.bob_token,
        |notification| {
            notification_matches(notification, "channel_invite", &channel.id)
                && notification_content(notification, "messageContent") == Some(content.as_str())
        },
    )
    .await
    .with_context(|| format!("{} first message bob invite notification", ctx.api.label()))?;
    assert_sender(&bob_invite, &ctx.users.actor.user_id)?;

    let charlie_invite = wait_for_notification(
        &ctx.http,
        &ctx.world.services,
        &ctx.users.charlie_token,
        |notification| {
            notification_matches(notification, "channel_invite", &channel.id)
                && notification_content(notification, "messageContent") == Some(content.as_str())
        },
    )
    .await
    .with_context(|| {
        format!(
            "{} first message charlie invite notification",
            ctx.api.label()
        )
    })?;
    assert_sender(&charlie_invite, &ctx.users.actor.user_id)?;

    let actor_notifications =
        list_notifications(&ctx.http, &ctx.world.services, &ctx.users.actor_token).await?;
    ensure!(
        find_notification(&actor_notifications, |notification| {
            notification_matches(notification, "channel_invite", &channel.id)
        })
        .is_none(),
        "{} sender should not receive channel_invite for {}",
        ctx.api.label(),
        channel.id
    );

    listeners.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway, document_storage_service, and notification_service workers"]
async fn follow_up_message_persists_message_emits_realtime_and_sends_notifications()
-> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_follow_up_message_side_effect_contract(&ctx).await
}

async fn assert_follow_up_message_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let channel = create_private_contract_channel(ctx, "message-follow-up").await?;
    let suffix = ctx.suffix("follow-up-message");
    post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &format!("invite {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("invite-{suffix}"),
        },
    )
    .await?;

    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let content = format!("follow-up {suffix}");
    let nonce = format!("follow-up-{suffix}");
    let follow_up = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &content,
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &nonce,
        },
    )
    .await
    .with_context(|| format!("{} follow-up message", ctx.api.label()))?;
    assert_db_message(
        &ctx.pool,
        &follow_up.id,
        &channel.id,
        &ctx.users.actor.user_id,
        &content,
        None,
    )
    .await?;

    listeners
        .wait_for_all(
            "comms_message",
            |data| {
                data.get("id").and_then(Value::as_str) == Some(follow_up.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "follow-up realtime message",
        )
        .await?;

    wait_for_notification(
        &ctx.http,
        &ctx.world.services,
        &ctx.users.bob_token,
        |notification| {
            notification_matches(notification, "channel_message_send", &channel.id)
                && notification_content(notification, "messageId") == Some(follow_up.id.as_str())
                && notification_content(notification, "messageContent") == Some(content.as_str())
        },
    )
    .await
    .with_context(|| format!("{} follow-up bob notification", ctx.api.label()))?;
    wait_for_notification(
        &ctx.http,
        &ctx.world.services,
        &ctx.users.charlie_token,
        |notification| {
            notification_matches(notification, "channel_message_send", &channel.id)
                && notification_content(notification, "messageId") == Some(follow_up.id.as_str())
        },
    )
    .await
    .with_context(|| format!("{} follow-up charlie notification", ctx.api.label()))?;

    listeners.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn typing_emits_realtime() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_typing_side_effect_contract(&ctx).await
}

async fn assert_typing_side_effect_contract(ctx: &ChannelContractContext) -> anyhow::Result<()> {
    let channel = create_private_contract_channel(ctx, "message-typing").await?;
    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let nonce = ctx.suffix("typing");

    post_typing_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.bob_token,
        &channel.id,
        "start",
        None,
        &nonce,
    )
    .await
    .with_context(|| format!("{} typing", ctx.api.label()))?;

    for event in listeners
        .wait_for_all(
            "comms_typing",
            |data| {
                data.get("user_id").and_then(Value::as_str) == Some(ctx.users.bob.user_id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "typing realtime event",
        )
        .await?
    {
        ensure!(
            event.data.get("action").and_then(Value::as_str) == Some("start"),
            "{} {} typing action mismatch: {}",
            ctx.api.label(),
            event.label,
            event.data
        );
    }

    listeners.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn reaction_persists_reaction_and_emits_realtime() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_reaction_side_effect_contract(&ctx).await
}

async fn assert_reaction_side_effect_contract(ctx: &ChannelContractContext) -> anyhow::Result<()> {
    let channel = create_private_contract_channel(ctx, "message-reaction").await?;
    let suffix = ctx.suffix("reaction-message");
    let root = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &format!("reaction root {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("reaction-root-{suffix}"),
        },
    )
    .await?;

    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let nonce = format!("reaction-{suffix}");
    post_reaction_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.bob_token,
        &channel.id,
        &root.id,
        "👍",
        "Add",
        &nonce,
    )
    .await
    .with_context(|| format!("{} reaction", ctx.api.label()))?;
    assert_db_reaction(&ctx.pool, &root.id, "👍", &ctx.users.bob.user_id).await?;

    for event in listeners
        .wait_for_all(
            "comms_reaction",
            |data| {
                data.get("message_id").and_then(Value::as_str) == Some(root.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "reaction realtime event",
        )
        .await?
    {
        ensure!(
            reaction_payload_contains_user(&event.data, "👍", &ctx.users.bob.user_id),
            "{} {} reaction payload missing bob: {}",
            ctx.api.label(),
            event.label,
            event.data
        );
    }

    listeners.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway, document_storage_service, and notification_service workers"]
async fn thread_reply_persists_thread_id_emits_realtime_and_notifies_parent_author()
-> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_thread_reply_side_effect_contract(&ctx).await
}

async fn assert_thread_reply_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let channel = create_private_contract_channel(ctx, "message-reply").await?;
    let suffix = ctx.suffix("reply-message");
    let root = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &format!("reply root {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("reply-root-{suffix}"),
        },
    )
    .await?;

    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let content = format!("reply {suffix}");
    let nonce = format!("reply-{suffix}");
    let reply = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.bob_token,
        &channel.id,
        &PostMessageBody {
            content: &content,
            mentions: Vec::new(),
            thread_id: Some(root.id.as_str()),
            attachments: Vec::new(),
            nonce: &nonce,
        },
    )
    .await
    .with_context(|| format!("{} reply", ctx.api.label()))?;
    assert_db_message(
        &ctx.pool,
        &reply.id,
        &channel.id,
        &ctx.users.bob.user_id,
        &content,
        Some(&root.id),
    )
    .await?;

    for event in listeners
        .wait_for_all(
            "comms_message",
            |data| {
                data.get("id").and_then(Value::as_str) == Some(reply.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "reply realtime message",
        )
        .await?
    {
        ensure!(
            event.data.get("thread_id").and_then(Value::as_str) == Some(root.id.as_str()),
            "{} {} reply thread mismatch: {}",
            ctx.api.label(),
            event.label,
            event.data
        );
    }
    wait_for_notification(
        &ctx.http,
        &ctx.world.services,
        &ctx.users.actor_token,
        |notification| {
            notification_matches(notification, "channel_message_reply", &channel.id)
                && notification_content(notification, "messageId") == Some(reply.id.as_str())
                && notification_content(notification, "threadId") == Some(root.id.as_str())
                && notification_content(notification, "messageContent") == Some(content.as_str())
        },
    )
    .await
    .with_context(|| format!("{} reply notification", ctx.api.label()))?;

    listeners.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn message_edit_persists_content_and_emits_realtime() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_message_edit_side_effect_contract(&ctx).await
}

async fn assert_message_edit_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let channel = create_private_contract_channel(ctx, "message-edit").await?;
    let suffix = ctx.suffix("edit-message");
    let root = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &format!("edit root {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("edit-root-{suffix}"),
        },
    )
    .await?;

    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let content = format!("edited {suffix}");
    let nonce = format!("edit-{suffix}");
    patch_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &root.id,
        &json!({
            "content": content,
            "mentions": [],
            "attachment_ids_to_delete": [],
            "attachments_to_add": [],
            "nonce": nonce,
        }),
    )
    .await
    .with_context(|| format!("{} edit", ctx.api.label()))?;
    assert_db_message_content(&ctx.pool, &root.id, &content).await?;

    for event in listeners
        .wait_for_all(
            "comms_message",
            |data| {
                data.get("id").and_then(Value::as_str) == Some(root.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "edit realtime message",
        )
        .await?
    {
        ensure!(
            event.data.get("content").and_then(Value::as_str) == Some(content.as_str()),
            "{} {} edit content mismatch: {}",
            ctx.api.label(),
            event.label,
            event.data
        );
    }

    listeners.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn message_delete_persists_tombstone_and_emits_realtime() -> anyhow::Result<()> {
    let ctx = ChannelContractContext::load().await?;
    assert_message_delete_side_effect_contract(&ctx).await
}

async fn assert_message_delete_side_effect_contract(
    ctx: &ChannelContractContext,
) -> anyhow::Result<()> {
    let channel = create_private_contract_channel(ctx, "message-delete").await?;
    let suffix = ctx.suffix("delete-message");
    let root = post_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &PostMessageBody {
            content: &format!("delete root {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("delete-root-{suffix}"),
        },
    )
    .await?;

    let mut listeners = ContractGatewayListeners::connect(ctx).await?;
    let nonce = format!("delete-{suffix}");
    delete_message_via(
        &ctx.http,
        &ctx.world.services,
        &ctx.api,
        &ctx.users.actor_token,
        &channel.id,
        &root.id,
        &nonce,
    )
    .await
    .with_context(|| format!("{} delete", ctx.api.label()))?;
    assert_db_message_deleted(&ctx.pool, &root.id).await?;

    for event in listeners
        .wait_for_all(
            "comms_message",
            |data| {
                data.get("id").and_then(Value::as_str) == Some(root.id.as_str())
                    && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
            },
            "delete realtime message",
        )
        .await?
    {
        ensure!(
            !event
                .data
                .get("deleted_at")
                .unwrap_or(&Value::Null)
                .is_null(),
            "{} {} delete payload missing deleted_at: {}",
            ctx.api.label(),
            event.label,
            event.data
        );
    }

    listeners.close().await;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct CreateChannelResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct MessageMutationResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct GetOrCreateResponse {
    channel_id: String,
    action: String,
}

#[derive(Debug, Deserialize)]
struct GatewayMessage {
    #[serde(rename = "type")]
    message_type: String,
    data: String,
}

struct TestWorld {
    config: LocalE2eConfig,
    seed: LocalE2eSeed,
    services: LocalE2eServices,
}

impl TestWorld {
    fn load() -> anyhow::Result<Self> {
        let config = LocalE2eConfig::load()?;
        let seed = LocalE2eSeed::from_config(&config)?;
        let services = LocalE2eServices::from_config(&config)?;
        Ok(Self {
            config,
            seed,
            services,
        })
    }

    fn token_for(&self, user: &SeedUser) -> anyhow::Result<String> {
        encode_local_jwt_with(&self.config, LocalJwtOptions::new(user))
    }
}

struct PostMessageBody<'a> {
    content: &'a str,
    mentions: Vec<Value>,
    thread_id: Option<&'a str>,
    attachments: Vec<Value>,
    nonce: &'a str,
}

async fn create_channel_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    name: String,
    channel_type: &str,
    participants: &[&str],
) -> anyhow::Result<CreateChannelResponse> {
    let response = http
        .post(api.create_channel_url())
        .bearer_auth(token)
        .json(&json!({
            "name": name,
            "channel_type": channel_type,
            "team_id": null,
            "participants": participants,
        }))
        .send()
        .await
        .context("failed to create channel")?;
    require_success(response, "create channel")
        .await?
        .json()
        .await
        .context("failed to decode create channel response")
}

async fn patch_channel_name_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    channel_name: &str,
) -> anyhow::Result<()> {
    require_success(
        http.patch(api.channel_url(channel_id))
            .bearer_auth(token)
            .json(&json!({ "channel_name": channel_name }))
            .send()
            .await
            .context("failed to patch channel name")?,
        "patch channel",
    )
    .await?;
    Ok(())
}

async fn add_participants_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    participants: &[&str],
) -> anyhow::Result<()> {
    require_success(
        http.post(api.channel_participants_url(channel_id))
            .bearer_auth(token)
            .json(&json!({ "participants": participants }))
            .send()
            .await
            .context("failed to add participants")?,
        "add participants",
    )
    .await?;
    Ok(())
}

async fn remove_participants_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    participants: &[&str],
) -> anyhow::Result<()> {
    require_success(
        http.request(Method::DELETE, api.channel_participants_url(channel_id))
            .bearer_auth(token)
            .json(&json!({ "participants": participants }))
            .send()
            .await
            .context("failed to remove participants")?,
        "remove participants",
    )
    .await?;
    Ok(())
}

async fn delete_channel_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
) -> anyhow::Result<()> {
    require_success(
        http.delete(api.channel_url(channel_id))
            .bearer_auth(token)
            .send()
            .await
            .context("failed to delete channel")?,
        "delete channel",
    )
    .await?;
    Ok(())
}

async fn post_message_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    body: &PostMessageBody<'_>,
) -> anyhow::Result<MessageMutationResponse> {
    let response = http
        .post(api.post_channel_message_url(channel_id))
        .bearer_auth(token)
        .json(&json!({
            "content": body.content,
            "mentions": body.mentions,
            "thread_id": body.thread_id,
            "attachments": body.attachments,
            "nonce": body.nonce,
        }))
        .send()
        .await
        .context("failed to post channel message")?;
    require_success(response, "post channel message")
        .await?
        .json()
        .await
        .context("failed to decode post message response")
}

async fn patch_message_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    message_id: &str,
    body: &Value,
) -> anyhow::Result<()> {
    require_success(
        http.patch(api.channel_message_url(channel_id, message_id))
            .bearer_auth(token)
            .json(body)
            .send()
            .await
            .context("failed to patch message")?,
        "patch message",
    )
    .await?;
    Ok(())
}

async fn post_reaction_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    message_id: &str,
    emoji: &str,
    action: &str,
    nonce: &str,
) -> anyhow::Result<()> {
    require_success(
        http.post(api.post_channel_reaction_url(channel_id))
            .bearer_auth(token)
            .json(&json!({
                "emoji": emoji,
                "message_id": message_id,
                "action": action,
                "nonce": nonce,
            }))
            .send()
            .await
            .context("failed to post reaction")?,
        "post reaction",
    )
    .await?;
    Ok(())
}

async fn post_typing_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    action: &str,
    thread_id: Option<&str>,
    nonce: &str,
) -> anyhow::Result<()> {
    require_success(
        http.post(api.post_channel_typing_url(channel_id))
            .bearer_auth(token)
            .json(&json!({
                "action": action,
                "thread_id": thread_id,
                "nonce": nonce,
            }))
            .send()
            .await
            .context("failed to post typing")?,
        "post typing",
    )
    .await?;
    Ok(())
}

async fn delete_message_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
    message_id: &str,
    nonce: &str,
) -> anyhow::Result<()> {
    require_success(
        http.delete(format!(
            "{}?nonce={nonce}",
            api.channel_message_url(channel_id, message_id)
        ))
        .bearer_auth(token)
        .send()
        .await
        .context("failed to delete message")?,
        "delete message",
    )
    .await?;
    Ok(())
}

async fn get_or_create_dm_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    recipient_id: &str,
) -> anyhow::Result<GetOrCreateResponse> {
    let response = http
        .post(api.get_or_create_dm_url())
        .bearer_auth(token)
        .json(&json!({ "recipient_id": recipient_id }))
        .send()
        .await
        .context("failed to get or create DM")?;
    require_success(response, "get or create DM")
        .await?
        .json()
        .await
        .context("failed to decode DM response")
}

async fn get_or_create_private_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    recipients: &[&str],
) -> anyhow::Result<GetOrCreateResponse> {
    let response = http
        .post(api.get_or_create_private_url())
        .bearer_auth(token)
        .json(&json!({ "recipients": recipients }))
        .send()
        .await
        .context("failed to get or create private channel")?;
    require_success(response, "get or create private")
        .await?
        .json()
        .await
        .context("failed to decode private-channel response")
}

async fn get_channel_via(
    http: &Client,
    _services: &LocalE2eServices,
    api: &ChannelApiClient,
    token: &str,
    channel_id: &str,
) -> anyhow::Result<Value> {
    let response = http
        .get(format!("{}?limit=50", api.read_channel_url(channel_id)))
        .bearer_auth(token)
        .send()
        .await
        .with_context(|| format!("failed to GET channel {channel_id}"))?;
    require_success(response, "get channel")
        .await?
        .json()
        .await
        .with_context(|| format!("failed to decode channel {channel_id}"))
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
        .context("failed to connect to postgres for verification")
}

async fn db_now(pool: &PgPool) -> anyhow::Result<String> {
    sqlx::query_scalar::<_, String>("SELECT now()::text")
        .fetch_one(pool)
        .await
        .context("failed to read database clock")
}

async fn assert_db_channel(
    pool: &PgPool,
    channel_id: &str,
    expected_name: Option<&str>,
    expected_type: &str,
) -> anyhow::Result<()> {
    let channel_id = Uuid::parse_str(channel_id).context("failed to parse channel id")?;
    let row = sqlx::query_as::<_, (Option<String>, String)>(
        r#"
        SELECT name, channel_type::text
        FROM comms_channels
        WHERE id = $1
        "#,
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await
    .context("failed to query channel row")?;
    let Some((actual_name, actual_type)) = row else {
        anyhow::bail!("channel {channel_id} was not found in db");
    };
    ensure!(
        actual_name.as_deref() == expected_name && actual_type == expected_type,
        "channel {channel_id} persisted as name {actual_name:?}, type {actual_type}; expected name {expected_name:?}, type {expected_type}"
    );
    Ok(())
}

async fn assert_db_channel_absent(pool: &PgPool, channel_id: &str) -> anyhow::Result<()> {
    let channel_id = Uuid::parse_str(channel_id).context("failed to parse channel id")?;
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM comms_channels WHERE id = $1)")
            .bind(channel_id)
            .fetch_one(pool)
            .await
            .context("failed to query deleted channel row")?;
    ensure!(!exists, "channel {channel_id} still exists in db");
    Ok(())
}

async fn assert_db_participants_include(
    pool: &PgPool,
    channel_id: &str,
    user_ids: &[&str],
) -> anyhow::Result<()> {
    for user_id in user_ids {
        assert_db_participant(pool, channel_id, user_id, true).await?;
    }
    Ok(())
}

async fn assert_db_participants_absent(
    pool: &PgPool,
    channel_id: &str,
    user_ids: &[&str],
) -> anyhow::Result<()> {
    for user_id in user_ids {
        assert_db_participant(pool, channel_id, user_id, false).await?;
    }
    Ok(())
}

async fn assert_db_participant(
    pool: &PgPool,
    channel_id: &str,
    user_id: &str,
    expected_present: bool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::parse_str(channel_id).context("failed to parse channel id")?;
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM comms_channel_participants
            WHERE channel_id = $1 AND user_id = $2
        )
        "#,
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .context("failed to query channel participant")?;
    ensure!(
        exists == expected_present,
        "participant {user_id} presence for channel {channel_id} was {exists}, expected {expected_present}"
    );
    Ok(())
}

async fn assert_db_message(
    pool: &PgPool,
    message_id: &str,
    channel_id: &str,
    sender_id: &str,
    content: &str,
    thread_id: Option<&str>,
) -> anyhow::Result<()> {
    let message_id = Uuid::parse_str(message_id).context("failed to parse message id")?;
    let channel_id = Uuid::parse_str(channel_id).context("failed to parse channel id")?;
    let thread_id = thread_id
        .map(Uuid::parse_str)
        .transpose()
        .context("failed to parse thread id")?;
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM comms_messages
            WHERE id = $1
              AND channel_id = $2
              AND sender_id = $3
              AND content = $4
              AND thread_id IS NOT DISTINCT FROM $5
              AND deleted_at IS NULL
        )
        "#,
    )
    .bind(message_id)
    .bind(channel_id)
    .bind(sender_id)
    .bind(content)
    .bind(thread_id)
    .fetch_one(pool)
    .await
    .context("failed to query message row")?;
    ensure!(
        exists,
        "message {message_id} did not match expected persisted state"
    );
    Ok(())
}

async fn assert_db_message_content(
    pool: &PgPool,
    message_id: &str,
    content: &str,
) -> anyhow::Result<()> {
    let message_id = Uuid::parse_str(message_id).context("failed to parse message id")?;
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM comms_messages
            WHERE id = $1 AND content = $2 AND edited_at IS NOT NULL AND deleted_at IS NULL
        )
        "#,
    )
    .bind(message_id)
    .bind(content)
    .fetch_one(pool)
    .await
    .context("failed to query edited message row")?;
    ensure!(
        exists,
        "message {message_id} did not persist edited content"
    );
    Ok(())
}

async fn assert_db_message_deleted(pool: &PgPool, message_id: &str) -> anyhow::Result<()> {
    let message_id = Uuid::parse_str(message_id).context("failed to parse message id")?;
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM comms_messages
            WHERE id = $1 AND content = '' AND deleted_at IS NOT NULL
        )
        "#,
    )
    .bind(message_id)
    .fetch_one(pool)
    .await
    .context("failed to query deleted message row")?;
    ensure!(
        exists,
        "message {message_id} did not persist tombstone state"
    );
    Ok(())
}

async fn assert_db_attachment_count(
    pool: &PgPool,
    message_id: &str,
    expected_count: i64,
) -> anyhow::Result<()> {
    let message_id = Uuid::parse_str(message_id).context("failed to parse message id")?;
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM comms_attachments WHERE message_id = $1",
    )
    .bind(message_id)
    .fetch_one(pool)
    .await
    .context("failed to query attachment count")?;
    ensure!(
        count == expected_count,
        "message {message_id} attachment count was {count}, expected {expected_count}"
    );
    Ok(())
}

async fn assert_db_document_channel_share_permission(
    pool: &PgPool,
    document_id: &str,
    channel_id: &str,
) -> anyhow::Result<()> {
    let share_permission_id = sqlx::query_scalar::<_, String>(
        r#"
        SELECT dp."sharePermissionId"
        FROM "DocumentPermission" dp
        WHERE dp."documentId" = $1
        "#,
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .with_context(|| {
        format!("failed to query document share permission for document {document_id}")
    })?;

    let channel_share_permission_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM "ChannelSharePermission"
            WHERE "share_permission_id" = $1
              AND "channel_id" = $2
              AND "access_level"::text = 'view'
        )
        "#,
    )
    .bind(&share_permission_id)
    .bind(channel_id)
    .fetch_one(pool)
    .await
    .context("failed to query channel share permission row")?;
    ensure!(
        channel_share_permission_exists,
        "document {document_id} share permission {share_permission_id} was not granted to channel {channel_id}"
    );

    let document_uuid = Uuid::parse_str(document_id).context("failed to parse document id")?;
    let entity_access_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM entity_access
            WHERE entity_id = $1
              AND entity_type = 'document'
              AND source_id = $2
              AND source_type::text = 'channel'
              AND access_level::text = 'view'
              AND granted_from_project_id IS NULL
        )
        "#,
    )
    .bind(document_uuid)
    .bind(channel_id)
    .fetch_one(pool)
    .await
    .context("failed to query document channel entity access row")?;
    ensure!(
        entity_access_exists,
        "document {document_id} did not receive view entity_access from channel {channel_id}"
    );

    Ok(())
}

async fn assert_db_reaction(
    pool: &PgPool,
    message_id: &str,
    emoji: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    let message_id = Uuid::parse_str(message_id).context("failed to parse message id")?;
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM comms_reactions
            WHERE message_id = $1 AND emoji = $2 AND user_id = $3
        )
        "#,
    )
    .bind(message_id)
    .bind(emoji)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .context("failed to query reaction row")?;
    ensure!(
        exists,
        "reaction {emoji} by {user_id} missing for message {message_id}"
    );
    Ok(())
}

async fn wait_for_contacts_connections(
    pool: &PgPool,
    pairs: &[(&str, &str)],
    updated_after: &str,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + CONTACTS_TIMEOUT;
    loop {
        let mut missing = Vec::new();
        for (a, b) in pairs {
            if !contact_connection_updated_after(pool, a, b, updated_after).await? {
                missing.push(format!("{a}<->{b}"));
            }
        }
        if missing.is_empty() {
            return Ok(());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(
            !remaining.is_zero(),
            "timed out waiting for contacts connections updated after {updated_after}; missing {}",
            missing.join(", ")
        );
        tokio::time::sleep(remaining.min(Duration::from_millis(500))).await;
    }
}

async fn contact_connection_updated_after(
    pool: &PgPool,
    a: &str,
    b: &str,
    updated_after: &str,
) -> anyhow::Result<bool> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM contacts_connections
            WHERE (
                    (user1 = $1 AND user2 = $2)
                 OR (user1 = $2 AND user2 = $1)
            )
              AND updated_at >= $3::timestamptz
        )
        "#,
    )
    .bind(a)
    .bind(b)
    .bind(updated_after)
    .fetch_one(pool)
    .await
    .context("failed to query contacts connection")
}

async fn require_success(response: Response, context: &str) -> anyhow::Result<Response> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    anyhow::bail!("{context} failed with {status}: {body}")
}

fn assert_participant(channel: &Value, user_id: &str) -> anyhow::Result<()> {
    ensure!(
        participant_ids(channel)?.any(|id| id == user_id),
        "expected participant {user_id} in channel response: {channel}"
    );
    Ok(())
}

fn participant_ids(channel: &Value) -> anyhow::Result<impl Iterator<Item = &str>> {
    let participants = channel
        .get("participants")
        .and_then(Value::as_array)
        .context("channel response did not include participants array")?;
    Ok(participants
        .iter()
        .filter_map(|participant| participant.get("user_id").and_then(Value::as_str)))
}

fn reaction_payload_contains_user(payload: &Value, emoji: &str, user_id: &str) -> bool {
    payload
        .get("reactions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|reaction| reaction.get("emoji").and_then(Value::as_str) == Some(emoji))
        .and_then(|reaction| reaction.get("users").and_then(Value::as_array))
        .map(|users| users.iter().any(|user| user.as_str() == Some(user_id)))
        .unwrap_or(false)
}

async fn list_notifications(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
) -> anyhow::Result<Value> {
    let response = http
        .get(format!("{}?limit=100", services.user_notifications_url()))
        .bearer_auth(token)
        .send()
        .await
        .context("failed to list notifications")?;
    require_success(response, "list notifications")
        .await?
        .json()
        .await
        .context("failed to decode notification list")
}

async fn wait_for_notification<F>(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    matches: F,
) -> anyhow::Result<Value>
where
    F: Fn(&Value) -> bool,
{
    let deadline = Instant::now() + NOTIFICATION_TIMEOUT;
    loop {
        let notifications = list_notifications(http, services, token).await?;
        if let Some(notification) = find_notification(&notifications, &matches) {
            return Ok(notification.clone());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(!remaining.is_zero(), "timed out waiting for notification");
        tokio::time::sleep(remaining.min(Duration::from_millis(500))).await;
    }
}

fn find_notification<'a, F>(notifications: &'a Value, matches: F) -> Option<&'a Value>
where
    F: Fn(&Value) -> bool,
{
    notifications
        .get("items")
        .and_then(Value::as_array)?
        .iter()
        .find(|notification| matches(notification))
}

fn notification_matches(notification: &Value, tag: &str, channel_id: &str) -> bool {
    notification
        .get("notification_metadata")
        .and_then(|metadata| metadata.get("tag"))
        .and_then(Value::as_str)
        == Some(tag)
        && notification.get("entity_id").and_then(Value::as_str) == Some(channel_id)
}

fn notification_content<'a>(notification: &'a Value, key: &str) -> Option<&'a str> {
    notification
        .get("notification_metadata")
        .and_then(|metadata| metadata.get("content"))
        .and_then(|content| content.get(key))
        .and_then(Value::as_str)
}

fn assert_sender(notification: &Value, expected_sender: &str) -> anyhow::Result<()> {
    ensure!(
        notification.get("sender_id").and_then(Value::as_str) == Some(expected_sender),
        "notification sender mismatch: {notification}"
    );
    Ok(())
}

async fn ping_and_wait<W, R>(websocket_write: &mut W, websocket_read: &mut R) -> anyhow::Result<()>
where
    W: SinkExt<WebsocketMessage> + Unpin,
    <W as futures::Sink<WebsocketMessage>>::Error: std::error::Error + Send + Sync + 'static,
    R: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
{
    websocket_write
        .send(WebsocketMessage::Text("ping".into()))
        .await
        .context("failed to send websocket ping")?;
    wait_for_pong(websocket_read).await
}

async fn wait_for_pong<S>(websocket_read: &mut S) -> anyhow::Result<()>
where
    S: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
{
    loop {
        let message = next_websocket_message(websocket_read, WEBSOCKET_TIMEOUT).await?;
        if let WebsocketMessage::Text(text) = message
            && text == "pong"
        {
            return Ok(());
        }
    }
}

async fn wait_for_gateway_event<S, F>(
    websocket_read: &mut S,
    expected_type: &str,
    matches: F,
) -> anyhow::Result<Value>
where
    S: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
    F: Fn(&Value) -> bool,
{
    let deadline = Instant::now() + WEBSOCKET_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(
            !remaining.is_zero(),
            "timed out waiting for websocket event {expected_type}"
        );

        let message = next_websocket_message(websocket_read, remaining).await?;
        let WebsocketMessage::Text(text) = message else {
            continue;
        };
        if text == "pong" {
            continue;
        }
        let Some((message_type, data)) = parse_gateway_message(&text) else {
            continue;
        };
        if message_type == expected_type && matches(&data) {
            return Ok(data);
        }
    }
}

async fn next_websocket_message<S>(
    websocket_read: &mut S,
    duration: Duration,
) -> anyhow::Result<WebsocketMessage>
where
    S: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
{
    timeout(duration, websocket_read.next())
        .await
        .context("timed out waiting for websocket message")?
        .context("websocket closed before expected message")?
        .context("websocket returned an error")
}

fn parse_gateway_message(text: &str) -> Option<(String, Value)> {
    let gateway: GatewayMessage = serde_json::from_str(text).ok()?;
    let data = serde_json::from_str(&gateway.data).ok()?;
    Some((gateway.message_type, data))
}

fn unique_suffix() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos()
        .to_string()
}
