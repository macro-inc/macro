use import::domain::models::{ImportState, ImportStatus};

use super::*;
use crate::domain::models::Selection;
use crate::test_support::{notion_page, user};

fn request(refs: &[&str], all: bool, declined: &[&str]) -> PlanRequest {
    PlanRequest {
        selections: vec![Selection {
            app: "Notion".to_owned(),
            all,
            refs: refs.iter().map(|r| (*r).to_owned()).collect(),
        }],
        declined: declined.iter().map(|r| (*r).to_owned()).collect(),
        ..PlanRequest::default()
    }
}

#[test]
fn the_plan_id_depends_on_what_was_chosen_not_how_it_was_written() {
    let a = plan_id(&user(), &request(&["b", "a"], false, &[]), &[]);
    let b = plan_id(&user(), &request(&["A", "b", "a"], false, &[]), &[]);
    let c = plan_id(&user(), &request(&["a"], false, &[]), &[]);
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(a.starts_with("plan_"));
}

#[test]
fn the_plan_id_is_per_person() {
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_string()).unwrap();
    assert_ne!(
        plan_id(&user(), &request(&[], true, &[]), &[]),
        plan_id(&other, &request(&[], true, &[]), &[])
    );
}

#[test]
fn all_brings_every_staged_candidate_except_declined_ones() {
    let state = ImportState {
        runs: Vec::new(),
        entities: vec![
            notion_page(1, "Keep", ImportStatus::Staged),
            notion_page(2, "Declined", ImportStatus::Staged),
            notion_page(3, "Already in", ImportStatus::Imported),
        ],
    };
    let view = SourceView::of(&state, &user(), ImportSource::Notion);
    let declined = view::reference(&notion_page(2, "", ImportStatus::Staged));

    let resolved = resolve_selection(
        &view,
        &Selection {
            app: "notion".to_owned(),
            all: true,
            refs: Vec::new(),
        },
        &[declined],
    )
    .expect("resolves");

    assert_eq!(resolved.to_import.len(), 1);
    assert_eq!(view::title(resolved.to_import[0]), "Keep");
    assert_eq!(resolved.declined.len(), 1);
}

#[test]
fn a_ref_given_twice_counts_once_wherever_it_repeats() {
    let state = ImportState {
        runs: Vec::new(),
        entities: vec![
            notion_page(1, "One", ImportStatus::Staged),
            notion_page(2, "Two", ImportStatus::Staged),
            notion_page(3, "Already in", ImportStatus::Imported),
        ],
    };
    let view = SourceView::of(&state, &user(), ImportSource::Notion);
    let one = view::reference(&notion_page(1, "", ImportStatus::Staged));
    let two = view::reference(&notion_page(2, "", ImportStatus::Staged));
    let three = view::reference(&notion_page(3, "", ImportStatus::Imported));

    let resolved = resolve_selection(
        &view,
        &Selection {
            app: "notion".to_owned(),
            all: false,
            refs: vec![one.clone(), two, one, three.clone(), three],
        },
        &[],
    )
    .expect("resolves");

    assert_eq!(resolved.to_import.len(), 2);
    assert_eq!(resolved.underway.len(), 1);
}

#[test]
fn the_plan_text_caps_long_lists() {
    let rows: Vec<_> = (1..=15u128)
        .map(|n| notion_page(n, &format!("Page {n:02}"), ImportStatus::Staged))
        .collect();
    let refs: Vec<&import::domain::models::ImportEntity> = rows.iter().collect();
    let app = ResolvedApp {
        source: ImportSource::Notion,
        to_import: refs,
        underway: Vec::new(),
        declined: Vec::new(),
    };

    let text = render(&PlanText {
        notion: None,
        apps: &[app],
        scope_notes: None,
        not_covered: &[],
        inbox: &[],
    });

    assert!(text.contains("15 pages"));
    assert!(text.contains("and 3 more"));
}

#[test]
fn not_covered_explains_later_kept_and_unknown_tools() {
    let base = "https://macro.com";
    let line = |name: &str| not_covered(&catalog::resolve(name).unwrap(), base);

    let crm = line("hubspot").unwrap();
    assert_eq!(crm.group, Group::Later);
    assert!(crm.text.contains("Macro can't import HubSpot yet"));
    assert!(crm.text.contains("CSV"));
    let jira = line("Jira").unwrap();
    assert_eq!(jira.group, Group::Later);
    assert!(jira.text.contains("brings its issues in"));
    assert!(!jira.text.contains("CSV"));

    let drive = line("Google Drive").unwrap();
    assert_eq!(drive.group, Group::Keep);
    assert!(drive.text.contains("work with it live"));
    let calendar = line("Google Calendar").unwrap();
    assert_eq!(calendar.group, Group::Keep);
    assert!(calendar.text.contains("Enable calendar"));

    let slack = line("slack").unwrap();
    assert_eq!(slack.group, Group::Other);
    assert!(slack.text.contains("export ZIP"));
    let other = line("Basecamp").unwrap();
    assert_eq!(other.group, Group::Other);
    assert!(other.text.contains("can't import Basecamp yet"));

    assert!(line("notion").is_none());
    assert!(line("gmail").is_none());
}

#[test]
fn the_plan_groups_what_stays_connected_and_what_comes_later() {
    let base = "https://macro.com";
    let not_covered: Vec<NotCoveredLine> = ["Jira", "Google Drive", "Basecamp"]
        .iter()
        .filter_map(|name| not_covered(&catalog::resolve(name).unwrap(), base))
        .collect();
    let text = render(&PlanText {
        notion: None,
        apps: &[],
        scope_notes: None,
        not_covered: &not_covered,
        inbox: &["founder@startup.example".to_owned()],
    });

    let kept = text.find("**Stays connected**").expect("kept");
    let later = text.find("**Not imported yet**").expect("later");
    let other = text.find("**Not brought in by setup**").expect("other");
    assert!(kept < later && later < other, "{text}");
    assert!(text.contains("- **Email**: your inbox (founder@startup.example) is connected"));
    assert!(text[kept..later].contains("**Google Drive**"));
    assert!(text[later..other].contains("**Jira**"));
    assert!(text[other..].contains("**Basecamp**"));
}
