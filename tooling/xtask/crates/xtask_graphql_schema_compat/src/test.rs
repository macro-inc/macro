use chrono::NaiveDate;

use super::{incompatible_changes, parse_schema};

const TODAY: &str = "2026-10-17";

fn problems(base: &str, new: &str) -> Vec<String> {
    let today = NaiveDate::parse_from_str(TODAY, "%Y-%m-%d").unwrap();
    let base = parse_schema(base, "base.graphql").unwrap();
    let new = parse_schema(new, "new.graphql").unwrap();
    incompatible_changes(&base, &new, today)
}

const BASE: &str = r#"
schema { query: Query }
type Query {
  soup(filter: Filter, limit: Int): [Entity!]!
  thread(id: ID!): Thread
}
interface Entity { id: ID! }
type Thread implements Entity {
  id: ID!
  subject: String!
  snippet: String
  kind: Kind!
}
type Reminder implements Entity { id: ID! }
union Item = Thread | Reminder
enum Kind { MAIL CHAT }
input Filter { threadFilter: String, reminderFilter: String }
"#;

#[test]
fn identical_schemas_are_compatible() {
    assert_eq!(problems(BASE, BASE), Vec::<String>::new());
}

#[test]
fn committed_schema_is_compatible_with_itself() {
    let sdl = include_str!("../../../../../static_assets/schema.graphql");
    assert_eq!(problems(sdl, sdl), Vec::<String>::new());
}

#[test]
fn removals_are_breaking() {
    let new = BASE
        .replace("  snippet: String\n", "")
        .replace("type Reminder implements Entity { id: ID! }\n", "")
        .replace("union Item = Thread | Reminder", "union Item = Thread")
        .replace("enum Kind { MAIL CHAT }", "enum Kind { MAIL }")
        .replace(", reminderFilter: String", "")
        .replace(", limit: Int", "");
    assert_eq!(
        problems(BASE, &new),
        [
            "argument `Query.soup(limit:)` was removed",
            "field `Thread.snippet` was removed",
            "type `Reminder` was removed",
            "`Reminder` was removed from union `Item`",
            "enum value `Kind.CHAT` was removed",
            "input field `Filter.reminderFilter` was removed",
        ]
    );
}

#[test]
fn expired_marker_allows_removal() {
    let base = BASE
        .replace(
            "snippet: String",
            r#"snippet: String @deprecated(reason: "Use subject. Remove after 2026-10-17.")"#,
        )
        .replace(
            "type Reminder implements",
            "\"\"\"\nGone. Remove\n  after 2026-10-01.\n\"\"\"\ntype Reminder implements",
        );
    let new = base
        .replace("  snippet: String @deprecated(reason: \"Use subject. Remove after 2026-10-17.\")\n", "")
        .replace("\"\"\"\nGone. Remove\n  after 2026-10-01.\n\"\"\"\ntype Reminder implements Entity { id: ID! }\n", "")
        .replace("union Item = Thread | Reminder", "union Item = Thread");
    assert_eq!(problems(&base, &new), Vec::<String>::new());
}

#[test]
fn unexpired_marker_blocks_removal() {
    let base = BASE.replace(
        "snippet: String",
        r#"snippet: String @deprecated(reason: "Remove after 2026-10-18.")"#,
    );
    let new = base.replace(
        "  snippet: String @deprecated(reason: \"Remove after 2026-10-18.\")\n",
        "",
    );
    assert_eq!(
        problems(&base, &new),
        ["field `Thread.snippet` was removed"]
    );
}

#[test]
fn new_marker_needs_the_minimum_window() {
    let soon = BASE.replace(
        "snippet: String",
        r#"snippet: String @deprecated(reason: "Remove after 2026-11-15.")"#,
    );
    assert_eq!(
        problems(BASE, &soon),
        [
            "`Thread.snippet` is marked `Remove after 2026-11-15`; a new removal date must be on or after 2026-11-16 (30 days out)"
        ]
    );
    let later = BASE.replace(
        "snippet: String",
        r#"snippet: String @deprecated(reason: "Remove after 2026-11-16.")"#,
    );
    assert_eq!(problems(BASE, &later), Vec::<String>::new());
    assert_eq!(problems(&soon, &soon), Vec::<String>::new());
}

#[test]
fn output_types_may_only_narrow() {
    let narrowed = BASE.replace("snippet: String", "snippet: String!");
    assert_eq!(problems(BASE, &narrowed), Vec::<String>::new());
    let widened = BASE.replace("subject: String!", "subject: String");
    assert_eq!(
        problems(BASE, &widened),
        ["field `Thread.subject` changed type from `String!` to `String`"]
    );
}

#[test]
fn inputs_may_not_become_required() {
    let required = BASE.replace("soup(filter: Filter,", "soup(filter: Filter!,");
    assert_eq!(
        problems(BASE, &required),
        ["argument `Query.soup(filter:)` changed type from `Filter` to `Filter!`"]
    );
    let added = BASE.replace("thread(id: ID!)", "thread(id: ID!, scope: String!)");
    assert_eq!(
        problems(BASE, &added),
        ["required argument `Query.thread(scope:)` was added"]
    );
    let defaulted = BASE.replace(
        "thread(id: ID!)",
        "thread(id: ID!, scope: String! = \"all\")",
    );
    assert_eq!(problems(BASE, &defaulted), Vec::<String>::new());
    let relaxed = BASE.replace("thread(id: ID!)", "thread(id: ID)");
    assert_eq!(problems(BASE, &relaxed), Vec::<String>::new());
}

#[test]
fn dropped_interface_and_kind_change_are_breaking() {
    let new = BASE
        .replace("type Thread implements Entity {", "type Thread {")
        .replace("enum Kind { MAIL CHAT }", "scalar Kind");
    assert_eq!(
        problems(BASE, &new),
        [
            "`Thread` no longer implements `Entity`",
            "type `Kind` changed kind",
        ]
    );
}
