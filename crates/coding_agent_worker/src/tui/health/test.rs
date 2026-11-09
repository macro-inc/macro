use super::*;

#[test]
fn an_open_stream_is_live_only_while_the_server_is_heard_from() {
    let start = Instant::now();
    let (heard_at, heard) = watch::channel(start);
    let open = TriggerStream::Open { heard };

    assert_eq!(
        triggers(Some(&open), start + Duration::from_secs(19)),
        TriggerHealth::Live {
            quiet: Duration::from_secs(19)
        }
    );
    // A daemon that runs, with a stream that stopped sending, is not live.
    assert_eq!(
        triggers(Some(&open), start + Duration::from_secs(60)),
        TriggerHealth::Stalled {
            quiet: Duration::from_secs(60)
        }
    );

    // A keep-alive moves the clock the stream state already holds.
    heard_at.send_replace(start + Duration::from_secs(50));
    assert_eq!(
        triggers(Some(&open), start + Duration::from_secs(70)),
        TriggerHealth::Live {
            quiet: Duration::from_secs(20)
        }
    );
}

#[test]
fn a_dropped_stream_reads_as_reconnecting_and_a_stopped_daemon_has_none() {
    let start = Instant::now();
    let reconnecting = TriggerStream::Reconnecting {
        attempt: 2,
        cause: StreamEnd::Silent,
    };
    assert_eq!(
        triggers(Some(&reconnecting), start),
        TriggerHealth::Reconnecting {
            attempt: 2,
            cause: StreamEnd::Silent
        }
    );

    // The last state a stopped daemon reported no longer counts.
    assert_eq!(triggers(None, start), TriggerHealth::Stopped);
}

#[test]
fn the_runtime_is_connected_only_when_this_process_holds_the_connection() {
    // The service's flag alone once made the header read "connected".
    assert_eq!(runtime(true, false, Some(true)), RuntimeHealth::Dialing);
    assert_eq!(
        runtime(false, false, Some(true)),
        RuntimeHealth::Disconnected
    );
    assert_eq!(
        runtime(true, true, Some(false)),
        RuntimeHealth::ServiceReportsOffline
    );
    assert_eq!(runtime(true, true, Some(true)), RuntimeHealth::Connected);
}
