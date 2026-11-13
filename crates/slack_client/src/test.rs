use std::time::Duration;

use serde_json::json;
use slack_fake_server::FakeSlack;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use url::Url;
use uuid::Uuid;

use crate::api::{
    ConversationType, FileUpload, HistoryRequest, PostMessage, RepliesRequest, UpdateMessage,
    UsersConversationsRequest, validate_session,
};
use crate::models::{
    Block, FileAccess, KnownBlock, MessageSubtype, RichTextElement, RichTextInline,
};
use crate::realtime::{
    DisconnectReason, Event, MarkedEvent, ReactionItem, RealtimeConfig, RealtimeEvent, SlackEvent,
};
use crate::{
    ChannelId, CookieToken, MessageTs, SessionCredentials, SessionToken, SlackClient,
    SlackEndpoints, SlackError, SlackErrorCode, TeamId, UserId,
};

mod login;

const WAIT: Duration = Duration::from_secs(10);

/// A fake with one workspace (T0HOME), the signed-in user (U0SELF), an
/// external user from another org (U0EXT in T0PARTNER), and one Slack
/// Connect channel (C0SHARED) between them.
async fn seeded_fake() -> FakeSlack {
    let fake = FakeSlack::start().await.expect("fake starts");
    fake.add_team(json!({ "id": "T0HOME", "name": "Home", "domain": "home" }));
    fake.add_team(json!({ "id": "T0PARTNER", "name": "Partner", "domain": "partner" }));
    fake.add_user(json!({
        "id": "U0SELF",
        "team_id": "T0HOME",
        "name": "self",
        "real_name": "Self User",
        "profile": { "display_name": "self", "real_name": "Self User" },
        "updated": 1_700_000_000,
    }));
    fake.add_user(json!({
        "id": "U0EXT",
        "team_id": "T0PARTNER",
        "name": "ext",
        "is_stranger": true,
        "profile": { "display_name": "Ext", "real_name": "External Person", "team": "T0PARTNER" },
        "updated": 1_700_000_000,
    }));
    fake.add_session("U0SELF", "xoxc-111-222-333-abc", "xoxd-cookie/with+chars=");
    fake.add_conversation(
        json!({
            "id": "C0SHARED",
            "name": "acme-partner",
            "is_channel": true,
            "is_private": true,
            "is_ext_shared": true,
            "is_shared": true,
            "context_team_id": "T0HOME",
            "conversation_host_id": "T0HOME",
            "connected_team_ids": ["T0PARTNER"],
            "shared_team_ids": ["T0HOME", "T0PARTNER"],
            "topic": { "value": "", "creator": "", "last_set": 0 },
        }),
        &["U0SELF", "U0EXT"],
    );
    fake.add_conversation(
        json!({ "id": "D0EXT", "is_im": true, "user": "U0EXT", "is_ext_shared": true }),
        &["U0SELF", "U0EXT"],
    );
    fake
}

fn fake_endpoints(fake: &FakeSlack) -> SlackEndpoints {
    let base = Url::parse(fake.base_url()).expect("base URL");
    SlackEndpoints {
        slack: base.clone(),
        app: base.clone(),
        edge_api: base,
        websocket: Url::parse(&fake.websocket_url()).expect("websocket URL"),
        user_agent: "slack_client tests".to_owned(),
    }
}

fn credentials() -> SessionCredentials {
    SessionCredentials {
        token: SessionToken::new("xoxc-111-222-333-abc".to_owned()).expect("token"),
        cookie: CookieToken::new("xoxd-cookie%2Fwith%2Bchars%3D".to_owned()).expect("cookie"),
        cookie_session_start: None,
    }
}

async fn signed_in_client(fake: &FakeSlack) -> SlackClient {
    let endpoints = fake_endpoints(fake);
    let auth = validate_session(&credentials(), &endpoints)
        .await
        .expect("auth.test");
    SlackClient::new(credentials(), auth.workspace(), endpoints).expect("client")
}

