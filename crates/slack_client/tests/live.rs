//! Opt-in smoke test against real Slack with a session file:
//! `SLACK_LIVE_SESSION=<path> cargo test -p slack_client --test live -- --ignored --nocapture`.
//! Read-only. Prints only counts, ids and event types; never tokens,
//! names or message content.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Deserialize;
use slack_client::api::{ConversationType, UsersConversationsRequest, validate_session};
use slack_client::realtime::{Event, RealtimeConfig, RealtimeEvent};
use slack_client::{CookieToken, Secret, SessionCredentials, SessionToken, SlackClient, SlackEndpoints};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// How long to listen on the websocket.
const LISTEN: Duration = Duration::from_secs(5);

#[derive(Deserialize)]
struct SessionFile {
    d: String,
    d_s: Option<String>,
    teams: Vec<SessionTeam>,
}

#[derive(Deserialize)]
struct SessionTeam {
    token: String,
}

#[tokio::test]
#[ignore = "talks to real Slack; needs SLACK_LIVE_SESSION"]
async fn live_session_smoke() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let path = std::env::var_os("SLACK_LIVE_SESSION").expect("SLACK_LIVE_SESSION names a session file");
    let file: SessionFile =
        serde_json::from_slice(&std::fs::read(path).expect("session file is readable")).expect("session file parses");
    let team = file.teams.into_iter().next().expect("one team in the session file");
    let credentials = SessionCredentials {
        token: SessionToken::new(team.token).expect("token shape"),
        cookie: CookieToken::new(file.d).expect("cookie shape"),
        cookie_session_start: file.d_s.map(Secret::new),
    };
    let endpoints = SlackEndpoints::production();

    let auth = validate_session(&credentials, &endpoints).await.expect("auth.test");
    println!("auth.test: team {} user {}", auth.team_id, auth.user_id);
    let client = SlackClient::new(credentials, auth.workspace(), endpoints).expect("client");

    let boot = client.user_boot().await.expect("client.userBoot");
    let shared = boot
        .channels
        .iter()
        .filter(|channel| channel.conversation.is_slack_connect())
        .count();
    println!(
        "client.userBoot: {} channels ({} Slack Connect), {} ims, {} workspaces",
        boot.channels.len(),
        shared,
        boot.ims.len(),
        boot.workspaces.len()
    );

    let counts = client.counts().await.expect("client.counts");
    let unread = counts.channels.iter().chain(&counts.ims).chain(&counts.mpims).filter(|counts| counts.has_unreads).count();
    println!(
        "client.counts: {} channels, {} ims, {} mpims, {} with unreads",
        counts.channels.len(),
        counts.ims.len(),
        counts.mpims.len(),
        unread
    );

    let page = client
        .users_conversations(&UsersConversationsRequest {
            types: vec![
                ConversationType::PublicChannel,
                ConversationType::PrivateChannel,
                ConversationType::Mpim,
                ConversationType::Im,
            ],
            exclude_archived: true,
            limit: 200,
            cursor: None,
        })
        .await
        .expect("users.conversations");
    let connect: Vec<String> = page
        .channels
        .iter()
        .filter(|channel| channel.is_slack_connect())
        .map(|channel| channel.id.to_string())
        .collect();
    println!(
        "users.conversations: {} on the first page, more: {}, Slack Connect ids: {connect:?}",
        page.channels.len(),
        page.response_metadata.next_cursor().is_some()
    );

    let tracker = TaskTracker::new();
    let cancel = CancellationToken::new();
    let mut events = client.connect_realtime(RealtimeConfig::default(), cancel.clone(), &tracker);
    let mut seen: BTreeMap<String, u32> = BTreeMap::new();
    let _ = tokio::time::timeout(LISTEN, async {
        while let Some(event) = events.recv().await {
            let kind = match event {
                RealtimeEvent::Connecting { attempt } => format!("connecting#{attempt}"),
                RealtimeEvent::Connected { resumed } => format!("connected(resumed={resumed})"),
                RealtimeEvent::Disconnected { reason } => format!("disconnected({reason:?})"),
                RealtimeEvent::SessionEnded { code } => format!("session_ended({code})"),
                RealtimeEvent::Event(Event::Known(event)) => format!("{:?}", std::mem::discriminant(&*event)),
                RealtimeEvent::Event(Event::Unknown { event_type, .. }) => format!("unknown:{event_type:?}"),
                RealtimeEvent::Event(Event::Malformed { event_type, .. }) => format!("malformed:{event_type}"),
            };
            *seen.entry(kind).or_default() += 1;
        }
    })
    .await;
    cancel.cancel();
    tracker.close();
    tracker.wait().await;
    println!("websocket over {LISTEN:?}: {seen:?}");
    assert!(seen.keys().any(|kind| kind.starts_with("connected")), "the websocket said hello");
}
