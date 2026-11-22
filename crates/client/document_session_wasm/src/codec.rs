use crate::*;
use doc_sync_core::*;
pub(crate) fn now(mono: f64, wall: f64) -> Result<Now, BoundaryError> {
    if !mono.is_finite()
        || !(0.0..=9_007_199_254_740_991.0).contains(&mono)
        || !wall.is_finite()
        || wall.abs() > 9_007_199_254_740_991.0
    {
        return Err(BoundaryError::Invalid("clock"));
    }
    Ok(Now {
        mono: Millis(mono as u64),
        wall: UnixMillis(wall as i64),
    })
}
pub(crate) fn config(
    msg: wire::SessionConfigMsg,
) -> Result<
    (
        document_session::SessionConfig,
        bool,
        lexical_model::ViewHost,
    ),
    BoundaryError,
> {
    let headless = msg.headless;
    let view_host = lexical_model::ViewHost {
        engine: match msg.view_engine {
            0 => lexical_model::ViewEngine::Native,
            1 => lexical_model::ViewEngine::Chromium,
            2 => lexical_model::ViewEngine::AppleWebKit,
            3 => lexical_model::ViewEngine::Firefox,
            _ => return Err(BoundaryError::Invalid("view engine")),
        },
        os: match msg.view_os {
            0 => lexical_model::ViewOs::Other,
            1 => lexical_model::ViewOs::Apple,
            2 => lexical_model::ViewOs::Ios,
            3 => lexical_model::ViewOs::Android,
            _ => return Err(BoundaryError::Invalid("view os")),
        },
    };
    let sync = SyncConfig {
        doc: msg
            .doc
            .parse()
            .map_err(|_| BoundaryError::Invalid("document"))?,
        session: session(&msg.session)?,
        user: UserKey(msg.user),
        transport: match msg.transport {
            wire::Transport::None => TransportKind::None,
            wire::Transport::Direct => TransportKind::Direct,
            wire::Transport::Routed => TransportKind::Routed,
        },
        persistence: if msg.durable {
            Persistence::Durable
        } else {
            Persistence::Memory
        },
        access: match msg.access {
            wire::Access::Edit => Access::Edit,
            wire::Access::CommentOnly => Access::CommentOnly,
            wire::Access::Read => Access::Read,
        },
        initial_token: (!msg.token.is_empty()).then_some(SyncToken::new(msg.token)),
        traceparent: (!msg.traceparent.is_empty()).then_some(msg.traceparent),
        timeouts: Timeouts::default(),
        heartbeat: HeartbeatPolicy::default(),
        backoff: BackoffPolicy::default(),
        converge: ConvergePolicy::default(),
        wal: WalPolicy {
            coalesce: Millis(u64::from(msg.coalesce)),
            ..WalPolicy::default()
        },
        snapshot_interval: (msg.snapshot_interval > 0)
            .then_some(Millis(u64::from(msg.snapshot_interval))),
        presence: PresencePolicy {
            timeout: WallDuration(10000),
            refresh: None,
            user: PresenceUser {
                user_id: None,
                color: PaletteColor::Blue,
            },
            key: PresenceKeyMode::Peer,
        },
        chatter: msg.chatter,
        reset_budget: ResetBudget::default(),
    };
    Ok((
        document_session::SessionConfig {
            sync,
            peer_ids: msg.peers,
            peer_range: PeerRange::User,
            surface: document_session::SurfaceConfig::Generic(document_session::GenericConfig {
                roots: msg
                    .observed
                    .into_iter()
                    .map(crate::generic::path)
                    .collect::<Result<_, _>>()?,
            }),
        },
        headless,
        view_host,
    ))
}
pub(crate) fn session(text: &str) -> Result<SessionId, BoundaryError> {
    serde_json::from_value(serde_json::Value::String(text.into())).map_err(Into::into)
}
pub(crate) fn failure(code: u32) -> Result<StorageFailure, BoundaryError> {
    Ok(match code {
        1 => StorageFailure::Unavailable,
        2 => StorageFailure::QuotaExceeded,
        3 => StorageFailure::Corrupt,
        4 => StorageFailure::Uncertain,
        5 => StorageFailure::Other,
        _ => return Err(BoundaryError::Invalid("storage failure")),
    })
}
pub(crate) fn host(code: u32) -> Result<HostSignal, BoundaryError> {
    Ok(match code {
        0 => HostSignal::Online,
        1 => HostSignal::Visible,
        2 => HostSignal::Hidden,
        3 => HostSignal::PageHide,
        _ => return Err(BoundaryError::Invalid("host signal")),
    })
}
