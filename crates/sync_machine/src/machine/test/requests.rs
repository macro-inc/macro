use crate::machine::DocMachine;
use crate::model::{Capabilities, ClientFrame, ConnId, Effect, Input, ServerFrame};
use crate::replica::mock::MockReplica;
use macro_user_id::user_id::MacroUserIdStr;

const C1: ConnId = ConnId(1);

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
fn request_since_echoes_the_callers_cursor_verbatim() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::RequestSince {
                cursor: b"vv-bytes".to_vec(),
            },
        })
        .actions;
    assert_eq!(
        actions,
        vec![Effect::Send {
            conn: C1,
            frame: ServerFrame::Since {
                update: b"diff-since[vv-bytes]".to_vec(),
                cursor: b"vv-bytes".to_vec(),
            }
        }]
    );
}

#[test]
fn register_peer_records_the_user_mapping_once() {
    let mut machine = ready_machine();
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::RegisterPeer { peer_id: 42 },
        })
        .actions;
    assert_eq!(
        actions,
        vec![Effect::RecordPeerMapping {
            peer_id: 42,
            user_id: MacroUserIdStr::try_from("macro|user-1@test.com".to_string()).unwrap(),
        }]
    );
    // Duplicate registration is a no-op.
    let actions = machine
        .handle(Input::Frame {
            conn: C1,
            frame: ClientFrame::RegisterPeer { peer_id: 42 },
        })
        .actions;
    assert!(actions.is_empty());
}
