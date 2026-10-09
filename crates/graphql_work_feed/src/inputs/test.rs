use super::*;

#[test]
fn feed_input_defaults_to_the_whole_work_feed() {
    let query = WorkFeedInput::default().into_query().unwrap();
    assert_eq!(query.scope.mode, WorkFeedMode::Work);
    assert!(query.scope.types.is_empty());
    assert!(!query.scope.include_snippets);
    assert_eq!(query.limit, 50);
    assert!(query.after.is_none());
}

#[test]
fn feed_input_rejects_bad_limits_and_cursors() {
    let too_many = WorkFeedInput {
        limit: Some(101),
        ..Default::default()
    };
    assert!(too_many.into_query().is_err());

    let bad_cursor = WorkFeedInput {
        cursor: Some("not a cursor".to_string()),
        ..Default::default()
    };
    assert!(bad_cursor.into_query().is_err());
}

#[test]
fn scope_input_maps_types_and_mode() {
    let scope = WorkFeedScopeInput {
        mode: Some(GraphqlWorkFeedMode::Attention),
        types: Some(vec![
            GraphqlWorkFeedItemType::ChannelThread,
            GraphqlWorkFeedItemType::PullRequest,
        ]),
        include_snippets: Some(true),
    }
    .into_scope();
    assert_eq!(scope.mode, WorkFeedMode::Attention);
    assert_eq!(
        scope.types,
        vec![
            WorkFeedItemType::ChannelThread,
            WorkFeedItemType::PullRequest
        ]
    );
    assert!(scope.include_snippets);
}

#[test]
fn done_input_parses_ids_and_revisions() {
    let revision = WorkFeedRevision::default().encode();
    let targets = MarkWorkFeedItemsDoneInput {
        items: vec![WorkFeedDoneItemInput {
            id: ID("document:11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string()),
            revision: Some(revision),
        }],
    }
    .into_targets()
    .unwrap();
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].revision, Some(WorkFeedRevision::default()));

    let bad_id = MarkWorkFeedItemsDoneInput {
        items: vec![WorkFeedDoneItemInput {
            id: ID("nope".to_string()),
            revision: None,
        }],
    };
    assert!(bad_id.into_targets().is_err());

    let too_many = MarkWorkFeedItemsDoneInput {
        items: (0..=MAX_DONE_ITEMS)
            .map(|_| WorkFeedDoneItemInput {
                id: ID("document:x".to_string()),
                revision: None,
            })
            .collect(),
    };
    assert!(too_many.into_targets().is_err());
}