fn quick_reconnects() -> RealtimeConfig {
    RealtimeConfig {
        ping_interval: Duration::from_secs(5),
        silence_timeout: Duration::from_secs(15),
        initial_backoff: Duration::from_millis(20),
        max_backoff: Duration::from_millis(100),
    }
}

/// The next Slack event, skipping connection lifecycle reports.
async fn next_slack_event(events: &mut tokio::sync::mpsc::Receiver<RealtimeEvent>) -> SlackEvent {
    loop {
        let event = tokio::time::timeout(WAIT, events.recv())
            .await
            .expect("an event in time")
            .expect("the connection is running");
        if let RealtimeEvent::Event(Event::Known(event)) = event {
            return *event;
        }
    }
}

#[tokio::test]
async fn a_session_boots_reads_sends_and_follows_events() {
    let fake = seeded_fake().await;
    let endpoints = fake_endpoints(&fake);

    let auth = validate_session(&credentials(), &endpoints)
        .await
        .expect("auth.test");
    assert_eq!(auth.team_id, TeamId::new("T0HOME").expect("team"));
    assert_eq!(auth.user_id, UserId::new("U0SELF").expect("user"));
    assert_eq!(auth.url.as_str(), fake.base_url());

    let client = SlackClient::new(credentials(), auth.workspace(), endpoints).expect("client");
    let boot = client.user_boot().await.expect("client.userBoot");
    assert_eq!(boot.own_user.id, UserId::new("U0SELF").expect("user"));
    assert_eq!(boot.team.name, "Home");
    assert_eq!(boot.channels.len(), 1);
    let shared = &boot.channels[0].conversation;
    assert!(shared.is_slack_connect());
    assert_eq!(
        shared.connected_team_ids,
        vec![TeamId::new("T0PARTNER").expect("team")]
    );
    assert_eq!(boot.ims.len(), 1);

    let page = client
        .users_conversations(&UsersConversationsRequest {
            types: vec![ConversationType::PrivateChannel, ConversationType::Im],
            exclude_archived: true,
            limit: 1,
            cursor: None,
        })
        .await
        .expect("users.conversations");
    assert_eq!(page.channels.len(), 1);
    let cursor = page
        .response_metadata
        .next_cursor()
        .expect("a second page")
        .to_owned();
    let second = client
        .users_conversations(&UsersConversationsRequest {
            types: vec![ConversationType::PrivateChannel, ConversationType::Im],
            exclude_archived: true,
            limit: 1,
            cursor: Some(cursor),
        })
        .await
        .expect("users.conversations page 2");
    assert_eq!(second.channels.len(), 1);
    assert_eq!(second.response_metadata.next_cursor(), None);

    let tracker = TaskTracker::new();
    let cancel = CancellationToken::new();
    let mut events = client.connect_realtime(quick_reconnects(), cancel.clone(), &tracker);
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connecting { attempt: 0 })
    );
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connected { resumed: false })
    );

    let channel = ChannelId::new("C0SHARED").expect("channel");
    let incoming_ts = fake.receive_message(
        "C0SHARED",
        json!({
            "user": "U0EXT",
            "user_team": "T0PARTNER",
            "text": "hello from the partner",
            "blocks": [{
                "type": "rich_text",
                "block_id": "b1",
                "elements": [{
                    "type": "rich_text_section",
                    "elements": [
                        { "type": "text", "text": "hello ", "style": { "bold": true } },
                        { "type": "user", "user_id": "U0SELF" },
                    ],
                }],
            }],
        }),
    );
    let SlackEvent::Message(incoming) = next_slack_event(&mut events).await else {
        panic!("expected the partner's message");
    };
    assert_eq!(incoming.channel, channel);
    assert_eq!(incoming.message.ts.as_str(), incoming_ts);
    assert_eq!(
        incoming.message.user_team,
        Some(TeamId::new("T0PARTNER").expect("team"))
    );
    assert_eq!(
        incoming.message.blocks,
        vec![Block::Known(KnownBlock::RichText {
            block_id: Some("b1".to_owned()),
            elements: vec![RichTextElement::RichTextSection {
                elements: vec![
                    RichTextInline::Text {
                        text: "hello ".to_owned(),
                        style: Some(crate::models::RichTextStyle {
                            bold: true,
                            ..Default::default()
                        }),
                    },
                    RichTextInline::User {
                        user_id: UserId::new("U0SELF").expect("user"),
                    },
                ],
            }],
        })]
    );

    let client_msg_id = Uuid::now_v7();
    let posted = client
        .post_message(&PostMessage {
            channel: channel.clone(),
            text: "a reply in the thread".to_owned(),
            blocks: Vec::new(),
            thread_ts: Some(incoming.message.ts.clone()),
            reply_broadcast: false,
            client_msg_id,
        })
        .await
        .expect("chat.postMessage");
    assert_eq!(
        posted.message.client_msg_id,
        Some(client_msg_id.to_string())
    );
    let SlackEvent::Message(echo) = next_slack_event(&mut events).await else {
        panic!("expected our own message echoed");
    };
    assert_eq!(echo.message.ts, posted.ts);
    assert!(echo.message.is_thread_reply());

    client
        .update_message(&UpdateMessage {
            channel: channel.clone(),
            ts: posted.ts.clone(),
            text: "an edited reply".to_owned(),
            blocks: Vec::new(),
        })
        .await
        .expect("chat.update");
    let SlackEvent::Message(edit) = next_slack_event(&mut events).await else {
        panic!("expected message_changed");
    };
    assert_eq!(edit.message.subtype, Some(MessageSubtype::MessageChanged));
    let edited = edit.changed_message.expect("the edited message");
    assert_eq!(edited.text, "an edited reply");
    assert_eq!(edited.ts, posted.ts);
    assert!(edited.edited.is_some());

    client
        .add_reaction(&channel, &incoming.message.ts, "tada")
        .await
        .expect("reactions.add");
    let SlackEvent::ReactionAdded(reaction) = next_slack_event(&mut events).await else {
        panic!("expected reaction_added");
    };
    assert_eq!(reaction.reaction, "tada");
    assert_eq!(
        reaction.item,
        ReactionItem::Message {
            channel: channel.clone(),
            ts: incoming.message.ts.clone(),
        }
    );

    client
        .mark_read(&channel, &incoming.message.ts)
        .await
        .expect("conversations.mark");
    assert_eq!(
        next_slack_event(&mut events).await,
        SlackEvent::GroupMarked(MarkedEvent {
            channel: channel.clone(),
            ts: incoming.message.ts.clone(),
            unread_count_display: Some(0),
            mention_count: None,
        })
    );

    let history = client
        .history(&HistoryRequest {
            channel: channel.clone(),
            latest: None,
            oldest: None,
            inclusive: false,
            limit: 100,
            cursor: None,
        })
        .await
        .expect("conversations.history");
    assert_eq!(history.messages.len(), 1);
    let root = &history.messages[0];
    assert_eq!(root.reply_count, Some(1));
    assert_eq!(root.reactions[0].name, "tada");

    let thread = client
        .replies(&RepliesRequest {
            channel: channel.clone(),
            thread_ts: incoming.message.ts.clone(),
            oldest: None,
            latest: None,
            inclusive: true,
            limit: 100,
            cursor: None,
        })
        .await
        .expect("conversations.replies");
    let texts: Vec<&str> = thread
        .messages
        .iter()
        .map(|message| message.text.as_str())
        .collect();
    assert_eq!(texts, vec!["hello from the partner", "an edited reply"]);

    let counts = client.counts().await.expect("client.counts");
    let shared_counts = counts
        .channels
        .iter()
        .find(|counts| counts.id == channel)
        .expect("the shared channel's counts");
    assert_eq!(shared_counts.last_read, Some(incoming.message.ts.clone()));
    assert!(shared_counts.has_unreads);

    client
        .delete_message(&channel, &posted.ts)
        .await
        .expect("chat.delete");
    let SlackEvent::Message(deleted) = next_slack_event(&mut events).await else {
        panic!("expected message_deleted");
    };
    assert_eq!(
        deleted.message.subtype,
        Some(MessageSubtype::MessageDeleted)
    );
    assert_eq!(deleted.deleted_ts, Some(posted.ts.clone()));

    cancel.cancel();
    tracker.close();
    tracker.wait().await;
}

