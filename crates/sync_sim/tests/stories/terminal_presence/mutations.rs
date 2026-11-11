use super::*;
use doc_sync_core::ConnectionStatus;

const RECEIVER: &str = "client1";
const SOURCE: &str = "client2";

fn terminal_status(event: &Event) -> bool {
    matches!(&event.fact, Fact::Status { client, status }
        if client.0 == RECEIVER && matches!(status.connection, ConnectionStatus::Closed(_)))
}

fn deadline(outcome: &Outcome) -> Millis {
    let crashed = outcome
        .events
        .iter()
        .find(|event| matches!(&event.fact, Fact::Crashed { client } if client.0 == SOURCE))
        .unwrap();
    assert!(
        !outcome
            .events
            .iter()
            .any(|event| matches!(event.fact, Fact::ClockSkew { .. }))
    );
    assert!(
        !outcome
            .script
            .iter()
            .any(|step| matches!(step, Step::Net(NetStep::Profile(_))))
    );
    Millis(
        crashed.at.0
            + outcome.config.session.presence_timeout.0.unsigned_abs()
            + 1
            + outcome
                .config
                .net
                .latency
                .0
                .0
                .max(outcome.config.net.latency.1.0),
    )
}

fn assert_stale_receiver(outcome: &Outcome) {
    let failure = invariants::presence_expires(outcome).unwrap_err();
    assert_eq!(failure.invariant, "presence_expires");
    assert!(failure.detail.contains(RECEIVER), "{failure}");
    assert!(failure.detail.contains(SOURCE), "{failure}");
}

#[test]
fn read_offline_and_disconnected_receivers_still_have_to_expire_presence() {
    let outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    assert_eq!(
        outcome.finals.clients[&ClientName(RECEIVER.into())].access,
        Access::Read
    );
    for connection in [
        ConnectionStatus::Connected,
        ConnectionStatus::Disconnected,
        ConnectionStatus::Offline,
    ] {
        let mut live = outcome.clone();
        for event in &mut live.events {
            if terminal_status(event)
                && let Fact::Status { status, .. } = &mut event.fact
            {
                status.connection = connection.clone();
            }
        }
        // Final terminal diagnostics are deliberately unchanged: the query
        // must use the actual receiver epoch at its expiration deadline.
        assert_stale_receiver(&live);
    }
}

#[test]
fn a_terminal_status_after_expiry_does_not_forgive_an_earlier_stale_view() {
    let mut outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    let at = Millis(deadline(&outcome).0 + 1);
    for event in &mut outcome.events {
        if terminal_status(event) {
            event.at = at;
        }
    }
    outcome.events.sort_by_key(|event| event.at);
    assert_stale_receiver(&outcome);
}

#[test]
fn a_terminal_status_for_another_receiver_does_not_waive_expiry() {
    let mut outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    for event in &mut outcome.events {
        if terminal_status(event)
            && let Fact::Status { client, .. } = &mut event.fact
        {
            *client = ClientName("another-receiver".into());
        }
    }
    assert_stale_receiver(&outcome);
}

#[test]
fn later_crash_close_or_document_change_cannot_hide_an_expired_view() {
    let outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    let at = Millis(deadline(&outcome).0 + 1);
    for close in [false, true] {
        let mut live = outcome.clone();
        live.events.retain(|event| !terminal_status(event));
        let receiver = live
            .finals
            .clients
            .get_mut(&ClientName(RECEIVER.into()))
            .unwrap();
        receiver.alive = false;
        live.events.push(Event {
            at,
            fact: if close {
                Fact::Closed {
                    client: ClientName(RECEIVER.into()),
                    session: receiver.session,
                }
            } else {
                Fact::Crashed {
                    client: ClientName(RECEIVER.into()),
                }
            },
        });
        live.events.sort_by_key(|event| event.at);
        assert_stale_receiver(&live);
    }
    let mut moved = outcome.clone();
    moved.events.retain(|event| !terminal_status(event));
    let mut opened = moved
        .events
        .iter()
        .find(|event| matches!(&event.fact, Fact::Opened { client, .. } if client.0 == RECEIVER))
        .unwrap()
        .clone();
    opened.at = at;
    if let Fact::Opened { doc, session, .. } = &mut opened.fact {
        *doc = DocIx(1);
        *session = doc_sync_core::SessionId(uuid_value::Uuid::from_u128(900));
    }
    moved
        .finals
        .clients
        .get_mut(&ClientName(RECEIVER.into()))
        .unwrap()
        .doc = DocIx(1);
    moved.events.push(opened);
    moved.events.sort_by_key(|event| event.at);
    assert_stale_receiver(&moved);
}

