use serde_json::json;

use super::evidence::Evidence;
use super::gaps::{ignored, judge_known_bugs, read_known_bugs};
use super::graphql::Schema;
use super::junit::Results;
use super::ledger::{Atom, Ledger, Waivers, checks, functions, map, proofs};
use super::seen::{Hit, Reader, matches};
use super::{Status, build, render};
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
    assert_eq!(
        atom.entry(),
        "http GET /email/threads/previews/cursor/{view}"
    );
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

/// The whole join: a function is claimed only where a scenario of that
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
        proofs: Vec::new(),
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
    assert_eq!(
        status("F-001"),
        (Some(Status::Claimed), Some(Status::Performed))
    );
    // Nobody unstarred: the check that says so is stale.
    assert_eq!(status("F-002"), (Some(Status::Open), Some(Status::Open)));
    assert_eq!(model.stale.len(), 1);
    assert_eq!(status("F-003"), (None, None));
    assert_eq!(
        status("F-004"),
        (Some(Status::Performed), Some(Status::Performed))
    );
    // A route of another service a stack records performs a function too;
    // one no stack records is set apart, not counted as open.
    assert_eq!(
        status("F-005"),
        (Some(Status::Performed), Some(Status::Performed))
    );
    assert_eq!(status("F-006"), (None, None));
    assert_eq!(model.functions_deferred, 1);
    assert_eq!(model.functions_ui_only, 1);
    assert_eq!(model.functions_gmail.claimed, 1);
    assert_eq!(model.functions_gmail.proved, 0);

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
    assert_eq!(
        entry("gmail-ops:ModifyMessageLabels"),
        (Some(Status::Covered), None)
    );
    assert_eq!(
        entry("outlook:messages.update"),
        (None, Some(Status::Covered))
    );
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
        proofs: Vec::new(),
        waivers: Waivers::default(),
    };
    let model = build(&reader, &ledger, Vec::new(), &Results::default());
    let broken = model.broken.join("\n");
    assert!(
        broken.contains("`http GET /email/gone`, which is not in"),
        "{broken}"
    );
    assert!(broken.contains("[F-009] is not a function"), "{broken}");
    assert!(
        broken.contains("F-002 (Unstar a thread) has no entry"),
        "{broken}"
    );
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
<testsuites name="nextest-run" tests="3" failures="1" errors="0" uuid="run-1" time="12.5">
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
    // A run is named among those a scenario passed in unless it failed there.
    let passed_in = |scenario: &str| {
        results
            .passed_in
            .get(scenario)
            .is_some_and(|runs| runs.contains("run-1"))
    };
    assert!(passed_in("state gmail_stars"));
    assert!(passed_in("state outlook_stars"));
    assert!(!passed_in("state a <b>"));
    let run = &results.runs[0];
    assert_eq!(
        (run.name.as_str(), run.tests, run.failed, run.flaky),
        ("email-e2e-results-2", 3, 1, 1)
    );
    assert!((run.seconds - 12.5).abs() < f64::EPSILON);
}

/// A results file with no test in it, or cut short, is not a run in which
/// nothing failed.
#[test]
fn a_results_file_that_is_not_whole_is_an_error() {
    const PASSED: &str =
        r#"<testcase name="gmail_stars" classname="email_e2e::state" time="1.0"/>"#;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("junit.xml");
    let error_of = |text: String| {
        std::fs::write(&file, text).unwrap();
        super::junit::load(std::slice::from_ref(&file))
            .unwrap_err()
            .to_string()
    };

    let error = error_of("<testsuites name=\"nextest-run\" tests=\"3\"".to_owned());
    assert!(error.contains("is cut short"), "{error}");
    // Cut after the first whole test.
    let error = error_of(format!(
        "<testsuites tests=\"2\" uuid=\"run-1\"><testsuite>{PASSED}<testcase name=\"outlook_st"
    ));
    assert!(error.contains("is cut short"), "{error}");
    let error = error_of("<testsuites tests=\"0\" uuid=\"run-1\"></testsuites>".to_owned());
    assert!(error.contains("holds no test results"), "{error}");
    // Closed, and still not all the tests it says it holds.
    let error = error_of(format!(
        "<testsuites tests=\"2\" uuid=\"run-1\"><testsuite>{PASSED}</testsuite></testsuites>"
    ));
    assert!(
        error.contains("says it holds 2 tests and holds 1"),
        "{error}"
    );
}