#[tokio::test]
async fn a_revoked_session_ends_calls_and_the_socket() {
    let fake = seeded_fake().await;
    let client = signed_in_client(&fake).await;
    let tracker = TaskTracker::new();
    let cancel = CancellationToken::new();
    let mut events = client.connect_realtime(quick_reconnects(), cancel.clone(), &tracker);
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connecting { attempt: 0 })
    );
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connected { resumed: false })
    );

    fake.end_session("xoxc-111-222-333-abc", "token_revoked");

    let mut reports = Vec::new();
    while let Some(event) = tokio::time::timeout(WAIT, events.recv())
        .await
        .expect("reports in time")
    {
        reports.push(event);
    }
    assert_eq!(
        reports.last(),
        Some(&RealtimeEvent::SessionEnded {
            code: SlackErrorCode::TokenRevoked
        })
    );

    let error = client
        .auth_test()
        .await
        .expect_err("the session is revoked");
    assert!(error.is_session_ended());
    assert!(matches!(
        error,
        SlackError::Api {
            code: SlackErrorCode::TokenRevoked,
            ..
        }
    ));
    tracker.close();
    tracker.wait().await;
}

#[tokio::test]
async fn goodbye_reconnects_through_the_reconnect_url() {
    let fake = seeded_fake().await;
    let client = signed_in_client(&fake).await;
    let tracker = TaskTracker::new();
    let cancel = CancellationToken::new();
    let mut events = client.connect_realtime(quick_reconnects(), cancel.clone(), &tracker);
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connecting { attempt: 0 })
    );
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connected { resumed: false })
    );

    fake.goodbye();
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Disconnected {
            reason: DisconnectReason::Goodbye
        })
    );
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connecting { attempt: 1 })
    );
    assert_eq!(
        events.recv().await,
        Some(RealtimeEvent::Connected { resumed: true })
    );

    fake.push_event(
        "U0SELF",
        json!({ "type": "huddle_started", "channel": "C0SHARED" }),
    );
    let unknown = tokio::time::timeout(WAIT, events.recv())
        .await
        .expect("in time");
    assert_eq!(
        unknown,
        Some(RealtimeEvent::Event(Event::Unknown {
            event_type: Some("huddle_started".to_owned()),
            raw: json!({ "type": "huddle_started", "channel": "C0SHARED" }),
        }))
    );

    fake.push_event(
        "U0SELF",
        json!({ "type": "reaction_added", "user": "not an id" }),
    );
    let malformed = tokio::time::timeout(WAIT, events.recv())
        .await
        .expect("in time");
    assert!(matches!(
        malformed,
        Some(RealtimeEvent::Event(Event::Malformed { ref event_type, .. })) if event_type == "reaction_added"
    ));

    cancel.cancel();
    tracker.close();
    tracker.wait().await;
    assert_eq!(fake.socket_connections(), 2);
}

