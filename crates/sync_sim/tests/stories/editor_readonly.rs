use super::*;

#[test]
fn revoked_editor_retains_exact_private_rows_and_delivers_after_regrant() {
    let config = SimConfig::editor(827);
    let mut script = vec![
        Step::Open(OpenSpec::form("writer", "one")),
        Step::Open(OpenSpec::form("reader", "two")),
        Step::Settle,
        Step::Net(NetStep::Partition(ClientName("writer".into()))),
        Step::Edit {
            client: ClientName("writer".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "private🦀".into(),
            }),
        },
        Step::Run(Millis(100)),
        Step::Grant {
            client: ClientName("writer".into()),
            access: Access::Read,
            force_reconnect: true,
        },
        Step::Settle,
    ];
    let parked = verify(config.clone(), &script);
    let writer = &parked.finals.clients[&ClientName("writer".into())];
    assert_eq!(writer.access, Access::Read);
    assert_eq!(
        writer.status.save,
        doc_sync_core::SaveState::Unsaved(doc_sync_core::UnsavedReason::ReadOnly)
    );
    assert!(writer.parked.iter().any(|(_, reason)| reason == "ReadOnly"));
    assert_ne!(
        writer.editor.as_ref().unwrap().synced_json,
        parked.finals.clients[&ClientName("reader".into())]
            .editor
            .as_ref()
            .unwrap()
            .synced_json
    );
    let revoked = parked
        .events
        .iter()
        .position(|event| {
            matches!(&event.fact,
        Fact::AccessChanged { client, access: Access::Read } if client.0 == "writer")
        })
        .unwrap();
    assert!(
        !parked.events[revoked..]
            .iter()
            .any(|event| matches!(&event.fact,
        Fact::PushSent { client, .. } if client.0 == "writer"))
    );
    let row = parked.finals.profiles[&ProfileName("one".into())]
        .entries
        .iter()
        .find(|(_, row)| !row.delivered && !row.record.quarantined)
        .unwrap()
        .0
        .clone();
    let mut lost = parked.clone();
    lost.finals
        .profiles
        .get_mut(&ProfileName("one".into()))
        .unwrap()
        .entries
        .remove(&row);
    assert!(invariants::no_edit_lost_without_crash(&lost).is_err());
    assert!(invariants::editor_states_equal(&lost).is_err());
    let mut poison = parked.clone();
    poison
        .finals
        .profiles
        .get_mut(&ProfileName("one".into()))
        .unwrap()
        .entries
        .get_mut(&row)
        .unwrap()
        .record
        .quarantined = true;
    assert!(invariants::no_edit_lost_without_crash(&poison).is_err());
    assert!(invariants::editor_states_equal(&poison).is_err());
    let mut delivered = parked.clone();
    delivered
        .finals
        .profiles
        .get_mut(&ProfileName("one".into()))
        .unwrap()
        .entries
        .get_mut(&row)
        .unwrap()
        .delivered = true;
    assert!(invariants::no_edit_lost_without_crash(&delivered).is_err());
    assert!(invariants::editor_states_equal(&delivered).is_err());
    let mut unparked = parked.clone();
    for event in &mut unparked.events {
        if let Fact::RowsParked { client, rows } = &mut event.fact
            && client.0 == "writer"
        {
            rows.clear();
        }
    }
    assert!(invariants::no_edit_lost_without_crash(&unparked).is_err());
    assert!(invariants::editor_states_equal(&unparked).is_err());
    let mut relabeled_row = parked.clone();
    relabeled_row
        .finals
        .profiles
        .get_mut(&ProfileName("one".into()))
        .unwrap()
        .entries
        .get_mut(&row)
        .unwrap()
        .record
        .user
        .0 = "other-user".into();
    assert!(invariants::no_edit_lost_without_crash(&relabeled_row).is_err());
    assert!(invariants::editor_states_equal(&relabeled_row).is_err());
    let mut wrong_user = parked.clone();
    wrong_user
        .finals
        .clients
        .get_mut(&ClientName("writer".into()))
        .unwrap()
        .user = "other-user".into();
    assert!(invariants::editor_states_equal(&wrong_user).is_err());
    let mut bad_projection = parked.clone();
    bad_projection
        .finals
        .clients
        .get_mut(&ClientName("writer".into()))
        .unwrap()
        .editor
        .as_mut()
        .unwrap()
        .synced_json = serde_json::json!({"invalid":true});
    assert!(invariants::projection_consistent(&bad_projection).is_err());
    script.extend([
        Step::Grant {
            client: ClientName("writer".into()),
            access: Access::Edit,
            force_reconnect: true,
        },
        Step::Settle,
    ]);
    let delivered = verify(config, &script);
    let writer = &delivered.finals.clients[&ClientName("writer".into())];
    assert_eq!(writer.wal_total, 0);
    assert_eq!(writer.status.save, doc_sync_core::SaveState::Saved);
    assert!(
        delivered.finals.servers[&DocIx(0)]
            .deep_value
            .to_string()
            .contains("private🦀")
    );
    let mut lost_server = delivered.clone();
    lost_server
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_edit_lost_without_crash(&lost_server).is_err());
    assert!(invariants::no_acked_edit_lost(&lost_server).is_err());
}