/// A scenario two results files tell of ended as the worse of the two says,
/// whichever file is read last.
#[test]
fn the_worse_of_two_runs_of_a_scenario_counts() {
    use super::junit::Outcome;
    let dir = tempfile::tempdir().unwrap();
    let write = |name: &str, body: &str| {
        let job = dir.path().join(name);
        std::fs::create_dir(&job).unwrap();
        std::fs::write(
            job.join("junit.xml"),
            format!(
                "<testsuites tests=\"1\" uuid=\"{name}\"><testsuite><testcase name=\"gmail_stars\" \
                 classname=\"email_e2e::state\">{body}</testcase></testsuite></testsuites>"
            ),
        )
        .unwrap();
    };
    write("new", "<failure message=\"m\">boom</failure>");
    write("old", "");

    let files = super::evidence::files_named(&[dir.path().to_owned()], "junit.xml").unwrap();
    let results = super::junit::load(&files).unwrap();
    assert_eq!(results.outcomes["state gmail_stars"], Outcome::Failed);
}

/// A function counts as covered only where a break in product code made
/// the scenario that performs and checks it fail; a proof of anything else
/// is stale, and one that names what does not exist is broken.
#[test]
fn a_function_is_proved_only_by_a_break_that_failed_its_scenario() {
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
        checks: checks("function\tscenario\nF-001\tstate gmail_stars\n").unwrap(),
        proofs: proofs(
            "function\tprovider\tscenario\tbreak\n\
F-001\tgmail\tstate gmail_stars\tthe label change is not sent to Gmail\n\
F-001\toutlook\tstate outlook_stars\tthe flag is not sent to Outlook\n\
F-009\tgmail\tstate gmail_stars\tx\n\
F-001\tyahoo\tstate gmail_stars\tx\n\
F-001\tgmail\tstate gone\tx\n",
        )
        .unwrap(),
        waivers: Waivers::default(),
    };
    let records = vec![
        record("gmail_stars", "gmail", true),
        record("outlook_stars", "outlook", true),
    ];
    let model = build(&reader, &ledger, records, &Results::default());

    let row = model
        .functions
        .iter()
        .find(|row| row.id == "F-001")
        .unwrap();
    let gmail = row.gmail.as_ref().unwrap();
    assert_eq!(gmail.status, Status::Proved);
    assert_eq!(gmail.examples, vec!["state gmail_stars".to_owned()]);
    assert_eq!(
        gmail.reason.as_deref(),
        Some("the label change is not sent to Gmail")
    );
    // The Outlook scenario is not said to check the function: its proof
    // proves nothing.
    assert_eq!(row.outlook.as_ref().unwrap().status, Status::Performed);
    assert_eq!(model.stale.len(), 1, "{:?}", model.stale);
    assert!(model.stale[0].contains("`state outlook_stars` for F-001 on outlook"));

    assert_eq!(model.functions_gmail.proved, 1);
    assert_eq!(model.functions_gmail.claimed, 0);
    assert!(!model.gaps.is_empty());
    let broken = model.broken.join("\n");
    assert!(broken.contains("F-009 is not a function"), "{broken}");
    assert!(broken.contains("the provider `yahoo`"), "{broken}");
    assert!(
        broken.contains("the scenario `state gone` is not in the results"),
        "{broken}"
    );
    assert_eq!(model.broken.len(), 3, "{broken}");
    assert!(
        render::headline(&model).contains("Gmail 1 proved, 0 claimed, 2 performed only, 1 open"),
        "{}",
        render::headline(&model)
    );
    assert!(proofs("function\tprovider\tscenario\tbreak\nF-001\tgmail\tstate x\t \n").is_err());
}

