use super::*;
use crate::RequestContext;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

fn tool(name: &str) -> SearchableTool {
    SearchableTool {
        name: name.to_string(),
        description: String::new(),
        schema: Schema::default(),
    }
}

#[test]
fn tool_loader_forwards_to_its_closure() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = seen.clone();
    let loader = ToolLoader::new(move |tools| {
        sink.lock()
            .unwrap()
            .extend(tools.into_iter().map(|t| t.name));
    });

    loader.load(vec![tool("a"), tool("b")]);

    assert_eq!(&*seen.lock().unwrap(), &["a".to_string(), "b".to_string()]);
}

#[test]
fn request_context_new_has_no_tool_search() {
    let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();
    let ctx = RequestContext::new(user);
    assert!(ctx.searchable_tools.is_empty());
    assert!(ctx.tool_loader.is_none());
}

#[test]
fn with_tool_search_wires_catalog_and_loader() {
    let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();
    let catalog = Arc::new(vec![tool("mcp__x__y")]);
    let loader = ToolLoader::new(|_| {});
    let ctx = RequestContext::new(user).with_tool_search(catalog, loader);

    assert_eq!(ctx.searchable_tools.len(), 1);
    assert_eq!(ctx.searchable_tools[0].name, "mcp__x__y");
    assert!(ctx.tool_loader.is_some());
}

#[test]
fn tools_loaded_by_reads_search_and_load_results() {
    let search = serde_json::json!({
        "results": [{ "name": "ReadInitiative", "description": "Read a project" }],
        "additional_matches": [{ "name": "ListInitiatives", "description": "List projects" }],
    })
    .to_string();
    let load = serde_json::json!({
        "loaded": [{ "name": "ReadInitiative", "description": "Read a project" }],
        "not_found": ["ReadInitiatives"],
    })
    .to_string();

    assert_eq!(tools_loaded_by(SEARCH_TOOLS, &search), ["ReadInitiative"]);
    assert_eq!(tools_loaded_by(LOAD_TOOLS, &load), ["ReadInitiative"]);
    assert!(tools_loaded_by("ReadInitiative", &load).is_empty());
    assert!(tools_loaded_by(LOAD_TOOLS, "Tool call failed").is_empty());
}
