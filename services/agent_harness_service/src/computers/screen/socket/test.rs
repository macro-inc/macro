use std::convert::Infallible;

use super::*;

#[tokio::test(start_paused = true)]
async fn an_awake_computer_is_not_announced_as_waking() {
    let mut told = false;
    let (woken, notice) = noticed_after(async { Woken::Up }, WAKING_NOTICE_AFTER, async {
        told = true;
        Ok::<(), Infallible>(())
    })
    .await;

    assert_eq!(woken, Woken::Up);
    assert!(notice.is_ok());
    assert!(!told, "an awake computer answers before the notice is due");
}

#[tokio::test(start_paused = true)]
async fn a_hibernated_computer_is_announced_once_and_then_awaited() {
    let mut told = 0;
    let (woken, notice) = noticed_after(
        async {
            // A restore and the runtime's dial.
            tokio::time::sleep(Duration::from_secs(4)).await;
            Woken::StillWaking
        },
        WAKING_NOTICE_AFTER,
        async {
            told += 1;
            Ok::<(), Infallible>(())
        },
    )
    .await;

    assert_eq!(woken, Woken::StillWaking);
    assert!(notice.is_ok());
    assert_eq!(told, 1);
}

#[test]
fn the_state_says_whether_the_computer_is_waking() {
    let state = ServerMessage::State {
        driver: None,
        driving_here: false,
        agent_held: false,
        surface: Surface::Desktop,
        transport: Transport::Vnc,
        viewers: 1,
        waking: true,
    };

    assert_eq!(
        serde_json::to_value(&state).unwrap(),
        serde_json::json!({
            "type": "state",
            "driver": null,
            "drivingHere": false,
            "agentHeld": false,
            "surface": "desktop",
            "transport": "vnc",
            "viewers": 1,
            "waking": true,
        })
    );
}

#[test]
fn a_viewer_leaving_or_the_fleet_saying_gone_needs_no_question() {
    assert_eq!(
        media_ending(Ok(MediaEnd::ViewerClosed)).unwrap().reason,
        EndReason::Stopped
    );
    assert_eq!(
        media_ending(Err(MediaError::Tunnel(TunnelError::ComputerOff)))
            .unwrap()
            .reason,
        EndReason::ComputerOff
    );
}

#[test]
fn a_stopped_computer_is_off_whatever_broke() {
    for stopped in [StoppedShort::GuestClosed, StoppedShort::TunnelFailed] {
        let ending = stopped_short_ending(stopped, Ok(ComputerPower::NotRunning));
        assert_eq!(ending.reason, EndReason::ComputerOff);
        assert_eq!(ending.error, None);
    }
}

#[test]
fn a_running_computer_whose_tunnel_failed_says_so() {
    for failure in [
        MediaError::Tunnel(TunnelError::Failed("OCI runtime exec failed".to_owned())),
        MediaError::Tunnel(TunnelError::Unreachable("host agent down".to_owned())),
        MediaError::Io(std::io::Error::other(TunnelExited::Code(1))),
    ] {
        let stopped = media_ending(Err(failure)).unwrap_err();
        assert_eq!(stopped, StoppedShort::TunnelFailed);
        let ending = stopped_short_ending(stopped, Ok(ComputerPower::Running));
        assert_eq!(ending.reason, EndReason::Error);
        // The fleet's own words stay in the log.
        assert_eq!(
            ending.error,
            Some((
                ErrorCode::TunnelFailed,
                "could not reach the computer's screen".to_owned()
            ))
        );
    }
}

#[test]
fn a_running_computer_whose_screen_closed_says_so() {
    let stopped = media_ending(Ok(MediaEnd::GuestClosed)).unwrap_err();
    let ending = stopped_short_ending(stopped, Ok(ComputerPower::Running));

    assert_eq!(ending.reason, EndReason::Error);
    assert_eq!(
        ending.error,
        Some((
            ErrorCode::SourceUnavailable,
            "the computer's screen closed".to_owned()
        ))
    );
}

#[test]
fn an_unknown_power_names_the_failure_rather_than_guess_off() {
    let ending = stopped_short_ending(
        StoppedShort::TunnelFailed,
        Err(TunnelError::Unreachable("database down".to_owned())),
    );

    assert_eq!(ending.reason, EndReason::Error);
}

fn lease_of(user: &str, session: SessionId) -> Lease {
    Lease {
        computer_id: ComputerId::new_from_uuid(uuid::Uuid::from_u128(0xC0)),
        session_id: session,
        driver: Driver {
            user_id: MacroUserIdStr::try_from(format!("macro|{user}@example.com")).unwrap(),
            name: Some("Alice".to_owned()),
        },
        agent_user_id: None,
        started_at: chrono::Utc::now(),
        expires_at: chrono::Utc::now(),
    }
}

#[test]
fn a_tab_whose_lease_moved_to_another_tab_is_told_it_does_not_drive_here() {
    let first_tab = SessionId::new();
    let second_tab = SessionId::new();
    let moved = lease_of("alice", second_tab);

    assert!(!drives_here(Some(&moved), first_tab));
    assert!(drives_here(Some(&moved), second_tab));
    assert!(!drives_here(None, second_tab));
}

#[test]
fn any_tab_of_the_driver_may_hand_back_and_nobody_else() {
    let moved = lease_of("alice", SessionId::new());
    let alice = MacroUserIdStr::try_from("macro|alice@example.com".to_owned()).unwrap();
    let bob = MacroUserIdStr::try_from("macro|bob@example.com".to_owned()).unwrap();

    assert!(may_hand_back(Some(&moved), &alice));
    assert!(!may_hand_back(Some(&moved), &bob));
    assert!(!may_hand_back(None, &alice));
}