/// What is left to the full-stack tier is neither waived nor open: an entry
/// point the ledger defers, and a function another service carries out.
#[test]
fn what_is_deferred_is_counted_apart_from_what_is_waived() {
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
        checks: Vec::new(),
        proofs: Vec::new(),
        waivers: toml::from_str(
            r#"
[[deferred]]
entry = "http GET /email/drafts/{id}/operation"
provider = "gmail"
reason = "needs the browser to sign in"

[[deferred]]
entry = "http GET /email/drafts/scheduled"
reason = "reached all the same"
"#,
        )
        .unwrap(),
    };
    let records = vec![record("gmail_stars", "gmail", true)];
    let model = build(&reader, &ledger, records, &Results::default());

    assert_eq!(model.broken, Vec::<String>::new());
    let row = model
        .entry_rows
        .iter()
        .find(|row| row.key == "GET /email/drafts/{id}/operation")
        .unwrap();
    let gmail = row.gmail.as_ref().unwrap();
    assert_eq!(gmail.status, Status::Deferred);
    assert_eq!(
        gmail.reason.as_deref(),
        Some("needs the browser to sign in")
    );
    assert_eq!(row.outlook.as_ref().unwrap().status, Status::Open);
    let http = model
        .entry_points
        .iter()
        .find(|kind| kind.kind == "http")
        .unwrap();
    assert_eq!((http.gmail.deferred, http.gmail.waived), (1, 0));
    assert_eq!(http.outlook.deferred, 1);
    // A deferred entry point a scenario reaches is no longer deferred.
    assert_eq!(model.stale.len(), 1, "{:?}", model.stale);
    assert!(model.stale[0].contains("is deferred on gmail and 1 scenarios reach it"));

    let search = model
        .functions
        .iter()
        .find(|row| row.id == "F-006")
        .unwrap();
    assert_eq!(search.deferred.as_deref(), Some("the search service"));
    let summary = render::markdown(&model);
    assert!(
        summary.contains("| F-006 | Search mail by text | deferred | deferred |"),
        "{summary}"
    );
    assert!(render::html(&model).contains("deferred to the full-stack tier: the search service"));
}

/// An entry point nothing calls is waived and listed with where it is.
#[test]
fn a_waiver_for_dead_code_is_listed_as_a_candidate() {
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
        checks: Vec::new(),
        proofs: Vec::new(),
        waivers: toml::from_str(
            r#"
[[dead_code]]
entry = "http GET /email/drafts/{id}/operation"
reason = "no client asks for it"

[[dead_code]]
entry = "http GET /email/gone"
reason = "x"
"#,
        )
        .unwrap(),
    };
    let model = build(&reader, &ledger, Vec::new(), &Results::default());

    let row = model
        .entry_rows
        .iter()
        .find(|row| row.key == "GET /email/drafts/{id}/operation")
        .unwrap();
    assert_eq!(row.gmail.as_ref().unwrap().status, Status::Waived);
    assert_eq!(row.outlook.as_ref().unwrap().status, Status::Waived);
    assert_eq!(model.dead_code.len(), 1);
    assert_eq!(
        (
            model.dead_code[0].entry.as_str(),
            model.dead_code[0].source.as_str(),
            model.dead_code[0].reason.as_str()
        ),
        (
            "http GET /email/drafts/{id}/operation",
            "a.rs:2",
            "no client asks for it"
        )
    );
    assert!(
        model
            .broken
            .iter()
            .any(|problem| problem.contains("[[dead_code]] names `http GET /email/gone`")),
        "{:?}",
        model.broken
    );
    let summary = render::markdown(&model);
    assert!(
        summary.contains(
            "### Dead code candidates\n\nEntry points waived because nothing in the repository \
             calls them.\n\n| Entry point | Source | Reason |\n| --- | --- | --- |\n\
             | `http GET /email/drafts/{id}/operation` | `a.rs:2` | no client asks for it |"
        ),
        "{summary}"
    );
    assert!(render::html(&model).contains("<h2>Dead code candidates</h2>"));
}

