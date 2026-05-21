use std::time::Duration;

use anyhow::{Context, ensure};
use futures::{SinkExt, StreamExt};
use local_e2e_test_support::{
    LocalE2eConfig, LocalE2eSeed, LocalE2eServices, LocalJwtOptions, SeedUser,
    encode_local_jwt_with,
};
use reqwest::{Client, Method, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{Error as WebsocketError, Message as WebsocketMessage};
use uuid::Uuid;

const WEBSOCKET_TIMEOUT: Duration = Duration::from_secs(10);
const NOTIFICATION_TIMEOUT: Duration = Duration::from_secs(30);

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn channel_create_patch_and_participant_mutations_update_state() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let dana = world
        .seed
        .user_by_email("dana@example.com")
        .context("missing dana fixture")?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("state-{suffix}"),
        "public",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;

    let initial = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    ensure!(
        initial
            .pointer("/channel/channel_type")
            .and_then(Value::as_str)
            == Some("public"),
        "channel type mismatch: {initial}"
    );
    assert_participant(&initial, &actor.user_id)?;
    assert_participant(&initial, &bob.user_id)?;
    assert_participant(&initial, &charlie.user_id)?;

    let renamed = format!("state-renamed-{suffix}");
    patch_channel_name(&http, &world.services, &actor_token, &created.id, &renamed).await?;
    let persisted_name = get_persisted_channel_name(&world.config, &created.id).await?;
    ensure!(
        persisted_name.as_deref() == Some(renamed.as_str()),
        "persisted channel name mismatch: expected {renamed}, got {persisted_name:?}"
    );

    add_participants(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &[&dana.user_id],
    )
    .await?;
    let after_add = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    assert_participant(&after_add, &dana.user_id)?;

    remove_participants(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &[&dana.user_id],
    )
    .await?;
    let after_remove = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    assert_not_participant(&after_remove, &dana.user_id)?;

    delete_channel(&http, &world.services, &actor_token, &created.id).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service and notification_service workers"]
async fn first_message_fans_out_to_all_listeners_and_emits_channel_invites() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let bob_token = world.token_for(bob)?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let charlie_token = world.token_for(charlie)?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("invite-{suffix}"),
        "private",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;

    let actor_ws = world
        .services
        .connection_gateway_ws_url_with_token(&actor_token)?;
    let bob_ws = world
        .services
        .connection_gateway_ws_url_with_token(&bob_token)?;
    let charlie_ws = world
        .services
        .connection_gateway_ws_url_with_token(&charlie_token)?;
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

    let content = format!("invite message {suffix}");
    let nonce = format!("invite-nonce-{suffix}");
    let posted = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &content,
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &nonce,
        },
    )
    .await?;

    for (label, reader) in [
        ("actor", &mut actor_read),
        ("bob", &mut bob_read),
        ("charlie", &mut charlie_read),
    ] {
        let event = wait_for_gateway_event(reader, "comms_message", |data| {
            data.get("id").and_then(Value::as_str) == Some(posted.id.as_str())
                && data.get("nonce").and_then(Value::as_str) == Some(nonce.as_str())
        })
        .await
        .with_context(|| format!("{label} did not receive posted message"))?;
        ensure!(
            event.get("content").and_then(Value::as_str) == Some(content.as_str()),
            "{label} websocket content mismatch: {event}"
        );
    }

    let actor_notifications = list_notifications(&http, &world.services, &actor_token).await?;
    ensure!(
        find_notification(&actor_notifications, |notification| {
            notification_matches(notification, "channel_invite", &created.id)
        })
        .is_none(),
        "sender should not receive their own channel invite"
    );

    let bob_invite = wait_for_notification(&http, &world.services, &bob_token, |notification| {
        notification_matches(notification, "channel_invite", &created.id)
            && notification_content(notification, "messageContent") == Some(content.as_str())
    })
    .await
    .context("bob did not receive channel invite")?;
    assert_sender(&bob_invite, &actor.user_id)?;

    let charlie_invite =
        wait_for_notification(&http, &world.services, &charlie_token, |notification| {
            notification_matches(notification, "channel_invite", &created.id)
                && notification_content(notification, "messageContent") == Some(content.as_str())
        })
        .await
        .context("charlie did not receive channel invite")?;
    assert_sender(&charlie_invite, &actor.user_id)?;

    actor_write.send(WebsocketMessage::Close(None)).await.ok();
    bob_write.send(WebsocketMessage::Close(None)).await.ok();
    charlie_write.send(WebsocketMessage::Close(None)).await.ok();
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service and notification_service workers"]
async fn follow_up_messages_emit_expected_notification_shapes_without_duplicates()
-> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let bob_token = world.token_for(bob)?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let charlie_token = world.token_for(charlie)?;
    let document = world.seed.project_roadmap_document()?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("notif-{suffix}"),
        "private",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;

    let invite = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &format!("invite {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("invite-{suffix}"),
        },
    )
    .await?;
    let _ = invite;

    let broadcast_content = format!("broadcast {suffix}");
    let broadcast = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &broadcast_content,
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("broadcast-{suffix}"),
        },
    )
    .await?;

    wait_for_notification(&http, &world.services, &bob_token, |notification| {
        notification_matches(notification, "channel_message_send", &created.id)
            && notification_content(notification, "messageId") == Some(broadcast.id.as_str())
            && notification_content(notification, "messageContent")
                == Some(broadcast_content.as_str())
    })
    .await
    .context("bob did not receive message-send notification")?;
    wait_for_notification(&http, &world.services, &charlie_token, |notification| {
        notification_matches(notification, "channel_message_send", &created.id)
            && notification_content(notification, "messageId") == Some(broadcast.id.as_str())
    })
    .await
    .context("charlie did not receive message-send notification")?;

    let mention_content = format!("mention {suffix}");
    let mention = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &mention_content,
            mentions: vec![json!({ "entity_type": "user", "entity_id": bob.user_id })],
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("mention-{suffix}"),
        },
    )
    .await?;

    wait_for_notification(&http, &world.services, &bob_token, |notification| {
        notification_matches(notification, "channel_mention", &created.id)
            && notification_content(notification, "messageId") == Some(mention.id.as_str())
            && notification_content(notification, "messageContent")
                == Some(mention_content.as_str())
    })
    .await
    .context("bob did not receive mention notification")?;

    let bob_notifications = list_notifications(&http, &world.services, &bob_token).await?;
    ensure!(
        find_notification(&bob_notifications, |notification| {
            notification_matches(notification, "channel_message_send", &created.id)
                && notification_content(notification, "messageId") == Some(mention.id.as_str())
        })
        .is_none(),
        "mentioned recipient should not also receive channel_message_send for the same message"
    );

    wait_for_notification(&http, &world.services, &charlie_token, |notification| {
        notification_matches(notification, "channel_message_send", &created.id)
            && notification_content(notification, "messageId") == Some(mention.id.as_str())
    })
    .await
    .context("charlie did not receive fallback message-send notification")?;

    let document_content = format!("document {suffix}");
    let document_message = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &document_content,
            mentions: vec![json!({
                "entity_type": "document",
                "entity_id": document.document_id,
            })],
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("document-{suffix}"),
        },
    )
    .await?;

    wait_for_notification(&http, &world.services, &bob_token, |notification| {
        notification_matches(notification, "document_mention", &created.id)
            && notification_content(notification, "messageId") == Some(document_message.id.as_str())
            && notification_content(notification, "messageContent")
                == Some(document_content.as_str())
            && notification_content(notification, "documentName")
                == Some(document.document_name.as_str())
    })
    .await
    .context("bob did not receive document mention notification")?;

    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn message_edits_update_read_model_and_realtime_delivery() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let bob_token = world.token_for(bob)?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let charlie_token = world.token_for(charlie)?;
    let document = world.seed.project_roadmap_document()?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("edit-{suffix}"),
        "public",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;

    let actor_ws = world
        .services
        .connection_gateway_ws_url_with_token(&actor_token)?;
    let bob_ws = world
        .services
        .connection_gateway_ws_url_with_token(&bob_token)?;
    let charlie_ws = world
        .services
        .connection_gateway_ws_url_with_token(&charlie_token)?;
    let (actor_socket, _) = connect_async(&actor_ws).await?;
    let (bob_socket, _) = connect_async(&bob_ws).await?;
    let (charlie_socket, _) = connect_async(&charlie_ws).await?;
    let (mut actor_write, mut actor_read) = actor_socket.split();
    let (mut bob_write, mut bob_read) = bob_socket.split();
    let (mut charlie_write, mut charlie_read) = charlie_socket.split();
    ping_and_wait(&mut actor_write, &mut actor_read).await?;
    ping_and_wait(&mut bob_write, &mut bob_read).await?;
    ping_and_wait(&mut charlie_write, &mut charlie_read).await?;

    let initial_content = format!("edit source {suffix}");
    let posted = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &initial_content,
            mentions: Vec::new(),
            thread_id: None,
            attachments: vec![json!({
                "entity_type": "document",
                "entity_id": document.document_id,
                "width": 640,
                "height": 480,
            })],
            nonce: &format!("edit-post-{suffix}"),
        },
    )
    .await?;
    let after_post = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    let attachment_id = find_attachment_for_message(&after_post, &posted.id)?
        .get("id")
        .and_then(Value::as_str)
        .context("missing initial attachment id")?
        .to_owned();

    let edited_content = format!("edited content {suffix}");
    let patch_nonce = format!("edit-patch-{suffix}");
    patch_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &posted.id,
        &json!({
            "content": edited_content,
            "mentions": [{ "entity_type": "user", "entity_id": bob.user_id }],
            "attachment_ids_to_delete": [attachment_id],
            "attachments_to_add": [],
            "nonce": patch_nonce,
        }),
    )
    .await?;

    let after_patch = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    let patched_message = find_message(&after_patch, &posted.id)?;
    ensure!(
        patched_message.get("content").and_then(Value::as_str) == Some(edited_content.as_str()),
        "patched content mismatch: {patched_message}"
    );
    ensure!(
        !patched_message
            .get("edited_at")
            .unwrap_or(&Value::Null)
            .is_null(),
        "patched message did not set edited_at: {patched_message}"
    );
    ensure!(
        find_attachment_for_message(&after_patch, &posted.id).is_err(),
        "patched message still has deleted attachment: {after_patch}"
    );

    for (label, reader) in [
        ("actor", &mut actor_read),
        ("bob", &mut bob_read),
        ("charlie", &mut charlie_read),
    ] {
        let event = wait_for_gateway_event(reader, "comms_message", |data| {
            data.get("id").and_then(Value::as_str) == Some(posted.id.as_str())
                && data.get("nonce").and_then(Value::as_str) == Some(patch_nonce.as_str())
        })
        .await
        .with_context(|| format!("{label} did not receive message edit"))?;
        ensure!(
            event.get("content").and_then(Value::as_str) == Some(edited_content.as_str()),
            "{label} patch websocket content mismatch: {event}"
        );
    }

    actor_write.send(WebsocketMessage::Close(None)).await.ok();
    bob_write.send(WebsocketMessage::Close(None)).await.ok();
    charlie_write.send(WebsocketMessage::Close(None)).await.ok();
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn message_reactions_update_read_model_and_realtime_delivery() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let bob_token = world.token_for(bob)?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let charlie_token = world.token_for(charlie)?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("reaction-{suffix}"),
        "public",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;
    let posted = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &format!("reaction source {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("reaction-post-{suffix}"),
        },
    )
    .await?;

    let actor_ws = world
        .services
        .connection_gateway_ws_url_with_token(&actor_token)?;
    let bob_ws = world
        .services
        .connection_gateway_ws_url_with_token(&bob_token)?;
    let charlie_ws = world
        .services
        .connection_gateway_ws_url_with_token(&charlie_token)?;
    let (actor_socket, _) = connect_async(&actor_ws).await?;
    let (bob_socket, _) = connect_async(&bob_ws).await?;
    let (charlie_socket, _) = connect_async(&charlie_ws).await?;
    let (mut actor_write, mut actor_read) = actor_socket.split();
    let (mut bob_write, mut bob_read) = bob_socket.split();
    let (mut charlie_write, mut charlie_read) = charlie_socket.split();
    ping_and_wait(&mut actor_write, &mut actor_read).await?;
    ping_and_wait(&mut bob_write, &mut bob_read).await?;
    ping_and_wait(&mut charlie_write, &mut charlie_read).await?;

    let reaction_nonce = format!("reaction-{suffix}");
    post_reaction(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &posted.id,
        "✅",
        "Add",
        &reaction_nonce,
    )
    .await?;

    let after_reaction = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    assert_reaction(&after_reaction, &posted.id, "✅", &actor.user_id)?;

    for (label, reader) in [
        ("actor", &mut actor_read),
        ("bob", &mut bob_read),
        ("charlie", &mut charlie_read),
    ] {
        let event = wait_for_gateway_event(reader, "comms_reaction", |data| {
            data.get("message_id").and_then(Value::as_str) == Some(posted.id.as_str())
                && data.get("nonce").and_then(Value::as_str) == Some(reaction_nonce.as_str())
        })
        .await
        .with_context(|| format!("{label} did not receive reaction event"))?;
        ensure!(
            reaction_payload_contains_user(&event, "✅", &actor.user_id),
            "{label} reaction payload missing actor user id: {event}"
        );
    }

    actor_write.send(WebsocketMessage::Close(None)).await.ok();
    bob_write.send(WebsocketMessage::Close(None)).await.ok();
    charlie_write.send(WebsocketMessage::Close(None)).await.ok();
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service and notification_service workers"]
async fn thread_replies_persist_and_emit_reply_notifications() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let bob_token = world.token_for(bob)?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let charlie_token = world.token_for(charlie)?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("reply-{suffix}"),
        "private",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;

    let root = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &format!("thread root {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("thread-root-{suffix}"),
        },
    )
    .await?;

    let actor_ws = world
        .services
        .connection_gateway_ws_url_with_token(&actor_token)?;
    let bob_ws = world
        .services
        .connection_gateway_ws_url_with_token(&bob_token)?;
    let charlie_ws = world
        .services
        .connection_gateway_ws_url_with_token(&charlie_token)?;
    let (actor_socket, _) = connect_async(&actor_ws).await?;
    let (bob_socket, _) = connect_async(&bob_ws).await?;
    let (charlie_socket, _) = connect_async(&charlie_ws).await?;
    let (mut actor_write, mut actor_read) = actor_socket.split();
    let (mut bob_write, mut bob_read) = bob_socket.split();
    let (mut charlie_write, mut charlie_read) = charlie_socket.split();
    ping_and_wait(&mut actor_write, &mut actor_read).await?;
    ping_and_wait(&mut bob_write, &mut bob_read).await?;
    ping_and_wait(&mut charlie_write, &mut charlie_read).await?;

    let reply_content = format!("thread reply {suffix}");
    let reply_nonce = format!("thread-reply-{suffix}");
    let reply = post_message(
        &http,
        &world.services,
        &bob_token,
        &created.id,
        &PostMessageBody {
            content: &reply_content,
            mentions: Vec::new(),
            thread_id: Some(root.id.as_str()),
            attachments: Vec::new(),
            nonce: &reply_nonce,
        },
    )
    .await?;

    let after_reply = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    let reply_message = find_message(&after_reply, &reply.id)?;
    ensure!(
        reply_message.get("thread_id").and_then(Value::as_str) == Some(root.id.as_str()),
        "reply did not persist thread_id: {reply_message}"
    );

    for (label, reader) in [
        ("actor", &mut actor_read),
        ("bob", &mut bob_read),
        ("charlie", &mut charlie_read),
    ] {
        let event = wait_for_gateway_event(reader, "comms_message", |data| {
            data.get("id").and_then(Value::as_str) == Some(reply.id.as_str())
                && data.get("nonce").and_then(Value::as_str) == Some(reply_nonce.as_str())
        })
        .await
        .with_context(|| format!("{label} did not receive reply event"))?;
        ensure!(
            event.get("thread_id").and_then(Value::as_str) == Some(root.id.as_str()),
            "{label} reply websocket thread_id mismatch: {event}"
        );
    }

    wait_for_notification(&http, &world.services, &actor_token, |notification| {
        notification_matches(notification, "channel_message_reply", &created.id)
            && notification_content(notification, "messageId") == Some(reply.id.as_str())
            && notification_content(notification, "threadId") == Some(root.id.as_str())
            && notification_content(notification, "messageContent") == Some(reply_content.as_str())
    })
    .await
    .context("thread parent sender did not receive reply notification")?;

    actor_write.send(WebsocketMessage::Close(None)).await.ok();
    bob_write.send(WebsocketMessage::Close(None)).await.ok();
    charlie_write.send(WebsocketMessage::Close(None)).await.ok();
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn message_deletes_tombstone_read_model_and_realtime_delivery() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let actor = world.seed.smoke_user()?;
    let actor_token = world.token_for(actor)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let bob_token = world.token_for(bob)?;
    let charlie = world
        .seed
        .user_by_email("charlie@example.com")
        .context("missing charlie fixture")?;
    let charlie_token = world.token_for(charlie)?;
    let suffix = unique_suffix();

    let created = create_channel(
        &http,
        &world.services,
        &actor_token,
        format!("delete-{suffix}"),
        "public",
        &[&bob.user_id, &charlie.user_id],
    )
    .await?;
    let posted = post_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &PostMessageBody {
            content: &format!("delete source {suffix}"),
            mentions: Vec::new(),
            thread_id: None,
            attachments: Vec::new(),
            nonce: &format!("delete-post-{suffix}"),
        },
    )
    .await?;

    let actor_ws = world
        .services
        .connection_gateway_ws_url_with_token(&actor_token)?;
    let bob_ws = world
        .services
        .connection_gateway_ws_url_with_token(&bob_token)?;
    let charlie_ws = world
        .services
        .connection_gateway_ws_url_with_token(&charlie_token)?;
    let (actor_socket, _) = connect_async(&actor_ws).await?;
    let (bob_socket, _) = connect_async(&bob_ws).await?;
    let (charlie_socket, _) = connect_async(&charlie_ws).await?;
    let (mut actor_write, mut actor_read) = actor_socket.split();
    let (mut bob_write, mut bob_read) = bob_socket.split();
    let (mut charlie_write, mut charlie_read) = charlie_socket.split();
    ping_and_wait(&mut actor_write, &mut actor_read).await?;
    ping_and_wait(&mut bob_write, &mut bob_read).await?;
    ping_and_wait(&mut charlie_write, &mut charlie_read).await?;

    let delete_nonce = format!("delete-{suffix}");
    delete_message(
        &http,
        &world.services,
        &actor_token,
        &created.id,
        &posted.id,
        &delete_nonce,
    )
    .await?;

    let after_delete = get_channel(&http, &world.services, &actor_token, &created.id).await?;
    let deleted_message = find_message(&after_delete, &posted.id)?;
    ensure!(
        !deleted_message
            .get("deleted_at")
            .unwrap_or(&Value::Null)
            .is_null(),
        "deleted message did not persist tombstone: {deleted_message}"
    );

    for (label, reader) in [
        ("actor", &mut actor_read),
        ("bob", &mut bob_read),
        ("charlie", &mut charlie_read),
    ] {
        let event = wait_for_gateway_event(reader, "comms_message", |data| {
            data.get("id").and_then(Value::as_str) == Some(posted.id.as_str())
                && data.get("nonce").and_then(Value::as_str) == Some(delete_nonce.as_str())
        })
        .await
        .with_context(|| format!("{label} did not receive delete event"))?;
        ensure!(
            !event.get("deleted_at").unwrap_or(&Value::Null).is_null(),
            "{label} delete websocket payload did not include deleted_at: {event}"
        );
    }

    actor_write.send(WebsocketMessage::Close(None)).await.ok();
    bob_write.send(WebsocketMessage::Close(None)).await.ok();
    charlie_write.send(WebsocketMessage::Close(None)).await.ok();
    Ok(())
}

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus document_storage_service"]
async fn get_or_create_and_join_preserve_legacy_access_behavior() -> anyhow::Result<()> {
    let world = TestWorld::load()?;
    let http = Client::new();
    let smoke = world.seed.smoke_user()?;
    let smoke_token = world.token_for(smoke)?;
    let bob = world
        .seed
        .user_by_email("bob@example.com")
        .context("missing bob fixture")?;
    let eve = world
        .seed
        .user_by_email("eve@example.com")
        .context("missing eve fixture")?;
    let eve_token = world.token_for(eve)?;
    let general = world.seed.general_channel()?;

    let dm = get_or_create_dm(&http, &world.services, &smoke_token, &bob.user_id).await?;
    ensure!(
        dm.action == "get",
        "expected existing seeded DM, got {dm:?}"
    );

    let invalid_dm = http
        .post(world.services.get_or_create_dm_url())
        .bearer_auth(&smoke_token)
        .json(&json!({ "recipient_id": smoke.user_id }))
        .send()
        .await
        .context("failed to call invalid self-DM")?;
    ensure!(
        invalid_dm.status() == reqwest::StatusCode::BAD_REQUEST,
        "self-DM should be rejected with 400, got {}: {}",
        invalid_dm.status(),
        invalid_dm.text().await.unwrap_or_default()
    );

    let private = get_or_create_private(
        &http,
        &world.services,
        &smoke_token,
        &[&bob.user_id, &eve.user_id],
    )
    .await?;
    ensure!(
        !private.channel_id.is_empty(),
        "private channel id was empty"
    );

    require_success(
        http.post(world.services.join_channel_url(&general.channel_id))
            .bearer_auth(&eve_token)
            .send()
            .await
            .context("failed to join public channel as non-participant")?,
        "join public channel as non-participant",
    )
    .await?;
    let joined = get_channel(&http, &world.services, &eve_token, &general.channel_id).await?;
    assert_participant(&joined, &eve.user_id)?;

    require_success(
        http.post(world.services.leave_channel_url(&general.channel_id))
            .bearer_auth(&eve_token)
            .send()
            .await
            .context("failed to leave public channel")?,
        "leave public channel",
    )
    .await?;

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

async fn create_channel(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    name: String,
    channel_type: &str,
    participants: &[&str],
) -> anyhow::Result<CreateChannelResponse> {
    let response = http
        .post(services.create_channel_url())
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

async fn patch_channel_name(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    channel_name: &str,
) -> anyhow::Result<()> {
    require_success(
        http.patch(services.channel_url(channel_id))
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

async fn add_participants(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    participants: &[&str],
) -> anyhow::Result<()> {
    require_success(
        http.post(services.channel_participants_url(channel_id))
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

async fn remove_participants(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    participants: &[&str],
) -> anyhow::Result<()> {
    require_success(
        http.request(
            Method::DELETE,
            services.channel_participants_url(channel_id),
        )
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

async fn delete_channel(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
) -> anyhow::Result<()> {
    require_success(
        http.delete(services.channel_url(channel_id))
            .bearer_auth(token)
            .send()
            .await
            .context("failed to delete channel")?,
        "delete channel",
    )
    .await?;
    Ok(())
}

async fn post_message(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    body: &PostMessageBody<'_>,
) -> anyhow::Result<MessageMutationResponse> {
    let response = http
        .post(services.post_channel_message_url(channel_id))
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

async fn patch_message(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    message_id: &str,
    body: &Value,
) -> anyhow::Result<()> {
    require_success(
        http.patch(services.channel_message_url(channel_id, message_id))
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

async fn post_reaction(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    message_id: &str,
    emoji: &str,
    action: &str,
    nonce: &str,
) -> anyhow::Result<()> {
    require_success(
        http.post(services.post_channel_reaction_url(channel_id))
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

async fn delete_message(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
    message_id: &str,
    nonce: &str,
) -> anyhow::Result<()> {
    require_success(
        http.delete(format!(
            "{}?nonce={nonce}",
            services.channel_message_url(channel_id, message_id)
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

async fn get_or_create_dm(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    recipient_id: &str,
) -> anyhow::Result<GetOrCreateResponse> {
    let response = http
        .post(services.get_or_create_dm_url())
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

async fn get_or_create_private(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    recipients: &[&str],
) -> anyhow::Result<GetOrCreateResponse> {
    let response = http
        .post(services.get_or_create_private_url())
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

async fn get_channel(
    http: &Client,
    services: &LocalE2eServices,
    token: &str,
    channel_id: &str,
) -> anyhow::Result<Value> {
    let response = http
        .get(format!("{}?limit=50", services.get_channel_url(channel_id)))
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

async fn get_persisted_channel_name(
    config: &LocalE2eConfig,
    channel_id: &str,
) -> anyhow::Result<Option<String>> {
    let database_url = config
        .required("DATABASE_URL")?
        .replace("@postgres:", "@localhost:");
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("failed to connect to postgres for channel verification")?;
    let channel_id = Uuid::parse_str(channel_id).context("failed to parse channel id")?;
    let name =
        sqlx::query_scalar::<_, Option<String>>("SELECT name FROM comms_channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(&pool)
            .await
            .context("failed to query persisted channel name")?;
    Ok(name)
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

fn assert_not_participant(channel: &Value, user_id: &str) -> anyhow::Result<()> {
    ensure!(
        participant_ids(channel)?.all(|id| id != user_id),
        "did not expect participant {user_id} in channel response: {channel}"
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

fn find_message<'a>(channel: &'a Value, message_id: &str) -> anyhow::Result<&'a Value> {
    channel
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
        })
        .with_context(|| format!("message {message_id} was not returned in channel response"))
}

fn find_attachment_for_message<'a>(
    channel: &'a Value,
    message_id: &str,
) -> anyhow::Result<&'a Value> {
    channel
        .get("attachments")
        .and_then(Value::as_array)
        .and_then(|attachments| {
            attachments.iter().find(|attachment| {
                attachment.get("message_id").and_then(Value::as_str) == Some(message_id)
            })
        })
        .with_context(|| format!("attachment for message {message_id} was not returned"))
}

fn assert_reaction(
    channel: &Value,
    message_id: &str,
    emoji: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    let reactions = channel
        .get("reactions")
        .and_then(|reactions| reactions.get(message_id))
        .and_then(Value::as_array)
        .with_context(|| format!("no reactions returned for message {message_id}: {channel}"))?;
    let reaction = reactions
        .iter()
        .find(|reaction| reaction.get("emoji").and_then(Value::as_str) == Some(emoji))
        .with_context(|| format!("reaction {emoji} missing for message {message_id}: {channel}"))?;
    let users = reaction
        .get("users")
        .and_then(Value::as_array)
        .context("reaction did not include users array")?;
    ensure!(
        users.iter().any(|user| user.as_str() == Some(user_id)),
        "reaction {emoji} did not include user {user_id}: {reaction}"
    );
    Ok(())
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
