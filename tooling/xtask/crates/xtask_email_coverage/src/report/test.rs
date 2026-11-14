use serde_json::json;

use super::evidence::Evidence;
use super::graphql::Schema;
use super::junit::Results;
use super::ledger::{Atom, Ledger, Waivers, checks, functions, map};
use super::seen::{Hit, Reader, matches};
use super::{Status, build};
use crate::{Sources, parse_tsv};

const ROWS: &str = "kind\tkey\tproviders\tmatch\tsource\n\
http\tPATCH /email/threads/{id}/state\tboth\t\ta.rs:1\n\
http\tGET /email/drafts/{id}/operation\tboth\t\ta.rs:2\n\
http\tGET /email/drafts/scheduled\tboth\t\ta.rs:3\n\
queue\tgmail-ops:ModifyMessageLabels\tgmail\t/operation/modify_message_labels\tb.rs:1\n\
kafka\tmacro.email:ThreadStarred\tboth\t/event_type=email.thread_starred\tc.rs:1\n\
provider\tgmail:messages.modify\tgmail\t\td.rs:1\n\
provider\toutlook:messages.update\toutlook\t\td.rs:2\n\
loop\tmailbox_sync_worker::run\tboth\t\te.rs:1\n\
elsewhere\tdocument_storage_service PUT /reminders/email/{thread_id}\tboth\t\tf.rs:1\n";

const FUNCTIONS: &str = "id\tarea\tfunction\tgmail\toutlook\tui\tresult_checked_at\n\
F-001\torganise\tStar a thread\tyes\tyes\tyes\tprovider\n\
F-002\torganise\tUnstar a thread\tyes\tyes\tyes\tprovider\n\
F-003\tlist\tMove through the list with the keyboard\tyes\tyes\tyes\tui\n\
F-004\tscheduled\tSee scheduled messages\tyes\tyes\tyes\tservice\n\
F-005\treminders\tSet a reminder on a thread\tyes\tyes\tyes\tservice\n\
F-006\tsearch\tSearch mail by text\tyes\tyes\tyes\tservice\n";

const MAP: &str = r#"
[F-001]
by = ["http PATCH /email/threads/{id}/state where /field=starred, /value=true"]
gmail = ["provider gmail:messages.modify"]
outlook = ["provider outlook:messages.update"]
also = ["queue gmail-ops:ModifyMessageLabels", "kafka macro.email:ThreadStarred"]

[F-002]
by = ["http PATCH /email/threads/{id}/state where /field=starred, /value=false"]
gmail = ["provider gmail:messages.modify"]
outlook = ["provider outlook:messages.update"]

[F-003]
ui = "no request leaves the browser"

[F-004]
by = ["http GET /email/drafts/scheduled", "http GET /email/drafts/{id}/operation"]

[F-005]
by = ["elsewhere document_storage_service PUT /reminders/email/{thread_id} where /type=set"]

[F-006]
outside = "the search service"
"#;

fn repo() -> std::path::PathBuf {
    xtask_paths::repo_root()
}

fn record(test: &str, provider: &str, starred: bool) -> Evidence {
    let route = if provider == "gmail" {
        "messages.modify"
    } else {
        "messages.update"
    };
    serde_json::from_value(json!({
        "version": 1, "binary": "state", "test": test, "providers": [provider],
        "http": [
            { "service": "email_service", "method": "PATCH", "path": "/email/threads/{}/state",
              "query": "", "body": { "field": "starred", "value": starred }, "status": 204 },
            { "service": "email_service", "method": "GET", "path": "/email/drafts/scheduled",
              "query": "", "body": null, "status": 200 },
            { "service": "email_service", "method": "GET", "path": "/", "status": 404 },
            { "service": "document_storage_service", "method": "PUT",
              "path": "/reminders/email/{}", "query": "", "body": { "type": "set" },
              "status": 200 },
        ],
        "queue": [
            { "queue": "gmail-ops-retry", "step": "handled",
              "body": { "operation": { "modify_message_labels": { "link_id": "<str>" } } } },
        ],
        "kafka": [{ "topic": "macro.email", "event": "email.thread_starred" }],
        "provider": [{ "provider": provider, "route": route, "method": "POST", "status": 200 }],
    }))
    .unwrap()
}