/// A known product bug keeps a function open whatever its scenarios show.
#[test]
fn a_function_with_a_known_bug_stays_open() {
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
        map: map(&MAP.replace("[F-001]\n", "[F-001]\nbug = \"BUG-7\"\n")).unwrap(),
        checks: checks("function\tscenario\nF-001\tstate gmail_stars\n").unwrap(),
        proofs: proofs(
            "function\tprovider\tscenario\tbreak\n\
F-001\tgmail\tstate gmail_stars\tthe label change is not sent to Gmail\n",
        )
        .unwrap(),
        waivers: Waivers::default(),
    };
    let records = vec![
        record("gmail_stars", "gmail", true),
        record("outlook_stars", "outlook", true),
    ];
    let model = build(&reader, &ledger, records, &Results::default());

    assert_eq!(model.broken, Vec::<String>::new());
    assert_eq!(model.stale, Vec::<String>::new());
    let row = model
        .functions
        .iter()
        .find(|row| row.id == "F-001")
        .unwrap();
    assert_eq!(row.bug.as_deref(), Some("BUG-7"));
    let gmail = row.gmail.as_ref().unwrap();
    assert_eq!((gmail.status, gmail.scenarios), (Status::Open, 0));
    assert_eq!(row.outlook.as_ref().unwrap().status, Status::Open);
    assert_eq!(model.functions_gmail.proved, 0);
    let summary = render::markdown(&model);
    assert!(
        summary.contains(
            "| F-001 | Star a thread | open (known bug BUG-7) | open (known bug BUG-7) |"
        ),
        "{summary}"
    );
    assert!(render::html(&model).contains("<small>known bug BUG-7</small>"));
    // The bug excuses the function, not the rest: F-002 is performed by the
    // same records and nothing is said to check it.
    let of = |id: &str| -> Vec<&String> {
        let function = format!("function {id} ");
        model
            .gaps
            .iter()
            .filter(|gap| gap.starts_with(&function))
            .collect()
    };
    assert!(of("F-001").is_empty(), "{:?}", model.gaps);
    assert_eq!(of("F-002").len(), 2, "{:?}", model.gaps);
}

/// What `--enforce` fails on is said line by line: a scenario that failed, a
/// function that is not proved, an entry point that is not reached, and a
/// scenario kept for a known bug that passes when the ledger does not say
/// its bug shows only now and then.
#[test]
fn every_gap_is_named() {
    use super::junit::Outcome;
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
        checks: checks("function\tscenario\nF-001\tstate gmail_stars\n").unwrap(),
        proofs: proofs(
            "function\tprovider\tscenario\tbreak\n\
F-001\tgmail\tstate gmail_stars\tthe label change is not sent to Gmail\n",
        )
        .unwrap(),
        waivers: toml::from_str(
            r#"
[[intermittent_bug]]
scenario = "state outlook_races"
reason = "the race is lost about one run in twenty"

[[intermittent_bug]]
scenario = "state gone"
reason = "no longer a scenario"
"#,
        )
        .unwrap(),
    };
    let mut results = Results::default();
    for (scenario, outcome) in [
        ("state gmail_stars", Outcome::Passed),
        ("state outlook_stars", Outcome::Failed),
    ] {
        results.outcomes.insert(scenario.to_owned(), outcome);
        results
            .passed_in
            .entry(scenario.to_owned())
            .or_default()
            .insert("run".to_owned());
    }
    let record_of = |test: &str, provider: &str| {
        let mut record = record(test, provider, true);
        record.run = Some("run".to_owned());
        record
    };
    let records = vec![
        record_of("gmail_stars", "gmail"),
        record_of("outlook_stars", "outlook"),
    ];
    let mut model = build(&reader, &ledger, records, &results);
    let mut known_bugs = Results::default();
    for (scenario, outcome) in [
        ("state gmail_fixed", Outcome::Passed),
        ("state outlook_races", Outcome::Passed),
        ("state gmail_still_broken", Outcome::Failed),
        // Failed, then passed when tried again: the bug still shows.
        ("state gmail_flickers", Outcome::Flaky(1)),
    ] {
        known_bugs.outcomes.insert(scenario.to_owned(), outcome);
    }
    judge_known_bugs(&mut model, &ledger, &known_bugs);

    let has = |text: &str| model.gaps.iter().any(|gap| gap.contains(text));
    assert!(
        has("scenario `state outlook_stars` failed"),
        "{:?}",
        model.gaps
    );
    // Proved on Gmail; on Outlook the only scenario failed.
    assert!(!has(
        "function F-001 (Star a thread) is not proved on gmail"
    ));
    assert!(has(
        "function F-001 (Star a thread) is not proved on outlook: no scenario performs it"
    ));
    assert!(has(
        "entry point `provider outlook:messages.update` is not reached on outlook"
    ));
    assert!(!has("entry point `provider gmail:messages.modify`"));
    assert!(has(
        "scenario `state gmail_fixed`, kept for a known bug, passes"
    ));
    assert!(!has("`state outlook_races`, kept for a known bug"));
    assert!(!has("gmail_still_broken"));
    assert!(!has("gmail_flickers"));
    assert!(has("[[intermittent_bug]] names `state gone`"));
    assert_eq!(model.suite.known_bugs_failing, 2);
    assert_eq!(
        model.suite.known_bugs_passing,
        ["state gmail_fixed", "state outlook_races"]
    );
    let summary = render::markdown(&model);
    assert!(
        summary.contains("Gaps (each fails the job under --enforce)"),
        "{summary}"
    );
}