#[test]
fn a_previous_incarnations_terminal_status_does_not_end_the_next_epoch() {
    let mut outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    let terminal = outcome
        .events
        .iter()
        .find(|event| terminal_status(event))
        .unwrap()
        .clone();
    let mut opened = outcome
        .events
        .iter()
        .find(|event| matches!(&event.fact, Fact::Opened { client, .. } if client.0 == RECEIVER))
        .unwrap()
        .clone();
    opened.at = terminal.at;
    if let Fact::Opened { session, .. } = &mut opened.fact {
        *session = doc_sync_core::SessionId(uuid_value::Uuid::from_u128(901));
    }
    let mut stale = outcome
        .events
        .iter()
        .rev()
        .find(|event| {
            event.at <= terminal.at
                && matches!(&event.fact, Fact::PresenceChanged { client, remote }
            if client.0 == RECEIVER && !remote.is_empty())
        })
        .unwrap()
        .clone();
    stale.at = terminal.at;
    let index = outcome.events.iter().position(terminal_status).unwrap() + 1;
    outcome.events.splice(index..index, [opened, stale]);
    assert_stale_receiver(&outcome);
}

#[test]
fn closing_another_incarnation_cannot_end_the_observed_receiver_epoch() {
    let mut outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    for event in &mut outcome.events {
        if terminal_status(event) {
            event.fact = Fact::Closed {
                client: ClientName(RECEIVER.into()),
                session: doc_sync_core::SessionId(uuid_value::Uuid::from_u128(902)),
            };
        }
    }
    assert_stale_receiver(&outcome);
}

#[test]
fn a_frozen_epoch_ends_on_terminal_or_open_and_expires_on_actual_thaw() {
    let outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    let deadline = deadline(&outcome);
    let terminal = outcome
        .events
        .iter()
        .find(|event| terminal_status(event))
        .unwrap()
        .clone();
    let mut frozen = outcome.clone();
    frozen.events.retain(|event| !terminal_status(event));
    frozen.events.push(Event {
        at: Millis(deadline.0 - 1),
        fact: Fact::Frozen {
            client: ClientName(RECEIVER.into()),
        },
    });
    frozen.events.sort_by_key(|event| event.at);
    // Settlement already contains a real Thawed observation; it must expose
    // this synthetic stale receiver. Remove it only for the no-thaw control.
    assert_stale_receiver(&frozen);
    frozen.events.retain(|event| {
        !(event.at > deadline
            && matches!(&event.fact, Fact::Thawed { client } if client.0 == RECEIVER))
    });
    invariants::presence_expires(&frozen).unwrap();
    frozen.events.push(Event {
        at: Millis(deadline.0 + 100),
        fact: Fact::Thawed {
            client: ClientName(RECEIVER.into()),
        },
    });
    frozen.events.sort_by_key(|event| event.at);
    assert_stale_receiver(&frozen);

    let mut opened = outcome
        .events
        .iter()
        .find(|event| matches!(&event.fact, Fact::Opened { client, .. } if client.0 == RECEIVER))
        .unwrap()
        .clone();
    if let Fact::Opened { session, .. } = &mut opened.fact {
        *session = doc_sync_core::SessionId(uuid_value::Uuid::from_u128(903));
    }
    for fact in [terminal.fact.clone(), opened.fact] {
        let mut ended = frozen.clone();
        ended.events.push(Event {
            at: Millis(deadline.0 + 50),
            fact,
        });
        ended.events.sort_by_key(|event| event.at);
        invariants::presence_expires(&ended).unwrap();
    }
    let mut offline = frozen;
    let mut event = terminal;
    event.at = Millis(deadline.0 + 50);
    if let Fact::Status { status, .. } = &mut event.fact {
        status.connection = ConnectionStatus::Offline;
    }
    offline.events.push(event);
    offline.events.sort_by_key(|event| event.at);
    assert_stale_receiver(&offline);
}

#[test]
fn same_time_reopen_cannot_hide_stale_presence_at_the_actual_thaw() {
    let outcome = terminal_receiver();
    invariants::presence_expires(&outcome).unwrap();
    let deadline = deadline(&outcome);
    let receiver = ClientName(RECEIVER.into());
    let mut frozen = outcome.clone();
    frozen.events.retain(|event| !terminal_status(event));
    frozen.events.push(Event {
        at: Millis(deadline.0 - 1),
        fact: Fact::Frozen {
            client: receiver.clone(),
        },
    });
    let thaw_at = Millis(deadline.0 + 100);
    frozen.events.push(Event {
        at: thaw_at,
        fact: Fact::Thawed {
            client: receiver.clone(),
        },
    });
    frozen.events.sort_by_key(|event| event.at);
    assert_stale_receiver(&frozen);
    // Synthetic clearing after thaw satisfies this incarnation in the oracle.
    let mut cleared = frozen.clone();
    let clear = Event {
        at: thaw_at,
        fact: Fact::PresenceChanged {
            client: receiver,
            remote: Default::default(),
        },
    };
    cleared.events.push(clear.clone());
    cleared.events.sort_by_key(|event| event.at);
    invariants::presence_expires(&cleared).unwrap();

    let mut opened = outcome
        .events
        .iter()
        .find(|event| matches!(&event.fact, Fact::Opened { client, .. } if client.0 == RECEIVER))
        .unwrap()
        .clone();
    opened.at = thaw_at;
    if let Fact::Opened { session, .. } = &mut opened.fact {
        *session = doc_sync_core::SessionId(uuid_value::Uuid::from_u128(904));
    }
    // This empty view belongs to a new session, not to the old thaw tick.
    frozen.events.extend([opened, clear]);
    frozen.events.sort_by_key(|event| event.at);
    assert_stale_receiver(&frozen);
}