#[tokio::test]
async fn rate_limits_are_waited_out_and_errors_are_typed() {
    let fake = seeded_fake().await;
    let client = signed_in_client(&fake).await;

    fake.rate_limit_next("team.info", Duration::ZERO);
    let team = client.team_info(None).await.expect("team.info after a 429");
    assert_eq!(team.domain, "home");
    assert_eq!(fake.calls_of("team.info").len(), 2);

    fake.fail_next("conversations.info", "enterprise_is_restricted");
    let error = client
        .conversation_info(&ChannelId::new("C0SHARED").expect("channel"))
        .await
        .expect_err("injected failure");
    assert_eq!(error.code(), Some(&SlackErrorCode::EnterpriseIsRestricted));
    assert!(!error.is_session_ended());

    let missing = client
        .conversation_info(&ChannelId::new("C0MISSING").expect("channel"))
        .await
        .expect_err("no such channel");
    assert_eq!(missing.code(), Some(&SlackErrorCode::ChannelNotFound));

    fake.fail_next("users.info", "some_new_error");
    let unknown = client
        .user_info(&UserId::new("U0EXT").expect("user"))
        .await
        .expect_err("injected failure");
    assert_eq!(
        unknown.code(),
        Some(&SlackErrorCode::Other("some_new_error".to_owned()))
    );
}

