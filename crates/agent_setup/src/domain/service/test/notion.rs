//! Notion through its workspace planner: the plan is a tree, the person
//! approves it once, and Notion's own write brings it in.

use std::time::Duration;

use import::domain::models::{
    ImportEntity, ImportKind, ImportSource, ImportStatus, NotionImportReport, NotionReportItem,
    NotionSharing, RunStatus,
};
use serde_json::json;
use uuid::Uuid;

use super::{apps, reference};
use crate::domain::models::{DiscoveryStatus, PlanRequest, Selection};
use crate::domain::ports::AccountStatus;
use crate::test_support::{
    FakeAccounts, FakeConnections, FakeImports, FakeInbox, Fixture, fixture, row, run, user,
};

/// One object of a Notion workspace plan.
fn planned(
    n: u128,
    title: &str,
    kind: ImportKind,
    decision: &str,
    parent: Option<u128>,
    rows: Option<u32>,
) -> ImportEntity {
    let mut entity = row(
        ImportSource::Notion,
        n,
        ImportStatus::Staged,
        json!({
            "title": title,
            "url": format!("https://notion.so/{n}"),
            "plan": {
                "decision": decision,
                "rows": rows,
                "shared": false,
                "shareable": true,
                "reason": (decision == "hand").then_some("an embedded form"),
            },
        }),
    );
    entity.kind = kind;
    entity.parent_id = parent.map(|parent| {
        row(
            ImportSource::Notion,
            parent,
            ImportStatus::Staged,
            json!({}),
        )
        .id
    });
    entity
}

/// A team member's ready Notion plan: a page with a subpage, a database, a
/// task list, a page left in Notion and one to bring over by hand.
fn ready_plan() -> Fixture {
    let imports = FakeImports::new(
        vec![run(ImportSource::Notion, RunStatus::Ready)],
        vec![
            planned(10, "Eng Handbook", ImportKind::Page, "copy", None, None),
            planned(11, "On-call", ImportKind::Page, "copy", Some(10), None),
            planned(
                12,
                "Customers",
                ImportKind::DataSource,
                "copy",
                None,
                Some(40),
            ),
            planned(
                13,
                "Sprint Board",
                ImportKind::DataSource,
                "tasks",
                None,
                Some(7),
            ),
            planned(14, "Old Notes", ImportKind::Page, "skip", None, None),
            planned(15, "Signup Form", ImportKind::Page, "hand", None, None),
        ],
        Vec::new(),
    );
    *imports.notion_report.lock().unwrap() = NotionImportReport {
        pages: 4,
        data_sources: 2,
        copy: 3,
        tasks: 1,
        skip: 1,
        hand: 1,
        on_team: true,
        hand_items: vec![NotionReportItem {
            import_id: Uuid::nil(),
            title: "Signup Form".to_owned(),
            kind: ImportKind::Page,
            url: None,
            reason: Some("an embedded form".to_owned()),
        }],
        ..NotionImportReport::default()
    };
    fixture(
        imports,
        FakeConnections::with(&["notion"]),
        FakeInbox::default(),
        FakeAccounts {
            status: std::sync::Mutex::new(AccountStatus {
                agent_led: true,
                has_team: true,
                ..AccountStatus::default()
            }),
            ..FakeAccounts::default()
        },
    )
}

fn notion(declined: &[u128], sharing: Option<NotionSharing>) -> PlanRequest {
    PlanRequest {
        selections: vec![Selection {
            app: "notion".to_owned(),
            all: true,
            refs: Vec::new(),
        }],
        declined: declined.iter().map(|n| reference(*n)).collect(),
        notion_sharing: sharing,
        ..PlanRequest::default()
    }
}

fn id(n: u128) -> Uuid {
    row(ImportSource::Notion, n, ImportStatus::Staged, json!({})).id
}

#[tokio::test]
async fn discovery_lists_the_top_items_of_the_plan_only() {
    let fixture = ready_plan();

    let discovery = fixture
        .service
        .discover(&user(), &apps(&["notion"]), Duration::ZERO)
        .await
        .expect("discover");

    let notion = &discovery.apps[0];
    assert_eq!(notion.status, DiscoveryStatus::Ready);
    let titles: Vec<&str> = notion
        .candidates
        .iter()
        .map(|candidate| candidate.title.as_str())
        .collect();
    assert_eq!(titles, ["Customers", "Eng Handbook", "Sprint Board"]);
    let handbook = &notion.candidates[1];
    assert_eq!(handbook.detail.as_deref(), Some("page · 1 more under it"));
    let note = notion.note.as_deref().unwrap_or_default();
    assert!(note.contains("leaves 1 in Notion"), "{note}");
    assert!(note.contains("notion_sharing"), "{note}");
}

