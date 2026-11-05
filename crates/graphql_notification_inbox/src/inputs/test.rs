use super::*;

#[test]
fn inbox_input_defaults_to_every_row_type() {
    let query = NotificationInboxInput::default().into_query().unwrap();
    assert!(query.scope.row_types.is_empty());
    assert_eq!(query.limit, 50);
    assert!(query.after.is_none());
}

#[test]
fn inbox_input_rejects_bad_limits_and_cursors() {
    let too_many = NotificationInboxInput {
        limit: Some(101),
        ..Default::default()
    };
    assert!(too_many.into_query().is_err());

    let bad_cursor = NotificationInboxInput {
        cursor: Some("not a cursor".to_string()),
        ..Default::default()
    };
    assert!(bad_cursor.into_query().is_err());
}

#[test]
fn scope_input_maps_row_types() {
    let scope = NotificationInboxScopeInput {
        row_types: Some(vec![
            GraphqlNotificationInboxRowType::Agent,
            GraphqlNotificationInboxRowType::ChannelThread,
        ]),
    }
    .into_scope();
    assert_eq!(
        scope.row_types,
        vec![InboxRowType::Agent, InboxRowType::ChannelThread]
    );
}

const ROW: &str = "channel:11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa#top_level";

#[test]
fn done_input_parses_row_ids_and_revisions() {
    let revision = FeedRevision::default().encode();
    let targets = MarkNotificationInboxRowsDoneInput {
        rows: vec![NotificationInboxRowTargetInput {
            id: ID(ROW.to_string()),
            revision: Some(revision),
        }],
    }
    .into_targets()
    .unwrap();
    assert_eq!(targets[0].id.slot, "top_level");
    assert_eq!(targets[0].revision, Some(FeedRevision::default()));

    let bad_id = MarkNotificationInboxRowsDoneInput {
        rows: vec![NotificationInboxRowTargetInput {
            id: ID("channel:x".to_string()),
            revision: None,
        }],
    };
    assert!(bad_id.into_targets().is_err());

    let too_many = MarkNotificationInboxRowsDoneInput {
        rows: (0..=MAX_INBOX_ROWS)
            .map(|_| NotificationInboxRowTargetInput {
                id: ID(ROW.to_string()),
                revision: None,
            })
            .collect(),
    };
    assert!(too_many.into_targets().is_err());
}

#[test]
fn seen_input_is_capped() {
    let too_many = MarkNotificationInboxRowsSeenInput {
        row_ids: (0..=MAX_INBOX_ROWS).map(|_| ID(ROW.to_string())).collect(),
        scope: None,
    };
    assert!(too_many.into_rows().is_err());
}