#[test]
fn an_atom_reads_its_conditions() {
    let atom: Atom = "http GET /email/threads/previews/cursor/{view} where view=starred, ?limit"
        .parse()
        .unwrap();
    assert_eq!(atom.entry(), "http GET /email/threads/previews/cursor/{view}");
    let hit = |view, query| Hit {
        params: vec![("view", view)],
        query,
        ..Hit::default()
    };
    assert!(atom.accepts(&hit("starred", "cursor&limit")));
    assert!(!atom.accepts(&hit("inbox", "limit")));
    assert!(!atom.accepts(&hit("starred", "cursor")));

    let body = json!({ "field": "starred", "value": true });
    let star: Atom = "graphql Mutation.setState where /field=starred, /value=true, ~setState"
        .parse()
        .unwrap();
    let asked = |text| Hit {
        body: Some(&body),
        text,
        ..Hit::default()
    };
    assert!(star.accepts(&asked("mutation { setState }")));
    assert!(!star.accepts(&asked("mutation { other }")));
    assert!("nonsense".parse::<Atom>().is_err());
    assert!("http GET /x where what".parse::<Atom>().is_err());
}

#[test]
fn a_matcher_takes_a_pointer_or_a_value() {
    let body = json!({ "operation": { "upsert_message": {} }, "kind": "DeleteLink" });
    assert!(matches("*", &body));
    assert!(matches("/operation/upsert_message", &body));
    assert!(!matches("/operation/delete_message", &body));
    assert!(matches("/kind=DeleteLink", &body));
    assert!(!matches("/kind=Refresh", &body));
}

/// The whole join: a function is covered only where a scenario of that
/// provider performed it and is said to check it, and an action is told
/// from its opposite.
#[test]
fn functions_and_entry_points_are_counted_per_provider() {
    let rows = parse_tsv(ROWS, "rows").unwrap();
    let sources = Sources::load(&repo()).unwrap();
    let schema = Schema::load(&repo()).unwrap();
    let reader = Reader {
        rows: &rows,
        sources: &sources,
        schema: &schema,
    };
    let ledger = Ledger {
        functions: functions(FUNCTIONS).unwrap(),
        map: map(MAP).unwrap(),
        checks: checks("function\tscenario\nF-001\tstate gmail_stars\nF-002\tstate gmail_stars\n")
            .unwrap(),
        waivers: Waivers::default(),
    };
    let records = vec![
        record("gmail_stars", "gmail", true),
        record("outlook_stars", "outlook", true),
    ];
    let model = build(&reader, &ledger, records, &Results::default());

    assert_eq!(model.broken, Vec::<String>::new());
    let status = |id: &str| {
        let row = model.functions.iter().find(|row| row.id == id).unwrap();
        (
            row.gmail.as_ref().map(|cell| cell.status),
            row.outlook.as_ref().map(|cell| cell.status),
        )
    };
    assert_eq!(status("F-001"), (Some(Status::Covered), Some(Status::Performed)));
    // Nobody unstarred: the check that says so is stale.
    assert_eq!(status("F-002"), (Some(Status::Open), Some(Status::Open)));
    assert_eq!(model.stale.len(), 1);
    assert_eq!(status("F-003"), (None, None));
    assert_eq!(status("F-004"), (Some(Status::Performed), Some(Status::Performed)));
    // A route of another service a stack records performs a function too;
    // one no stack records is set apart, not counted as open.
    assert_eq!(status("F-005"), (Some(Status::Performed), Some(Status::Performed)));
    assert_eq!(status("F-006"), (None, None));
    assert_eq!(model.functions_outside, 1);
    assert_eq!(model.functions_ui_only, 1);
    assert_eq!(model.functions_gmail.covered, 1);

    let entry = |key: &str| {
        let row = model.entry_rows.iter().find(|row| row.key == key).unwrap();
        (
            row.gmail.as_ref().map(|cell| cell.status),
            row.outlook.as_ref().map(|cell| cell.status),
        )
    };
    // The literal route wins over the one with a parameter.
    assert_eq!(
        entry("GET /email/drafts/scheduled"),
        (Some(Status::Covered), Some(Status::Covered))
    );
    assert_eq!(
        entry("GET /email/drafts/{id}/operation"),
        (Some(Status::Open), Some(Status::Open))
    );
    // A message on the retry queue is a message of the queue.
    assert_eq!(entry("gmail-ops:ModifyMessageLabels"), (Some(Status::Covered), None));
    assert_eq!(entry("outlook:messages.update"), (None, Some(Status::Covered)));
    assert_eq!(model.loops, vec!["mailbox_sync_worker::run".to_owned()]);
    assert!(model.unlisted.is_empty(), "{:?}", model.unlisted);
}

