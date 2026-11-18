use super::*;
use model::item::Item;
use sqlx::{Pool, Postgres};

const OWNER: &str = "macro|large@example.com";

fn item_ids(items: &[Item]) -> Vec<String> {
    items
        .iter()
        .map(|i| match i {
            Item::Chat(c) => c.id.clone(),
            Item::Document(d) => d.document_id.clone(),
            Item::Project(p) => p.id.clone(),
        })
        .collect()
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("recently_deleted_large")))]
async fn a_large_trash_pages_through_items_trashed_together(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let first = get_recently_deleted(&pool, OWNER, None, 10).await?;

    // The newest trash comes first whatever its type. Then the folder trash
    // put 35 items on one timestamp: the page stops partway into them,
    // highest id first, and says where to continue.
    assert_eq!(
        item_ids(&first.items),
        vec![
            "chat-newest",
            "folder-05",
            "folder-04",
            "folder-03",
            "folder-02",
            "folder-01",
            "doc-25",
            "doc-24",
            "doc-23",
            "doc-22",
        ]
    );
    assert_eq!(
        first.next,
        Some(TrashPosition {
            deleted_at: "2026-11-10T12:00:00Z".parse()?,
            id: "doc-22".to_string(),
        })
    );

    let second = get_recently_deleted(&pool, OWNER, first.next.as_ref(), 10).await?;
    assert_eq!(
        item_ids(&second.items),
        vec![
            "doc-21", "doc-20", "doc-19", "doc-18", "doc-17", "doc-16", "doc-15", "doc-14",
            "doc-13", "doc-12",
        ]
    );

    let third = get_recently_deleted(&pool, OWNER, second.next.as_ref(), 10).await?;
    assert_eq!(
        item_ids(&third.items),
        vec![
            "doc-11", "doc-10", "doc-09", "doc-08", "doc-07", "doc-06", "doc-05", "doc-04",
            "doc-03", "doc-02",
        ]
    );

    // The chats sort after the documents inside the tie, then the older
    // trash follows by time; the live document and another owner's trash
    // never appear.
    let last = get_recently_deleted(&pool, OWNER, third.next.as_ref(), 10).await?;
    assert_eq!(
        item_ids(&last.items),
        vec![
            "doc-01",
            "chat-05",
            "chat-04",
            "chat-03",
            "chat-02",
            "chat-01",
            "doc-older",
            "folder-oldest",
        ]
    );
    assert_eq!(last.next, None);

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("recently_deleted_large")))]
async fn a_trash_that_exactly_fills_the_page_has_no_next_page(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let page = get_recently_deleted(&pool, OWNER, None, 38).await?;

    assert_eq!(page.items.len(), 38);
    assert_eq!(page.next, None);

    Ok(())
}