#[tokio::test]
async fn declining_an_item_leaves_out_everything_under_it() {
    let fixture = ready_plan();
    let request = notion(&[10], None);

    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");
    assert_eq!(plan.will_import, 2);
    for line in [
        "1 database with 40 rows",
        "1 task list as 7 Macro tasks",
        "1 left in Notion",
        "To bring over by hand: Signup Form",
        "Shared with your team: 0 of 2 (Macro chose per page)",
        "**Leave out** (you can still bring these in later): Eng Handbook",
    ] {
        assert!(plan.plan_text.contains(line), "{line}\n{}", plan.plan_text);
    }

    fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("import");

    let writes = fixture.imports.notion_writes.lock().unwrap();
    let (_, choices) = &writes[0];
    let mut excluded = choices.excluded.clone();
    excluded.sort();
    assert_eq!(excluded, [id(10), id(11)]);
    assert!(choices.shared.is_empty() && choices.personal.is_empty());
}

#[tokio::test]
async fn sharing_everything_is_passed_to_the_write() {
    let fixture = ready_plan();
    let request = notion(&[], Some(NotionSharing::Team));

    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");
    assert!(
        plan.plan_text
            .contains("Shared with your team: 4 of 4 (you chose to share everything)"),
        "{}",
        plan.plan_text
    );
    assert!(
        plan.plan_text
            .contains("Notion items marked shared go to your team")
    );

    // Approving with different sharing is a different plan.
    let other = fixture
        .service
        .import(&user(), &notion(&[], None), &plan.plan_id, true)
        .await;
    assert!(other.is_err());

    fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("import");
    let writes = fixture.imports.notion_writes.lock().unwrap();
    let (_, choices) = &writes[0];
    assert_eq!(choices.shared.len(), 4);
    assert!(choices.excluded.is_empty());
    assert!(fixture.imports.imports.lock().unwrap().len() == 1);
}

#[tokio::test]
async fn items_to_bring_over_by_hand_are_in_the_report() {
    let fixture = ready_plan();

    let report = fixture
        .service
        .status(&user(), &apps(&["notion"]), Duration::ZERO)
        .await
        .expect("status");

    let by_hand = report
        .not_imported
        .iter()
        .find(|item| item.title == "Signup Form")
        .expect("by hand");
    assert_eq!(
        by_hand.reason.as_deref(),
        Some("bring it over by hand: an embedded form")
    );
}

#[tokio::test]
async fn declining_an_item_reaches_copies_below_what_stays_in_notion() {
    let fixture = ready_plan();
    // Eng Handbook → Old Notes (left in Notion) → Runbook (copied).
    fixture.imports.state.lock().unwrap().entities.extend([
        planned(16, "Archive", ImportKind::Page, "skip", Some(10), None),
        planned(17, "Runbook", ImportKind::Page, "copy", Some(16), None),
    ]);
    let request = notion(&[10], None);
    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");

    fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("import");

    let written = fixture.imports.imports.lock().unwrap().concat();
    assert!(!written.contains(&id(17)));
    let writes = fixture.imports.notion_writes.lock().unwrap();
    assert!(writes[0].1.excluded.contains(&id(17)));
}

#[tokio::test]
async fn a_declined_sub_page_is_left_out_without_its_parent() {
    let fixture = ready_plan();
    let request = notion(&[11], None);
    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");

    fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("import");

    let written = fixture.imports.imports.lock().unwrap().concat();
    assert!(written.contains(&id(10)));
    assert!(!written.contains(&id(11)));
}

#[tokio::test]
async fn items_planned_after_the_approval_are_not_written() {
    let fixture = ready_plan();
    let request = notion(&[], None);
    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");
    *fixture.imports.planned_after_attach.lock().unwrap() = vec![planned(
        18,
        "Late Page",
        ImportKind::Page,
        "copy",
        None,
        None,
    )];

    fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("import");

    let written = fixture.imports.imports.lock().unwrap().concat();
    assert!(written.contains(&id(10)));
    assert!(!written.contains(&id(18)));
}

#[tokio::test]
async fn a_plan_that_lost_an_approved_item_is_refused() {
    let fixture = ready_plan();
    let request = notion(&[], None);
    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");
    // A new plan replaced the approved one before the import.
    fixture
        .imports
        .state
        .lock()
        .unwrap()
        .entities
        .retain(|row| row.id != id(12));

    let refused = fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await;

    assert!(refused.is_err());
    assert!(fixture.imports.notion_writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_retried_import_with_declines_still_matches_its_plan() {
    let fixture = ready_plan();
    let request = notion(&[12], None);
    let plan = fixture
        .service
        .propose_plan(&user(), &request)
        .await
        .expect("plan");
    fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("import");

    let again = fixture
        .service
        .import(&user(), &request, &plan.plan_id, true)
        .await
        .expect("retry");
    assert_eq!(again.started, 0);
    assert_eq!(fixture.imports.notion_writes.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_page_staged_on_its_own_is_not_part_of_setup() {
    let fixture = ready_plan();
    fixture.imports.state.lock().unwrap().entities.push(row(
        ImportSource::Notion,
        19,
        ImportStatus::Staged,
        json!({ "title": "Pasted Page" }),
    ));

    let discovery = fixture
        .service
        .discover(&user(), &apps(&["notion"]), Duration::ZERO)
        .await
        .expect("discover");

    assert!(
        discovery.apps[0]
            .candidates
            .iter()
            .all(|candidate| candidate.title != "Pasted Page")
    );
}
