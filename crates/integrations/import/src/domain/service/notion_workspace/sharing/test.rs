use import_notion::domain::model::NotionId;

use super::*;
use crate::domain::models::{ImportKind, NotionDecision, NotionTaskFields};
use crate::domain::service::notion_workspace::write::folder_layout;

fn verdict(decision: NotionDecision, shared: Option<bool>) -> Verdict {
    Verdict {
        key: "a".repeat(32),
        decision,
        reason: None,
        task_fields: None,
        shared,
        shared_reason: shared.map(|_| "Team wiki".to_string()),
    }
}

fn item(import: u128, parent: Option<u128>, kind: ImportKind, shared: bool) -> WriteItem {
    WriteItem {
        import_id: Uuid::from_u128(import),
        parent: parent.map(Uuid::from_u128),
        notion_id: NotionId::parse(&"a".repeat(32)).unwrap(),
        kind,
        title: format!("object {import}"),
        decision: NotionDecision::Copy,
        task_fields: NotionTaskFields::default(),
        shared,
        shareable: true,
        already_imported: false,
    }
}

#[test]
fn the_users_choice_decides_sharing_except_for_users_without_a_team() {
    let page = verdict(NotionDecision::Copy, Some(true));
    assert_eq!(
        plan_sharing(NotionSharing::Team, &page, true),
        PlanSharing {
            shared: true,
            reason: None,
            shareable: true
        }
    );
    assert_eq!(
        plan_sharing(NotionSharing::Personal, &page, true),
        PlanSharing {
            shared: false,
            reason: None,
            shareable: true
        }
    );
    assert_eq!(
        plan_sharing(NotionSharing::Ai, &page, true),
        PlanSharing {
            shared: true,
            reason: Some("Team wiki".to_string()),
            shareable: true
        }
    );
    assert_eq!(
        plan_sharing(
            NotionSharing::Ai,
            &verdict(NotionDecision::Copy, None),
            true
        ),
        PlanSharing {
            shared: false,
            reason: Some(NO_ANSWER.to_string()),
            shareable: true
        },
        "no answer keeps it private"
    );
    assert_eq!(
        plan_sharing(
            NotionSharing::Team,
            &verdict(NotionDecision::Tasks, None),
            true
        ),
        PlanSharing {
            shared: true,
            reason: None,
            shareable: true
        },
        "a task list is a shareable folder of tasks"
    );
    assert_eq!(
        plan_sharing(NotionSharing::Team, &page, false),
        PlanSharing {
            shared: false,
            reason: Some(NO_TEAM.to_string()),
            shareable: false
        }
    );
}

#[test]
fn a_database_is_shared_like_a_page() {
    let plan = item(1, None, ImportKind::DataSource, false);
    assert_eq!(
        plan_sharing(
            NotionSharing::Team,
            &verdict(NotionDecision::Copy, None),
            true
        ),
        PlanSharing {
            shared: true,
            reason: None,
            shareable: true
        }
    );
    assert_eq!(
        plan_sharing(
            NotionSharing::Ai,
            &verdict(NotionDecision::Copy, Some(false)),
            true
        ),
        PlanSharing {
            shared: false,
            reason: Some("Team wiki".to_string()),
            shareable: true
        }
    );
    assert_eq!(
        sharing_changes(&[plan], &[Uuid::from_u128(1)], &[]),
        (vec![Uuid::from_u128(1)], vec![]),
        "the owner may share a database the plan keeps"
    );
}

#[test]
fn only_changes_to_shareable_rows_that_differ_from_the_plan_are_accepted() {
    let mut personal = item(3, None, ImportKind::Page, false);
    personal.shareable = false;
    let items = vec![
        item(1, None, ImportKind::Page, false),
        item(2, None, ImportKind::Page, true),
        personal,
        item(4, None, ImportKind::Page, true),
    ];
    let (share, keep) = sharing_changes(
        &items,
        &[Uuid::from_u128(1), Uuid::from_u128(3), Uuid::from_u128(4)],
        &[Uuid::from_u128(2)],
    );

    assert_eq!(
        share,
        [Uuid::from_u128(1)],
        "4 is shared already; 3 cannot be shared"
    );
    assert_eq!(keep, [Uuid::from_u128(2)]);
}

#[test]
fn a_folder_is_shared_only_when_everything_written_inside_it_is() {
    // Wiki (shared) > Handbook (shared) > Onboarding (shared)
    // Projects (shared) > Notes (private)
    // Planning (shared) > Budget (private database)
    // Roadmap (shared) > Releases (shared database)
    let items = vec![
        item(1, None, ImportKind::Page, true),
        item(2, Some(1), ImportKind::Page, true),
        item(3, Some(2), ImportKind::Page, true),
        item(4, None, ImportKind::Page, true),
        item(5, Some(4), ImportKind::Page, false),
        item(6, None, ImportKind::Page, true),
        item(7, Some(6), ImportKind::DataSource, false),
        item(8, None, ImportKind::Page, true),
        item(9, Some(8), ImportKind::DataSource, true),
    ];

    let shared = shared_folders(&items, &folder_layout(&items));

    assert_eq!(
        shared,
        HashSet::from([Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(8)])
    );
}

#[test]
fn a_teammates_copy_inside_a_folder_does_not_keep_the_folder_private() {
    let mut linked = item(2, Some(1), ImportKind::Page, false);
    linked.already_imported = true;
    let items = vec![item(1, None, ImportKind::Page, true), linked];

    let shared = shared_folders(&items, &folder_layout(&items));

    assert_eq!(shared, HashSet::from([Uuid::from_u128(1)]));
}