/// Each job that runs scenarios for known bugs must have left its results:
/// one that left none would have its scenarios go unjudged. A run that had
/// no scenario left to run is not that.
#[test]
fn every_known_bug_job_must_leave_results() {
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
        checks: checks("function\tscenario\n").unwrap(),
        proofs: proofs("function\tprovider\tscenario\tbreak\n").unwrap(),
        waivers: Waivers::default(),
    };
    let dir = tempfile::tempdir().unwrap();
    let search = dir.path().join("search");
    let rest = dir.path().join("rest");
    std::fs::create_dir(&search).unwrap();
    std::fs::write(
        search.join("junit.xml"),
        "<testsuites name=\"nextest-run\" tests=\"0\" uuid=\"run\">\n</testsuites>\n",
    )
    .unwrap();

    let mut model = build(&reader, &ledger, Vec::new(), &Results::default());
    read_known_bugs(&mut model, &ledger, &[search.clone(), rest.clone()]).unwrap();
    assert_eq!(model.broken.len(), 1, "{:?}", model.broken);
    assert!(
        model.broken[0].contains("--known-bugs") && model.broken[0].contains("rest"),
        "{:?}",
        model.broken
    );

    let mut model = build(&reader, &ledger, Vec::new(), &Results::default());
    read_known_bugs(&mut model, &ledger, &[search]).unwrap();
    assert_eq!(model.broken, Vec::<String>::new());
}

/// A scenario is ignored only for a known bug, named in the reason.
#[test]
fn the_ignored_scenarios_name_their_bugs() {
    let (ids, others) = ignored(
        r##"
#[tokio::test]
#[ignore = "known bug: labels-wrong"]
async fn one() {}

#[ignore]
async fn two() {}

#[ignore = "slow"]
async fn three() {}

// #[ignore = "known bug: only-in-a-comment"]
async fn four() {
    let _ = "#[ignore = \"known bug: only-in-a-string\"]";
}
"##,
    )
    .unwrap();
    assert_eq!(ids, ["labels-wrong"]);
    assert_eq!(others, 2);
}

/// A bug on one provider leaves the function as its scenarios show it on the
/// other.
#[test]
fn a_known_bug_on_one_provider_leaves_the_other_alone() {
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
        map: map(&MAP.replace(
            "[F-001]\n",
            "[F-001]\nbug = \"BUG-7\"\nbug_on = \"outlook\"\n",
        ))
        .unwrap(),
        checks: checks("function\tscenario\nF-001\tstate gmail_stars\n").unwrap(),
        proofs: proofs(
            "function\tprovider\tscenario\tbreak\n\
F-001\tgmail\tstate gmail_stars\tthe label change is not sent to Gmail\n",
        )
        .unwrap(),
        waivers: Waivers::default(),
    };
    let records = vec![
        record("gmail_stars", "gmail", true),
        record("outlook_stars", "outlook", true),
    ];
    let model = build(&reader, &ledger, records, &Results::default());

    assert_eq!(model.broken, Vec::<String>::new());
    assert_eq!(model.stale, Vec::<String>::new());
    let row = model
        .functions
        .iter()
        .find(|row| row.id == "F-001")
        .unwrap();
    assert_eq!(row.gmail.as_ref().unwrap().status, Status::Proved);
    assert_eq!(row.outlook.as_ref().unwrap().status, Status::Open);
    let summary = render::markdown(&model);
    assert!(
        summary.contains("| F-001 | Star a thread | proved | open (known bug BUG-7) |"),
        "{summary}"
    );
}

