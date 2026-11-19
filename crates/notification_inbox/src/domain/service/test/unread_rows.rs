use std::collections::HashMap;

use super::*;

/// Every key the harness's source and notifications know, as the keys that
/// may hold an unread row, with one that is in no feed.
fn may_be_unread(harness: &Harness) {
    let mut keys: Vec<Entity<'static>> = harness
        .source
        .items
        .lock()
        .unwrap()
        .iter()
        .map(|candidate| candidate.key.clone())
        .collect();
    keys.push(entity(EntityType::Document, 0xDEAD));
    *harness.source.unread.lock().unwrap() = keys;
}

/// The kinds of the rows an unread page of the whole inbox lists.
async fn listed_unread(harness: &Harness) -> HashMap<InboxRowType, u32> {
    let page = harness
        .service
        .page(viewer(), unread_query(50, None))
        .await
        .unwrap();
    assert!(page.next.is_none(), "one page holds the test's inbox");
    let mut counts = HashMap::new();
    for row in page.entries.iter().flat_map(|entry| &entry.rows) {
        *counts.entry(row.row_type).or_default() += 1;
    }
    counts
}

#[tokio::test]
async fn unread_rows_are_the_rows_an_unread_inbox_lists() {
    for harness in [inbox(), mostly_read()] {
        may_be_unread(&harness);
        let unread = harness.service.unread_rows(viewer()).await.unwrap();

        assert_eq!(unread.counts(), listed_unread(&harness).await);
        assert!(unread.more.is_empty());
    }
}

#[tokio::test]
async fn unread_rows_follow_each_rows_own_rule() {
    let harness = mostly_read();
    may_be_unread(&harness);
    let unread = harness.service.unread_rows(viewer()).await.unwrap();

    // The channel's thread and the document's task were read; mail follows
    // its thread's read state, not its notification's.
    assert_eq!(
        unread.counts(),
        HashMap::from([(InboxRowType::ChannelMessages, 1), (InboxRowType::Email, 1),])
    );
}

#[tokio::test]
async fn an_inbox_with_nothing_unseen_reads_no_group() {
    let harness = inbox();
    let unread = harness.service.unread_rows(viewer()).await.unwrap();

    assert_eq!(unread, UnreadRows::default());
    assert!(harness.source.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_recount_reads_only_the_groups_that_changed() {
    let harness = inbox();
    may_be_unread(&harness);
    let unread = harness.service.unread_rows(viewer()).await.unwrap();
    assert_eq!(
        unread.counts(),
        HashMap::from([
            (InboxRowType::ChannelMessages, 1),
            (InboxRowType::ChannelMention, 1),
            (InboxRowType::Email, 1),
        ])
    );
    harness.source.requests.lock().unwrap().clear();

    harness
        .service
        .mark_seen(
            viewer(),
            InboxScope::default(),
            vec![row(&channel(), &thread_slot())],
        )
        .await
        .unwrap();
    harness.source.requests.lock().unwrap().clear();
    let unread = harness
        .service
        .recount_unread_rows(viewer(), unread, vec![channel()])
        .await
        .unwrap();

    assert_eq!(
        unread.counts(),
        HashMap::from([(InboxRowType::ChannelMessages, 1), (InboxRowType::Email, 1),])
    );
    let requests = harness.source.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].only, Some(vec![channel().into_entity()]));
    assert_eq!(*harness.source.unread_reads.lock().unwrap(), 1);
}

#[tokio::test]
async fn a_recount_adds_a_group_that_became_unread_and_drops_one_that_is_gone() {
    let harness = mostly_read();
    may_be_unread(&harness);
    let unread = harness.service.unread_rows(viewer()).await.unwrap();
    let doc = key(entity(EntityType::Document, DOC));

    harness
        .notifications
        .by_entity
        .lock()
        .unwrap()
        .get_mut(doc.entity())
        .unwrap()
        .push(notification(
            8,
            entity(EntityType::Document, DOC),
            "task_assigned",
            json!({ "taskId": "task-2", "assignedBy": "macro|other@example.com", "taskName": "Next" }),
            11,
            NotificationState::Unseen,
        ));
    harness
        .source
        .items
        .lock()
        .unwrap()
        .retain(|candidate| candidate.key != channel().into_entity());
    let unread = harness
        .service
        .recount_unread_rows(viewer(), unread, vec![doc, channel()])
        .await
        .unwrap();

    assert_eq!(
        unread.counts(),
        HashMap::from([(InboxRowType::Task, 1), (InboxRowType::Email, 1)])
    );
}

#[tokio::test]
async fn counting_stops_once_an_entity_type_holds_enough_unread_rows() {
    let harness = many_documents(250);
    may_be_unread(&harness);
    let unread = harness.service.unread_rows(viewer()).await.unwrap();

    assert_eq!(unread.counts(), HashMap::from([(InboxRowType::Task, 100)]));
    assert!(unread.more.contains(&EntityType::Document));
    let read: usize = harness
        .source
        .requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| request.only.as_ref().map_or(0, Vec::len))
        .sum();
    assert_eq!(read, 100, "the other 150 documents were never read");
}

#[tokio::test]
async fn a_count_that_falls_back_under_enough_counts_everything_again() {
    let harness = many_documents(250);
    may_be_unread(&harness);
    let unread = harness.service.unread_rows(viewer()).await.unwrap();
    let counted = unread
        .groups
        .keys()
        .next()
        .cloned()
        .expect("a counted document");

    // The viewer reads one of the counted documents.
    harness
        .notifications
        .by_entity
        .lock()
        .unwrap()
        .get_mut(counted.entity())
        .unwrap()
        .iter_mut()
        .for_each(|notification| {
            std::sync::Arc::make_mut(notification).state = NotificationState::Seen;
        });
    harness
        .source
        .unread
        .lock()
        .unwrap()
        .retain(|key| key != counted.entity());
    let unread = harness
        .service
        .recount_unread_rows(viewer(), unread, vec![counted.clone()])
        .await
        .unwrap();

    assert_eq!(
        unread.counts(),
        HashMap::from([(InboxRowType::Task, 100)]),
        "documents left unread before now make up the count"
    );
    assert!(!unread.groups.contains_key(&counted));
    assert_eq!(*harness.source.unread_reads.lock().unwrap(), 2);
}
