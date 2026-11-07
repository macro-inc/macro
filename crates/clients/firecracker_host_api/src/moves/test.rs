use chrono::TimeZone;

use super::*;

#[test]
fn peer_request_is_one_json_line() {
    let computer_id: ComputerId = "0195f3a4-3c1b-7c4e-9a6e-2f1d8c7b6a50".parse().unwrap();
    let request = PeerRequest {
        computer_id,
        ticket: MoveTicket::new("t".to_owned()),
        operation: PeerOperation::Receive {
            origin_guid: Some(42),
        },
        trace_context: None,
    };
    let line = serde_json::to_string(&request).unwrap();
    assert!(!line.contains('\n'));
    assert_eq!(
        line,
        r#"{"computerId":"0195f3a4-3c1b-7c4e-9a6e-2f1d8c7b6a50","ticket":"t","operation":{"operation":"receive","originGuid":42}}"#
    );
    assert_eq!(serde_json::from_str::<PeerRequest>(&line).unwrap(), request);
}

#[test]
fn replication_states_are_tagged() {
    let replication = Replication {
        state: ReplicationState::Failed {
            message: "broken pipe".to_owned(),
        },
        released: true,
        snapshot: Some("move-20261117T200000".to_owned()),
        incremental_from: None,
        bytes: 7,
        started_at: Some(Utc.with_ymd_and_hms(2026, 11, 17, 20, 0, 0).unwrap()),
        finished_at: None,
    };
    let json = serde_json::to_value(&replication).unwrap();
    assert_eq!(
        json["state"],
        serde_json::json!({"state": "failed", "message": "broken pipe"})
    );
    assert_eq!(
        serde_json::from_value::<Replication>(json).unwrap(),
        replication
    );
}

#[test]
fn peer_answers_round_trip() {
    let answer = PeerAnswer::State {
        snapshots: vec![PeerSnapshot {
            name: "move-1".to_owned(),
            guid: 9,
        }],
        resume_token: None,
        bases: vec![1, 2],
        live: false,
    };
    let line = serde_json::to_string(&answer).unwrap();
    assert_eq!(serde_json::from_str::<PeerAnswer>(&line).unwrap(), answer);
}

#[test]
fn a_ticket_never_prints_and_compares_by_content() {
    let ticket = MoveTicket::new("secret-ticket".to_owned());
    assert_eq!(format!("{ticket:?}"), "MoveTicket(**redacted**)");
    let request = PeerRequest {
        computer_id: "0195f3a4-3c1b-7c4e-9a6e-2f1d8c7b6a50".parse().unwrap(),
        ticket: ticket.clone(),
        operation: PeerOperation::State,
        trace_context: None,
    };
    assert!(!format!("{request:?}").contains("secret-ticket"));
    assert_eq!(ticket, MoveTicket::new("secret-ticket".to_owned()));
    assert_ne!(ticket, MoveTicket::new("secret-tickeX".to_owned()));
    assert_ne!(ticket, MoveTicket::new("secret".to_owned()));
}