/// An entry point is not a gap while a known bug holds every function it
/// takes part in open on that provider: no scenario that reaches it can pass.
#[test]
fn an_entry_point_behind_a_known_bug_is_not_a_gap() {
    let rows = parse_tsv(ROWS, "rows").unwrap();
    let sources = Sources::load(&repo()).unwrap();
    let schema = Schema::load(&repo()).unwrap();
    let reader = Reader {
        rows: &rows,
        sources: &sources,
        schema: &schema,
    };
    let bug = "bug = \"BUG-7\"\nbug_on = \"outlook\"\n";
    let gaps_with = |text: &str| {
        let ledger = Ledger {
            functions: functions(FUNCTIONS).unwrap(),
            map: map(text).unwrap(),
            checks: checks("function\tscenario\n").unwrap(),
            proofs: proofs("function\tprovider\tscenario\tbreak\n").unwrap(),
            waivers: Waivers::default(),
        };
        build(&reader, &ledger, Vec::new(), &Results::default()).gaps
    };
    let update = "entry point `provider outlook:messages.update` is not reached on outlook";
    let modify = "entry point `provider gmail:messages.modify` is not reached on gmail";

    // F-002 uses it too, and no bug holds F-002 open.
    let one = gaps_with(&MAP.replace("[F-001]\n", &format!("[F-001]\n{bug}")));
    assert!(one.iter().any(|gap| gap.contains(update)), "{one:?}");

    let both = gaps_with(
        &MAP.replace("[F-001]\n", &format!("[F-001]\n{bug}"))
            .replace("[F-002]\n", &format!("[F-002]\n{bug}")),
    );
    assert!(!both.iter().any(|gap| gap.contains(update)), "{both:?}");
    // The bug is on Outlook only.
    assert!(both.iter().any(|gap| gap.contains(modify)), "{both:?}");
}

/// An entry point another product's functions own is in none of email's
/// counts, reached or not, and is listed with whether a scenario reached it.
#[test]
fn an_owned_entry_point_is_counted_with_its_owner() {
    let rows = parse_tsv(
        &format!(
            "{ROWS}provider\tgmail:events.list\tgmail\t\tg.rs:1\n\
             provider\toutlook:events.list\toutlook\t\tg.rs:2\n"
        ),
        "rows",
    )
    .unwrap();
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
        checks: Vec::new(),
        proofs: Vec::new(),
        waivers: toml::from_str(
            r#"
[[owned]]
entry = "provider gmail:events.list"
owner = "calendar"

[[owned]]
entry = "provider outlook:events.list"
provider = "outlook"
owner = "calendar"
"#,
        )
        .unwrap(),
    };
    let mut reaches_events = record("gmail_lists_events", "gmail", true);
    reaches_events.provider.push(
        serde_json::from_value(json!({
            "provider": "gmail", "route": "events.list", "method": "GET", "status": 200
        }))
        .unwrap(),
    );
    let model = build(&reader, &ledger, vec![reaches_events], &Results::default());

    assert_eq!(model.broken, Vec::<String>::new());
    assert_eq!(model.stale, Vec::<String>::new());
    let row = model
        .entry_rows
        .iter()
        .find(|row| row.key == "gmail:events.list")
        .unwrap();
    let gmail = row.gmail.as_ref().unwrap();
    assert_eq!((gmail.status, gmail.scenarios), (Status::Owned, 1));
    assert_eq!(
        gmail.reason.as_deref(),
        Some("counted with the calendar functions")
    );
    // Only the two mail methods are counted: one reached, one open.
    let provider = model
        .entry_points
        .iter()
        .find(|kind| kind.kind == "provider")
        .unwrap();
    assert_eq!((provider.gmail.total, provider.gmail.covered), (1, 1));
    assert_eq!((provider.outlook.total, provider.outlook.open), (1, 1));
    let owned: Vec<_> = model
        .owned
        .iter()
        .map(|row| {
            (
                row.entry.as_str(),
                row.source.as_str(),
                row.owner.as_str(),
                row.gmail,
                row.outlook,
            )
        })
        .collect();
    assert_eq!(
        owned,
        [
            (
                "provider gmail:events.list",
                "g.rs:1",
                "calendar",
                Some(true),
                None
            ),
            (
                "provider outlook:events.list",
                "g.rs:2",
                "calendar",
                None,
                Some(false)
            ),
        ]
    );
    assert_eq!(
        serde_json::to_value(&model).unwrap()["owned"][1],
        json!({
            "entry": "provider outlook:events.list", "source": "g.rs:2", "owner": "calendar",
            "gmail": null, "outlook": false
        })
    );
    let summary = render::markdown(&model);
    assert!(
        summary.contains(
            "### Counted with the calendar functions\n\nEntry points the calendar functions \
             call, not email's: counted there, and in none of the totals above.\n\n\
             | Entry point | Source | Gmail | Outlook |\n| --- | --- | --- | --- |\n\
             | `provider gmail:events.list` | `g.rs:1` | reached | n/a |\n\
             | `provider outlook:events.list` | `g.rs:2` | n/a | not reached |"
        ),
        "{summary}"
    );
    assert!(!summary.contains("| `provider outlook:events.list` | n/a | open |"));
    assert!(render::html(&model).contains("<h2>Counted with the calendar functions</h2>"));
}

