//! Development-only line protocol for the independent TypeScript four-peer differential.
use bebop::{Record, SliceWrapper};
use doc_sync_core::*;
use document_session::*;
use lexical_model::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
struct Request {
    peer: usize,
    kind: String,
    #[serde(default)]
    snapshot: Vec<u8>,
    #[serde(default)]
    bytes: Vec<u8>,
    #[serde(default)]
    path: Vec<u32>,
    #[serde(default)]
    from: u32,
    #[serde(default)]
    to: u32,
    #[serde(default)]
    text: String,
    #[serde(default)]
    now: u64,
}
fn time(ms: u64) -> Now {
    Now {
        mono: Millis(ms),
        wall: UnixMillis(ms as i64),
    }
}
fn config(peer: u64) -> SessionConfig {
    SessionConfig {
        sync: SyncConfig {
            doc: "collab-differential".parse().expect("fixture id"),
            session: SessionId(uuid_value::Uuid::from_u128(peer.into())),
            user: UserKey("fixture-user".into()),
            transport: TransportKind::Direct,
            persistence: Persistence::Memory,
            access: Access::Edit,
            initial_token: Some(SyncToken::new("fixture-token".into())),
            traceparent: None,
            timeouts: Timeouts::default(),
            heartbeat: HeartbeatPolicy::default(),
            backoff: BackoffPolicy::default(),
            converge: ConvergePolicy::default(),
            wal: WalPolicy::default(),
            snapshot_interval: None,
            presence: PresencePolicy {
                timeout: WallDuration(10000),
                refresh: None,
                user: PresenceUser {
                    user_id: None,
                    color: PaletteColor::Blue,
                },
                key: PresenceKeyMode::Peer,
            },
            chatter: false,
            reset_budget: ResetBudget::default(),
        },
        peer_ids: vec![peer, peer + 1000, peer + 2000, peer + 3000],
        peer_range: PeerRange::User,
        surface: SurfaceConfig::Editor(EditorConfig::default()),
    }
}
fn errors(out: &SessionOutput) -> Result<(), String> {
    for view in &out.view {
        if let ViewEffect::Error(error) = view {
            return Err(error.to_string());
        }
    }
    Ok(())
}
fn wire(
    session: &mut DocumentSession<EditorSurface>,
    message: sync_protocol::FromRemote<'_>,
    now: u64,
) -> Result<(), String> {
    let mut bytes = Vec::new();
    message.serialize(&mut bytes).map_err(|e| e.to_string())?;
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        errors(session.handle(
            time(now),
            SessionInput::Sync(SyncInput::Socket {
                conn: ConnId(1),
                event: SocketEvent::Frame(frame),
            }),
        ))?;
    }
    Ok(())
}
fn start(peer: u64, snapshot: Vec<u8>) -> Result<DocumentSession<EditorSurface>, String> {
    let mut session = DocumentSession::new(config(peer), time(0)).map_err(|e| e.to_string())?;
    errors(session.handle(time(0), SessionInput::Sync(SyncInput::Start)))?;
    errors(session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    ))?;
    errors(session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Opened,
        }),
    ))?;
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteInitialSync {
            snapshot: SliceWrapper::from_cooked(&[]),
            awareness: SliceWrapper::from_cooked(&[]),
        },
        0,
    )?;
    let vv = session.version().encode();
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(&[]),
        },
        0,
    )?;
    Ok(session)
}
fn run(
    sessions: &mut [Option<DocumentSession<EditorSurface>>; 2],
    request: Request,
) -> Result<Value, String> {
    let slot = sessions.get_mut(request.peer).ok_or("invalid peer")?;
    if request.kind == "init" {
        *slot = Some(start(101 + request.peer as u64, request.snapshot)?);
    }
    let session = slot.as_mut().ok_or("uninitialized peer")?;
    let before = session.version();
    if request.kind == "remote" {
        wire(
            session,
            sync_protocol::FromRemote::RemoteUpdate {
                update: SliceWrapper::from_cooked(&request.bytes),
            },
            request.now,
        )?;
    } else if !matches!(request.kind.as_str(), "init" | "observe") {
        let input = match request.kind.as_str() {
            "undo" => Input::Undo,
            "redo" => Input::Redo,
            _ => {
                let state = session.surface().state().view();
                let mut key = NodeKey::ROOT;
                for index in &request.path {
                    key = state
                        .children(key)
                        .nth(*index as usize)
                        .ok_or("invalid path")?;
                }
                let point = |offset| {
                    if state.is_text(key) {
                        Point::text(key, Utf16Offset(offset))
                    } else {
                        Point::element(key, ChildIndex(offset))
                    }
                };
                let selection = ViewSelection::Range {
                    anchor: point(request.from),
                    focus: point(request.to),
                    resolution_dirty: false,
                };
                let command = match request.kind.as_str() {
                    "insert" => Command::InsertText(request.text),
                    "paragraph" => Command::InsertParagraph,
                    "linebreak" => Command::InsertLineBreak {
                        select_start: false,
                    },
                    "tab" => Command::InsertTab,
                    "remove" => Command::RemoveText,
                    "format" => Command::FormatText(TextFormatType::Bold),
                    _ => return Err("unsupported command".into()),
                };
                Input::Command { command, selection }
            }
        };
        errors(session.handle(time(request.now), SessionInput::Editor(input)))?;
    }
    let peer = session.peer_id();
    let own_changed = session.version().get(&peer).copied().unwrap_or(0)
        > before.get(&peer).copied().unwrap_or(0);
    let bytes = if own_changed {
        session
            .conformance_updates(&before)
            .map_err(|e| e.to_string())?
    } else {
        vec![]
    };
    Ok(
        json!({ "value": session.conformance_value(), "editor": session.surface().state().to_json().map_err(|e| e.to_string())?, "bytes": bytes,
        "history": { "undo": session.surface().history().can_undo, "redo": session.surface().history().can_redo } }),
    )
}
fn main() {
    let mut sessions = [None, None];
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let result = line
            .map_err(|e| e.to_string())
            .and_then(|line| serde_json::from_str::<Request>(&line).map_err(|e| e.to_string()))
            .and_then(|request| run(&mut sessions, request));
        let value = match result {
            Ok(value) => value,
            Err(error) => json!({"error":error}),
        };
        writeln!(stdout, "{value}").expect("write fixture response");
        stdout.flush().expect("flush fixture response");
    }
}
