use super::*;
use ai_toolset::ToolLoader;
use schemars::Schema;
use std::sync::{Arc, Mutex};

fn tool(name: &str, description: &str) -> SearchableTool {
    SearchableTool {
        name: name.to_string(),
        description: description.to_string(),
        schema: Schema::default(),
    }
}

fn catalog() -> Vec<SearchableTool> {
    vec![
        tool(
            "mcp__slack__send_message",
            "Post a message to a Slack channel",
        ),
        tool("mcp__gmail__list_threads", "List email threads in Gmail"),
        tool("mcp__linear__create_issue", "Create a Linear issue"),
    ]
}

/// A loader that records the names of tools it was asked to load.
fn recording_loader() -> (ToolLoader, Arc<Mutex<Vec<String>>>) {
    let recorded = Arc::new(Mutex::new(Vec::new()));
    let sink = recorded.clone();
    let loader = ToolLoader::new(move |tools| {
        sink.lock()
            .unwrap()
            .extend(tools.into_iter().map(|t| t.name));
    });
    (loader, recorded)
}

fn names(matches: &[ToolMatch]) -> Vec<&str> {
    matches.iter().map(|m| m.name.as_str()).collect()
}

// --- search (discovery only, never loads) ---

#[test]
fn search_matches_by_name() {
    let results = search(&catalog(), "linear");
    assert_eq!(names(&results), vec!["mcp__linear__create_issue"]);
}

#[test]
fn search_matches_by_description_case_insensitive() {
    // "EMAIL" matches the Gmail tool's description ("email threads").
    let results = search(&catalog(), "EMAIL");
    assert_eq!(names(&results), vec!["mcp__gmail__list_threads"]);
}

#[test]
fn search_no_match_returns_empty() {
    assert!(search(&catalog(), "notion").is_empty());
}

#[test]
fn search_empty_query_returns_all() {
    assert_eq!(search(&catalog(), "").len(), 3);
}

#[test]
fn search_multi_word_matches_any_term_and_ranks_by_term_count() {
    // "slack" + "message" both hit the Slack tool (score 2); "linear" hits the
    // Linear tool (score 1); Gmail matches none.
    let results = search(&catalog(), "slack message linear");
    assert_eq!(
        names(&results),
        vec!["mcp__slack__send_message", "mcp__linear__create_issue"]
    );
}

#[test]
fn search_is_uncapped() {
    let big: Vec<SearchableTool> = (0..50)
        .map(|i| tool(&format!("mcp__svc__tool_{i:02}"), "a tool"))
        .collect();
    assert_eq!(search(&big, "tool").len(), 50);
}

// --- load (registers named tools via the loader) ---

#[test]
fn load_loads_named_tools_and_reports_them() {
    let (loader, loaded) = recording_loader();
    let result = load(
        &catalog(),
        &["mcp__linear__create_issue".to_string()],
        Some(&loader),
    );

    assert_eq!(names(&result.loaded), vec!["mcp__linear__create_issue"]);
    assert!(result.not_found.is_empty());
    // The found tool was handed to the loader for registration.
    assert_eq!(&*loaded.lock().unwrap(), &["mcp__linear__create_issue"]);
}

#[test]
fn load_reports_unknown_names_and_loads_the_rest() {
    let (loader, loaded) = recording_loader();
    let result = load(
        &catalog(),
        &[
            "mcp__slack__send_message".to_string(),
            "mcp__nope__missing".to_string(),
        ],
        Some(&loader),
    );

    assert_eq!(names(&result.loaded), vec!["mcp__slack__send_message"]);
    assert_eq!(result.not_found, vec!["mcp__nope__missing".to_string()]);
    assert_eq!(&*loaded.lock().unwrap(), &["mcp__slack__send_message"]);
}

#[test]
fn load_without_loader_still_reports() {
    let result = load(&catalog(), &["mcp__gmail__list_threads".to_string()], None);
    assert_eq!(names(&result.loaded), vec!["mcp__gmail__list_threads"]);
    assert!(result.not_found.is_empty());
}
