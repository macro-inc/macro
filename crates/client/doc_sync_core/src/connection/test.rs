use super::*;

fn machine() -> ConnectionMachine {
    ConnectionMachine::new(ConnectionSettings {
        target: ConnectionTarget::Document("document-test".parse().unwrap()),
        timeouts: Timeouts::default(),
        heartbeat: HeartbeatPolicy::default(),
        backoff: BackoffPolicy::default(),
        initial_token: Some(SyncToken::new("test-only-token".into())),
        initial_access: WriteAccess::Full,
        traceparent: None,
    })
}

#[test]
fn heartbeat_uses_fixed_cadence_and_late_pong_resets_misses() {
    let mut connection = machine();
    let mut effects = Vec::new();
    connection.start(
        Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        },
        false,
        &mut effects,
    );
    connection.socket(
        ConnId(1),
        &SocketEvent::Opened,
        Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        },
        &mut effects,
    );
    connection.initial(Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    });
    connection.tick(
        Now {
            mono: Millis(10_000),
            wall: UnixMillis(0),
        },
        &mut effects,
    );
    assert!(matches!(
        effects.last(),
        Some(IoEffect::SocketPing { conn: ConnId(1) })
    ));
    connection.tick(
        Now {
            mono: Millis(15_000),
            wall: UnixMillis(0),
        },
        &mut effects,
    );
    connection.socket(
        ConnId(1),
        &SocketEvent::Text("pong".into()),
        Now {
            mono: Millis(18_000),
            wall: UnixMillis(0),
        },
        &mut effects,
    );
    assert_eq!(connection.wake_at(), Some(Millis(20_000)));
    assert!(matches!(
        connection.state,
        Connection::Synced {
            heartbeat: Heartbeat::Waiting { missed: 0, .. },
            ..
        }
    ));
}
