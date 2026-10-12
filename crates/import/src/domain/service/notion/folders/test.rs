use super::*;
use crate::domain::models::{NotionContainer, NotionOwner};
use crate::domain::service::notion::test::{FakeNotion, FakeWorkspace, nid, page};

fn ancestry(nodes: &[(u32, &str, Option<u32>)]) -> Ancestry {
    Ancestry {
        nodes: nodes
            .iter()
            .map(|(id, name, parent)| {
                (
                    nid(*id),
                    Ancestor {
                        name: name.to_string(),
                        parent: parent.map(nid),
                    },
                )
            })
            .collect(),
    }
}

fn names(plan: &HashMap<NotionId, Vec<FolderSpec>>, page: u32) -> Vec<&str> {
    plan[&nid(page)]
        .iter()
        .map(|spec| spec.name.as_str())
        .collect()
}

#[test]
fn only_branches_leading_to_imported_pages_become_folders() {
    // Home ─┬─ Plan (imported) ── Checklist (imported)
    //       └─ Projects (database) ── Row (imported)
    // Loose (imported, top level)
    let tree = ancestry(&[
        (1, "🏠 Home", None),
        (2, "Plan", Some(1)),
        (3, "Checklist", Some(2)),
        (4, "📁 Projects", Some(1)),
        (5, "Row", Some(4)),
        (6, "Loose", None),
    ]);
    let plan = plan_folders(&[nid(2), nid(3), nid(5), nid(6)], &tree);

    // A page with imported descendants is a folder holding its own doc.
    assert_eq!(names(&plan, 2), ["🏠 Home", "Plan"]);
    assert_eq!(names(&plan, 3), ["🏠 Home", "Plan"]);
    // A database is a folder holding its rows.
    assert_eq!(names(&plan, 5), ["🏠 Home", "📁 Projects"]);
    // A top-level page with nothing below it goes in the root.
    assert!(plan[&nid(6)].is_empty());
}

#[test]
fn deep_chains_attach_at_the_fourth_level() {
    let tree = ancestry(&[
        (1, "L1", None),
        (2, "L2", Some(1)),
        (3, "L3", Some(2)),
        (4, "L4", Some(3)),
        (5, "L5", Some(4)),
        (6, "Deep", Some(5)),
    ]);
    let plan = plan_folders(&[nid(6)], &tree);
    assert_eq!(names(&plan, 6), ["L1", "L2", "L3", "L4"]);
}

#[test]
fn unknown_ancestors_end_the_chain() {
    // The page's parent was unreadable, so resolution gave it no parent.
    let tree = ancestry(&[(7, "Orphan", None)]);
    assert!(plan_folders(&[nid(7)], &tree)[&nid(7)].is_empty());
}

#[tokio::test]
async fn resolution_walks_blocks_skips_unreadable_pages_and_reads_each_ancestor_once() {
    let mut workspace = FakeWorkspace::with_pages(
        NotionOwner::NotAUser,
        vec![
            page(
                1,
                "Team Home",
                NotionParent::Workspace,
                "2026-10-01T00:00:00Z",
            ),
            page(9, "Hidden", NotionParent::Workspace, "2026-10-01T00:00:00Z"),
        ],
    );
    // Hidden is not shared with the connection.
    workspace.pages.remove(&nid(9));
    workspace.containers.insert(
        nid(4),
        NotionContainer {
            id: nid(4),
            title: "Projects".into(),
            icon_emoji: Some("📁".into()),
            parent: NotionParent::Page(nid(1).as_str().into()),
        },
    );
    // Column block 30 inside column list 31 on Team Home.
    workspace
        .block_parents
        .insert(nid(30), NotionParent::Block(nid(31).as_str().into()));
    workspace
        .block_parents
        .insert(nid(31), NotionParent::Page(nid(1).as_str().into()));
    let notion = FakeNotion::new(workspace);
    let pages = [
        PlacedPage {
            id: nid(10),
            name: "In a column".into(),
            parent: NotionParent::Block(nid(30).as_str().into()),
        },
        PlacedPage {
            id: nid(11),
            name: "Row".into(),
            parent: NotionParent::Database(nid(4).as_str().into()),
        },
        PlacedPage {
            id: nid(12),
            name: "Under hidden".into(),
            parent: NotionParent::Page(nid(9).as_str().into()),
        },
    ];

    let ancestry = resolve_ancestry(&notion, &pages).await;

    assert_eq!(ancestry.nodes[&nid(10)].parent, Some(nid(1)));
    assert_eq!(ancestry.nodes[&nid(11)].parent, Some(nid(4)));
    assert_eq!(ancestry.nodes[&nid(12)].parent, None);
    assert_eq!(ancestry.nodes[&nid(4)].name, "📁 Projects");
    assert_eq!(ancestry.nodes[&nid(4)].parent, Some(nid(1)));
    assert_eq!(ancestry.nodes[&nid(1)].parent, None);
    // Team Home, Projects, Hidden, and the two blocks: one read each.
    assert_eq!(notion.0.reads.load(std::sync::atomic::Ordering::SeqCst), 5);
    let plan = plan_folders(&[nid(10), nid(11), nid(12)], &ancestry);
    assert_eq!(names(&plan, 10), ["Team Home"]);
    assert_eq!(names(&plan, 11), ["Team Home", "📁 Projects"]);
    assert!(plan[&nid(12)].is_empty());
}