/// A route, a function or a check the ledger does not know is an error, not
/// a quiet gap.
#[test]
fn a_ledger_that_contradicts_the_list_is_broken() {
    let rows = parse_tsv(ROWS, "rows").unwrap();
    let sources = Sources::load(&repo()).unwrap();
    let schema = Schema::load(&repo()).unwrap();
    let reader = Reader {
        rows: &rows,
        sources: &sources,
        schema: &schema,
    };
    let ledger = Ledger {
        functions: functions(FUNCTIONS).unwrap(),
        map: map("[F-001]\nby = [\"http GET /email/gone\"]\n[F-009]\nui = \"x\"\n").unwrap(),
        checks: Vec::new(),
        waivers: Waivers::default(),
    };
    let model = build(&reader, &ledger, Vec::new(), &Results::default());
    let broken = model.broken.join("\n");
    assert!(broken.contains("`http GET /email/gone`, which is not in"), "{broken}");
    assert!(broken.contains("[F-009] is not a function"), "{broken}");
    assert!(broken.contains("F-002 (Unstar a thread) has no entry"), "{broken}");
    assert!(
        broken.contains("`http PATCH /email/threads/{id}/state` belongs to no function"),
        "{broken}"
    );
}

/// nextest's results: a scenario that passed only on its second try is
/// flaky, not passed, and a run is named for the directory it is in.
#[test]
fn results_tell_flaky_from_passed_and_failed() {
    let dir = tempfile::tempdir().unwrap();
    let job = dir.path().join("email-e2e-results-2");
    std::fs::create_dir(&job).unwrap();
    std::fs::write(
        job.join("junit.xml"),
        r#"<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="3" failures="1" errors="0" time="12.5">
    <testsuite name="email_e2e::state" tests="3" failures="1">
        <testcase name="gmail_stars" classname="email_e2e::state" time="1.0"/>
        <testcase name="outlook_stars" classname="email_e2e::state" time="2.0">
            <flakyFailure timestamp="t" time="1.0" message="m" type="t">boom</flakyFailure>
        </testcase>
        <testcase name="a &lt;b&gt;" classname="email_e2e::state" time="2.0">
            <failure message="m" type="t">boom</failure>
        </testcase>
    </testsuite>
</testsuites>"#,
    )
    .unwrap();

    let files = super::evidence::files_named(&[dir.path().to_owned()], "junit.xml").unwrap();
    let results = super::junit::load(&files).unwrap();
    use super::junit::Outcome;
    assert_eq!(results.outcomes["state gmail_stars"], Outcome::Passed);
    assert_eq!(results.outcomes["state outlook_stars"], Outcome::Flaky(1));
    assert_eq!(results.outcomes["state a <b>"], Outcome::Failed);
    let run = &results.runs[0];
    assert_eq!(
        (run.name.as_str(), run.tests, run.failed, run.flaky),
        ("email-e2e-results-2", 3, 1, 1)
    );
    assert!((run.seconds - 12.5).abs() < f64::EPSILON);
}
