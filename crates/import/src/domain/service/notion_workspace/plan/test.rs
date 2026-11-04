use chrono::{TimeZone, Utc};
use import_notion::domain::model::{NotionDataSource, NotionPage, NotionPropertySchema};

use super::*;

fn id(hex: char) -> NotionId {
    NotionId::parse(&hex.to_string().repeat(32)).unwrap()
}

fn page(hex: char, title: &str, parent: NotionParent) -> NotionPage {
    NotionPage {
        id: id(hex),
        title: title.to_string(),
        url: id(hex).url(),
        parent,
        last_edited: Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
        in_trash: false,
        properties: Default::default(),
    }
}

#[test]
fn the_tree_puts_parents_first_and_plans_every_object_under_its_page() {
    let inventory = Inventory {
        pages: vec![
            page('b', "Q3 plan", NotionParent::Page { id: id('a') }),
            page('a', "Engineering", NotionParent::Workspace),
            page('c', "", NotionParent::Page { id: id('b') }),
            // Its parent was not shared with the connection, so it is a root.
            page('d', "Orphan", NotionParent::Page { id: id('9') }),
        ],
        data_sources: vec![DataSourceSummary {
            source: NotionDataSource {
                id: id('e'),
                database_id: id('f'),
                title: "Bugs".to_string(),
                database_parent: NotionParent::Page { id: id('a') },
                in_trash: false,
                properties: vec![
                    NotionPropertySchema {
                        id: "title".to_string(),
                        name: "Name".to_string(),
                        kind: NotionPropertyKind::Title,
                    },
                    NotionPropertySchema {
                        id: "stat".to_string(),
                        name: "Status".to_string(),
                        kind: NotionPropertyKind::Status {
                            options: Vec::new(),
                        },
                    },
                ],
            },
            row_count: 12,
            sample_titles: vec!["Fix login".to_string()],
        }],
    };

    let tree = PlanTree::new(&inventory);

    let order: Vec<&str> = tree.nodes.iter().map(|node| node.title.as_str()).collect();
    assert_eq!(
        order,
        ["Engineering", "Orphan", "Q3 plan", "Bugs", UNTITLED_PAGE]
    );

    let items = tree.triage_items(&HashMap::new());
    let engineering = items
        .iter()
        .find(|item| item.title == "Engineering")
        .unwrap();
    assert_eq!(engineering.children, 2);
    let untitled = items
        .iter()
        .find(|item| item.title == UNTITLED_PAGE)
        .unwrap();
    assert_eq!(untitled.path, ["Engineering", "Q3 plan"]);
    let bugs = items.iter().find(|item| item.title == "Bugs").unwrap();
    assert_eq!(
        bugs.table.as_ref().map(|table| table.columns.clone()),
        Some(vec![
            "Name (title)".to_string(),
            "Status (status)".to_string()
        ])
    );

    let verdicts: HashMap<String, Verdict> = [(
        id('e').to_string(),
        Verdict {
            key: id('e').to_string(),
            decision: NotionDecision::Tasks,
            reason: Some("A bug tracker".to_string()),
            task_fields: Some(crate::domain::models::NotionTaskFields {
                status: Some("Status".to_string()),
                ..Default::default()
            }),
            shared: None,
            shared_reason: None,
        },
    )]
    .into_iter()
    .collect();
    let staged = tree.staged_rows(NotionSharing::Personal, true, &HashMap::new());
    assert_eq!(staged.len(), 5);
    let waiting: Vec<Option<NotionDecision>> = staged
        .iter()
        .map(|row| {
            serde_json::from_value::<NotionDocMeta>(row.metadata.clone())
                .unwrap()
                .plan
                .unwrap()
                .decision
        })
        .collect();
    assert_eq!(waiting, [None, None, None, None, None]);

    let rows = tree.decided_rows(&verdicts, NotionSharing::Personal, true);

    assert_eq!(rows.len(), 1);
    let bugs_row = rows
        .iter()
        .find(|row| row.foreign_id == id('e').to_string())
        .unwrap();
    assert_eq!(bugs_row.kind, ImportKind::DataSource);
    assert_eq!(bugs_row.parent_foreign_id, Some(id('a').to_string()));
    let meta: NotionDocMeta = serde_json::from_value(bugs_row.metadata.clone()).unwrap();
    let plan = meta.plan.unwrap();
    assert_eq!(plan.decision, Some(NotionDecision::Tasks));
    assert_eq!(plan.rows, Some(12));
    assert_eq!(plan.sample_titles, ["Fix login"]);
    assert_eq!(
        plan.task_fields.and_then(|fields| fields.status).as_deref(),
        Some("Status")
    );
    assert_eq!(plan.path, ["Engineering"]);
    assert_eq!(meta.url.as_deref(), Some(id('f').url().as_str()));
}

#[test]
fn a_parent_cycle_cannot_hide_its_members() {
    let inventory = Inventory {
        pages: vec![
            page('a', "One", NotionParent::Page { id: id('b') }),
            page('b', "Two", NotionParent::Page { id: id('a') }),
        ],
        data_sources: Vec::new(),
    };

    let tree = PlanTree::new(&inventory);

    assert_eq!(tree.nodes.len(), 2);
    assert_eq!(tree.nodes[0].parent, None);
    assert_eq!(tree.nodes[1].parent, Some(tree.nodes[0].id.clone()));
}

#[test]
fn objects_a_teammate_already_imported_skip_the_model_and_link_to_their_copy() {
    let inventory = Inventory {
        pages: vec![
            page('a', "Engineering", NotionParent::Workspace),
            page('b', "Handbook", NotionParent::Page { id: id('a') }),
        ],
        data_sources: Vec::new(),
    };
    let tree = PlanTree::new(&inventory);
    let copy = NotionAlreadyImported {
        by: "ana@acme.test".to_string(),
        entity_id: "doc-handbook".to_string(),
        entity_type: "md".to_string(),
    };
    let already: HashMap<String, NotionAlreadyImported> =
        [(id('b').to_string(), copy.clone())].into_iter().collect();

    let items = tree.triage_items(&already);
    assert_eq!(
        items
            .iter()
            .map(|item| item.title.as_str())
            .collect::<Vec<_>>(),
        ["Engineering"],
        "the decision model never sees the Handbook"
    );
    let engineering = Verdict {
        key: id('a').to_string(),
        decision: NotionDecision::Copy,
        reason: None,
        task_fields: None,
        shared: Some(true),
        shared_reason: Some("The team's space".to_string()),
    };
    let verdicts: HashMap<String, Verdict> =
        [(id('a').to_string(), engineering)].into_iter().collect();

    let staged = tree.staged_rows(NotionSharing::Ai, true, &already);
    let decided = tree.decided_rows(&verdicts, NotionSharing::Ai, true);

    let plans: Vec<NotionPlanItem> = [&decided[0], &staged[1]]
        .into_iter()
        .map(|row| {
            serde_json::from_value::<NotionDocMeta>(row.metadata.clone())
                .unwrap()
                .plan
                .unwrap()
        })
        .collect();
    assert!(plans[0].shared);
    assert_eq!(plans[0].shared_reason.as_deref(), Some("The team's space"));
    assert_eq!(plans[0].already_imported, None);
    assert_eq!(plans[1].already_imported, Some(copy));
    assert!(
        !plans[1].shareable,
        "a teammate's copy is not the user's to share"
    );
    assert_eq!(plans[1].reason.as_deref(), Some(ALREADY_IN_MACRO));
    assert_eq!(
        plans[1].decision,
        Some(NotionDecision::Copy),
        "decided as soon as it is staged"
    );
}
