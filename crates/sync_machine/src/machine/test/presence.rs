use crate::machine::DocMachine;
use crate::model::{Capabilities, ClientFrame, ConnId, Effect, Input, ServerFrame};
use crate::replica::mock::MockReplica;
use macro_user_id::user_id::MacroUserIdStr;

const C1: ConnId = ConnId(1);
const C2: ConnId = ConnId(2);

/// A machine with C1 attached (edit capabilities) and loaded from `b"base"`.
fn ready_machine() -> DocMachine<MockReplica> {
    let mut machine = DocMachine::new();
    machine.handle(Input::PeerAttached {
        conn: C1,
        capabilities: Capabilities {
            can_edit: true,
            user_id: Some(MacroUserIdStr::try_from("macro|user-1@test.com".to_string()).unwrap()),
        },
    });
    machine.handle(Input::Loaded {
        snapshot: Some(b"base".to_vec()),
        snapshot_seq: 0,
        ops: Vec::new(),
    });
    machine
}

#[test]
fn presence_rebroadcasts_and_feeds_initial_sync() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::Presence {
                payload: b"cursor@3".to_vec(),
            },
        })
        .actions;
    assert_eq!(
        actions,
        vec![Effect::Broadcast {
            except: C1,
            frame: ServerFrame::Presence {
                payload: b"cursor@3".to_vec()
            }
        }]
    );

    // A later attach sees the merged presence in its initial sync (the mock
    // encodes its store as presence[...]).
    let actions = machine
        .handle(Input::PeerAttached {
            conn: C2,
            capabilities: Capabilities {
                can_edit: false,
                user_id: None,
            },
        })
        .actions;
    assert!(matches!(
        &actions[0],
        Effect::Send {
            frame: ServerFrame::InitialSync { presence, .. },
            ..
        } if presence == &b"presence[cursor@3]".to_vec()
    ));
}

#[test]
fn detach_broadcasts_a_presence_removal_delta_for_registered_peers() {
    let mut machine = ready_machine();
    machine.handle(Input::PeerAttached {
        conn: C2,
        capabilities: Capabilities {
            can_edit: false,
            user_id: None,
        },
    });
    machine.handle(Input::Frame {
        conn: C1,
        frame: ClientFrame::RegisterPeer { peer_id: 7 },
    });

    let outcome = machine.handle(Input::PeerDetached { conn: C1 });
    let actions = &outcome.actions;
    assert!(actions.iter().any(|action| matches!(
        action,
        Effect::Broadcast {
            except: ConnId(1),
            frame: ServerFrame::Presence { payload }
        } if payload == &b"left[7]".to_vec()
    )));
    // C2 is still attached: no LastLeave, no idle timer.
    assert_eq!(outcome.lifecycle, None);
    assert!(
        !actions
            .iter()
            .any(|action| matches!(action, Effect::ScheduleTimer { .. }))
    );
}