/// What another product's functions own cannot also be email's: not in the
/// list, waived, deferred, dead code or mapped to a function.
#[test]
fn an_owned_entry_point_that_email_also_accounts_for_is_broken() {
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
        checks: Vec::new(),
        proofs: Vec::new(),
        waivers: toml::from_str(
            r#"
[[entry_point]]
entry = "http GET /email/drafts/{id}/operation"
provider = "gmail"
reason = "x"

[[deferred]]
entry = "http GET /email/drafts/{id}/operation"
provider = "outlook"
reason = "x"

[[dead_code]]
entry = "http GET /email/drafts/scheduled"
reason = "x"

[[owned]]
entry = "provider gmail:events.gone"
owner = "calendar"

[[owned]]
entry = "http GET /email/drafts/{id}/operation"
owner = "calendar"

[[owned]]
entry = "http GET /email/drafts/scheduled"
provider = "gmail"
owner = "calendar"

[[owned]]
entry = "provider gmail:messages.modify"
provider = "yahoo"
owner = "calendar"
"#,
        )
        .unwrap(),
    };
    let model = build(&reader, &ledger, Vec::new(), &Results::default());

    for problem in [
        "[[owned]] names `provider gmail:events.gone`, which is not in",
        "`http GET /email/drafts/{id}/operation` is both owned by calendar and waived on gmail",
        "`http GET /email/drafts/{id}/operation` is both owned by calendar and deferred on outlook",
        "`http GET /email/drafts/scheduled` is both owned by calendar and waived on gmail",
        "`http GET /email/drafts/scheduled` is owned by calendar in \
         crates/email_e2e/coverage/waivers.toml and mapped in \
         crates/email_e2e/coverage/functions.toml",
        "`provider gmail:messages.modify` is owned by calendar in",
        "[[owned]] names the provider `yahoo`",
    ] {
        assert!(
            model.broken.iter().any(|found| found.contains(problem)),
            "{problem}: {:?}",
            model.broken
        );
    }
}

/// A selection that `@skip` or `@include` may have left out did not
/// certainly run: it counts only when its condition is written out and lets
/// it run.
#[test]
fn a_selection_a_directive_may_leave_out_is_not_counted() {
    let schema = Schema::parse(
        "type Query { thread: Thread }\n\
         type Thread { subject: String, labels: [Label], owner: Owner, snippet: String }\n\
         type Label { name: String }\n\
         type Owner { name: String }",
    )
    .unwrap();

    let found = schema
        .coordinates(
            "query($with: Boolean!) { thread { \
               subject @skip(if: true) \
               snippet @include(if: true) \
               labels @include(if: $with) { name } \
               ... on Thread @skip(if: false) { owner { name } } \
               ...Rest @include(if: false) \
             } } \
             fragment Rest on Thread { labels { name } }",
        )
        .unwrap();

    assert_eq!(
        found.into_iter().collect::<Vec<_>>(),
        [
            "Owner.name",
            "Query.thread",
            "Thread.owner",
            "Thread.snippet"
        ]
    );
}

/// A record counts only for the run that wrote it: one an earlier run left
/// behind is not credited to a later run in which the scenario passed and
/// left none.
#[test]
fn a_record_of_another_run_is_not_counted() {
    use super::junit::Outcome;
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
        checks: checks("function\tscenario\n").unwrap(),
        proofs: Vec::new(),
        waivers: Waivers::default(),
    };
    let scenario = "state gmail_stars".to_owned();
    let mut results = Results::default();
    results.outcomes.insert(scenario.clone(), Outcome::Passed);
    results
        .passed_in
        .entry(scenario)
        .or_default()
        .insert("new".to_owned());
    let record_of = |run: Option<&str>| {
        let mut record = record("gmail_stars", "gmail", true);
        record.run = run.map(str::to_owned);
        record
    };

    let recorded = |run| build(&reader, &ledger, vec![record_of(run)], &results).suite;
    assert_eq!(recorded(Some("old")).recorded, 0);
    assert_eq!(recorded(Some("old")).unrecorded, ["state gmail_stars"]);
    assert_eq!(recorded(None).recorded, 0);
    assert_eq!(recorded(Some("new")).recorded, 1);
}
