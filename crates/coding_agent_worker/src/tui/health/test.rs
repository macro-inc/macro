use super::*;

#[test]
fn a_live_stream_reads_how_long_it_has_been_quiet() {
    let start = Instant::now();
    let live = TriggerStreamHealth::Live {
        verified: true,
        last_signal: start,
    };

    assert_eq!(
        triggers(Some(&live), start + Duration::from_secs(19)),
        TriggerHealth::Live {
            verified: true,
            quiet: Duration::from_secs(19)
        }
    );
}

#[test]
fn a_stopped_daemon_has_no_trigger_stream() {
    // The last state a stopped daemon published no longer counts.
    let start = Instant::now();
    let live = TriggerStreamHealth::Live {
        verified: true,
        last_signal: start,
    };
    assert_eq!(triggers(None, start), TriggerHealth::Stopped);
    assert_ne!(triggers(Some(&live), start), TriggerHealth::Stopped);
}

#[test]
fn the_runtime_is_connected_only_when_this_process_holds_the_connection() {
    // The service's flag alone once made the header read "connected".
    assert_eq!(
        runtime(true, false, Some(true)),
        RuntimeHealth::ServiceStillListsOnline
    );
    assert_eq!(runtime(true, false, Some(false)), RuntimeHealth::Dialing);
    assert_eq!(
        runtime(false, false, Some(true)),
        RuntimeHealth::Disconnected
    );
    assert_eq!(
        runtime(true, true, Some(false)),
        RuntimeHealth::ServiceReportsOffline
    );
    assert_eq!(runtime(true, true, Some(true)), RuntimeHealth::Connected);
    assert_eq!(runtime(true, false, None), RuntimeHealth::Unreachable);
}
