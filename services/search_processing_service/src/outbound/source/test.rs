use super::*;

fn uuid(n: u128) -> uuid::Uuid {
    uuid::Uuid::from_u128(n)
}

fn thread_ids(page: &SourcePage) -> Vec<Vec<String>> {
    page.messages
        .iter()
        .map(|message| match message {
            SearchQueueMessage::ExtractEmailThreadBatch(batch) => batch.thread_ids.clone(),
            other => panic!("unexpected message: {other:?}"),
        })
        .collect()
}

#[test]
fn page_of_walks_the_id_list() {
    let ids: Vec<uuid::Uuid> = (0..5).map(uuid).collect();

    assert_eq!(page_of(&ids, 0, 2), &ids[0..2]);
    assert_eq!(page_of(&ids, 2, 2), &ids[2..4]);
    assert_eq!(page_of(&ids, 4, 2), &ids[4..5]);
}

#[test]
fn page_of_is_empty_past_the_end() {
    let ids: Vec<uuid::Uuid> = (0..3).map(uuid).collect();

    assert!(page_of(&ids, 3, 10).is_empty());
    assert!(page_of(&ids, 99, 10).is_empty());
}

#[test]
fn page_of_clamps_a_limit_beyond_the_end() {
    let ids: Vec<uuid::Uuid> = (0..3).map(uuid).collect();

    assert_eq!(page_of(&ids, 0, 100), &ids[..]);
}

#[test]
fn groups_threads_by_owner() {
    let page = email_source_page(
        vec![
            (uuid(1), "macro|a@example.com".into()),
            (uuid(2), "macro|b@example.com".into()),
            (uuid(3), "macro|a@example.com".into()),
        ],
        50,
        3,
        None,
    );

    assert_eq!(page.rows_consumed, 3);
    let mut sizes: Vec<usize> = thread_ids(&page).iter().map(Vec::len).collect();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![1, 2]);
}

#[test]
fn chunks_each_owner_at_the_batch_size() {
    let rows: Vec<(uuid::Uuid, String)> = (0..120)
        .map(|n| (uuid(n), "macro|a@example.com".to_string()))
        .collect();

    let page = email_source_page(rows, 50, 120, None);

    let mut sizes: Vec<usize> = thread_ids(&page).iter().map(Vec::len).collect();
    sizes.sort_unstable();
    assert_eq!(sizes, vec![20, 50, 50]);
    assert_eq!(page.rows_consumed, 120);
}

#[test]
fn rows_consumed_is_independent_of_rows_found() {
    // Unknown ids resolve to nothing; the loop still has to advance past them.
    let page = email_source_page(vec![(uuid(1), "macro|a@example.com".into())], 50, 10, None);

    assert_eq!(page.rows_consumed, 10);
    assert_eq!(thread_ids(&page), vec![vec![uuid(1).to_string()]]);
}

#[test]
fn carries_the_index_override() {
    let page = email_source_page(
        vec![(uuid(1), "macro|a@example.com".into())],
        50,
        1,
        Some("emails_v2"),
    );

    match &page.messages[0] {
        SearchQueueMessage::ExtractEmailThreadBatch(batch) => {
            assert_eq!(batch.index_override.as_deref(), Some("emails_v2"));
        }
        other => panic!("unexpected message: {other:?}"),
    }
}
