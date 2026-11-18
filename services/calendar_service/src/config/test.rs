use super::*;

/// A Macro write to an Outlook event reaches its viewers only through the
/// projection relay, so pausing Outlook sync must not stop the relay while
/// writes stay on.
#[test]
fn the_relay_runs_whenever_outlook_events_can_change() {
    let sync_paused_writes_on = OutlookLoops::new(true, false, true);
    assert_eq!(
        sync_paused_writes_on,
        OutlookLoops {
            sync: false,
            relay: true
        }
    );
    assert_eq!(
        OutlookLoops::new(true, true, false),
        OutlookLoops {
            sync: true,
            relay: true
        }
    );
    assert_eq!(
        OutlookLoops::new(true, false, false),
        OutlookLoops {
            sync: false,
            relay: false
        }
    );
}

#[test]
fn the_calendar_sync_switch_stops_every_outlook_loop() {
    assert_eq!(
        OutlookLoops::new(false, true, true),
        OutlookLoops {
            sync: false,
            relay: false
        }
    );
}
