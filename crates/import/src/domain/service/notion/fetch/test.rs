use super::*;
use crate::domain::models::NotionOwner;
use crate::domain::service::notion::test::{FakeNotion, FakeWorkspace, block, nid, plain};

fn parent(n: u32, kind: NotionBlockKind) -> NotionBlock {
    NotionBlock {
        has_children: true,
        ..block(n, kind)
    }
}

#[tokio::test]
async fn reads_nested_children_across_cursor_pages_and_follows_synced_copies() {
    let mut workspace = FakeWorkspace::with_pages(NotionOwner::NotAUser, Vec::new());
    workspace.children.insert(
        nid(1),
        vec![
            parent(10, NotionBlockKind::BulletedListItem(plain("a"))),
            block(11, NotionBlockKind::Paragraph(plain("b"))),
            parent(12, NotionBlockKind::SyncedBlock { synced_from: None }),
            parent(
                13,
                NotionBlockKind::SyncedBlock {
                    synced_from: Some(nid(12)),
                },
            ),
            parent(
                14,
                NotionBlockKind::ChildPage {
                    title: "Sub".into(),
                },
            ),
            parent(
                15,
                NotionBlockKind::SyncedBlock {
                    synced_from: Some(nid(99)),
                },
            ),
        ],
    );
    workspace.children.insert(
        nid(10),
        vec![block(20, NotionBlockKind::BulletedListItem(plain("a.1")))],
    );
    workspace.children.insert(
        nid(12),
        vec![block(21, NotionBlockKind::Paragraph(plain("shared")))],
    );
    let notion = FakeNotion::new(workspace);

    let tree = fetch_tree(&notion, &nid(1)).await.unwrap();

    assert!(!tree.truncated);
    assert_eq!(tree.blocks.len(), 6);
    assert_eq!(tree.blocks[0].children[0].id, nid(20));
    // The copy renders the original's children.
    assert_eq!(tree.blocks[3].children, tree.blocks[2].children);
    // Child pages are pages of their own; an unreadable original is empty.
    assert!(tree.blocks[4].children.is_empty());
    assert!(tree.blocks[5].children.is_empty());
}

#[tokio::test]
async fn stops_at_the_depth_bound() {
    let mut workspace = FakeWorkspace::with_pages(NotionOwner::NotAUser, Vec::new());
    // A chain of nested bullets, one deeper than allowed.
    for depth in 0..=MAX_DEPTH as u32 {
        workspace.children.insert(
            nid(100 + depth),
            vec![parent(
                101 + depth,
                NotionBlockKind::BulletedListItem(plain("level")),
            )],
        );
    }
    let notion = FakeNotion::new(workspace);

    let tree = fetch_tree(&notion, &nid(100)).await.unwrap();

    assert!(tree.truncated);
    let mut depth = 0;
    let mut level = &tree.blocks;
    while let Some(first) = level.first() {
        depth += 1;
        level = &first.children;
    }
    assert_eq!(depth, MAX_DEPTH);
}

#[tokio::test]
async fn stops_at_the_block_bound() {
    let mut workspace = FakeWorkspace::with_pages(NotionOwner::NotAUser, Vec::new());
    // 45 sections of 50 bullets: more than the bound allows.
    workspace.children.insert(
        nid(1),
        (0..45)
            .map(|n| parent(10 + n, NotionBlockKind::Toggle(plain("section"))))
            .collect(),
    );
    for n in 0..45 {
        workspace.children.insert(
            nid(10 + n),
            (0..50)
                .map(|m| block(10_000 + n * 100 + m, NotionBlockKind::Paragraph(plain("x"))))
                .collect(),
        );
    }
    let notion = FakeNotion::new(workspace);

    let tree = fetch_tree(&notion, &nid(1)).await.unwrap();

    fn count(blocks: &[NotionBlock]) -> usize {
        blocks.iter().map(|block| 1 + count(&block.children)).sum()
    }
    assert!(tree.truncated);
    assert_eq!(count(&tree.blocks), MAX_BLOCKS);
}

#[tokio::test(start_paused = true)]
async fn stops_reading_when_its_time_is_up() {
    let mut workspace = FakeWorkspace::with_pages(NotionOwner::NotAUser, Vec::new());
    // 40 toggles behind slow reads: more than the read budget allows.
    workspace.children.insert(
        nid(1),
        (0..40)
            .map(|n| parent(10 + n, NotionBlockKind::Toggle(plain("section"))))
            .collect(),
    );
    for n in 0..40 {
        workspace.children.insert(
            nid(10 + n),
            vec![block(1_000 + n, NotionBlockKind::Paragraph(plain("x")))],
        );
    }
    workspace.read_delay = std::time::Duration::from_secs(2);
    let notion = FakeNotion::new(workspace);

    let started = Instant::now();
    let tree = fetch_tree(&notion, &nid(1)).await.unwrap();

    assert!(tree.truncated);
    assert!(started.elapsed() <= READ_BUDGET + std::time::Duration::from_secs(2));
    assert_eq!(tree.blocks.len(), 40, "blocks already read are kept");
    assert!(!tree.blocks[0].children.is_empty());
    assert!(tree.blocks[39].children.is_empty());
}