#[tokio::test]
async fn files_upload_download_and_external_users_resolve() {
    let fake = seeded_fake().await;
    let client = signed_in_client(&fake).await;
    let channel = ChannelId::new("C0SHARED").expect("channel");

    let uploaded = client
        .upload_file(&FileUpload {
            channel: channel.clone(),
            thread_ts: None,
            filename: "notes.txt".to_owned(),
            title: Some("Notes".to_owned()),
            initial_comment: Some("here you go".to_owned()),
            client_msg_id: uuid::Uuid::now_v7(),
            body: bytes::Bytes::from_static(b"file body"),
        })
        .await
        .expect("upload");
    assert_eq!(uploaded.title.as_deref(), Some("Notes"));
    let shared = fake.calls_of("files.share");
    assert_eq!(shared.len(), 1);
    assert_eq!(
        shared[0].fields.get("files").map(String::as_str),
        Some(uploaded.id.as_str())
    );
    let history = client
        .history(&HistoryRequest {
            channel: channel.clone(),
            latest: None,
            oldest: None,
            inclusive: false,
            limit: 100,
            cursor: None,
        })
        .await
        .expect("history");
    assert!(
        history
            .messages
            .iter()
            .any(|message| message.ts == uploaded.share_ts && message.text == "here you go"),
        "the share message carries the returned ts and the caption"
    );
    assert_eq!(
        fake.file_bytes(uploaded.id.as_str()),
        Some(b"file body".to_vec())
    );

    let info = client.file_info(&uploaded.id).await.expect("files.info");
    assert_eq!(info.file_access, Some(FileAccess::Visible));
    let url = Url::parse(info.url_private.as_deref().expect("url_private")).expect("URL");
    let downloaded = client.download_file(&url).await.expect("download");
    assert_eq!(&downloaded.body[..], b"file body");

    let elsewhere = Url::parse("https://example.com/files/F1/notes.txt").expect("URL");
    let refused = client
        .download_file(&elsewhere)
        .await
        .expect_err("token stays on Slack");
    assert!(matches!(refused, SlackError::InvalidRequest { .. }));

    let users = client
        .edge_users_info(
            &[(UserId::new("U0EXT").expect("user"), 0)]
                .into_iter()
                .collect(),
        )
        .await
        .expect("edge users/info");
    assert_eq!(users.len(), 1);
    assert!(users[0].is_stranger);
    assert_eq!(
        users[0].team_id,
        Some(TeamId::new("T0PARTNER").expect("team"))
    );

    fake.add_emoji(
        "partyparrot",
        "https://emoji.slack-edge.com/T0HOME/partyparrot.gif",
    );
    fake.add_emoji("parrot", "alias:partyparrot");
    let emoji = client.emoji_list().await.expect("emoji.list");
    assert_eq!(
        emoji.get("parrot"),
        Some(&crate::api::CustomEmoji::Alias("partyparrot".to_owned()))
    );

    let view = client
        .conversation_view(&channel)
        .await
        .expect("conversations.view");
    assert_eq!(view.users.len(), 2);

    client.sign_out().await.expect("auth.signout");
    assert!(
        client
            .auth_test()
            .await
            .expect_err("signed out")
            .is_session_ended()
    );
}

#[test]
fn secrets_never_print() {
    let credentials = credentials();
    let printed = format!("{credentials:?}");
    assert!(!printed.contains("xoxc-"));
    assert!(!printed.contains("xoxd-"));
    assert_eq!(credentials.cookie.expose(), "xoxd-cookie/with+chars=");
    assert!(MessageTs::new("1700000001.000100").is_ok());
    assert!(MessageTs::new("not a ts").is_err());
}
