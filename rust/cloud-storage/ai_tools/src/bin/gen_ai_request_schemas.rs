//! Binary to dump the JSON schema for every tool exactly as it is sent to
//! AI providers.
//!
//! The chat agent loop reads tools via `ToolSet::request_schemas` and wraps
//! each one in a rig `ToolDefinition { name, description: "", parameters }`
//! (see `agent::DynToolSetAdapter`) — tool descriptions live inside the
//! schema itself. This binary serializes those definitions verbatim.
//!
//! Usage: `cargo run -p ai_tools --bin gen_ai_request_schemas [out_path]`
//! Defaults to `ai_tools/schemas/ai_request_schemas.json`.

use ai_toolset::ToolSet;

fn main() {
    let out_path = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/schemas/ai_request_schemas.json"
        )
        .to_string()
    });

    let tools = ai_tools::all_tools();
    let schemas = tools.toolset.request_schemas().unwrap_or_default();

    let definitions = schemas
        .iter()
        .map(|s| {
            let mut parameters = serde_json::to_value(&s.schema).expect("serialize tool schema");
            agent::normalize_request_schema(&mut parameters);
            serde_json::json!({
                "name": s.name,
                "description": "",
                "parameters": parameters,
            })
        })
        .collect::<Vec<_>>();

    let json = serde_json::to_string_pretty(&serde_json::json!({ "tools": definitions }))
        .expect("serialize tool definitions");

    if let Some(parent) = std::path::Path::new(&out_path).parent() {
        std::fs::create_dir_all(parent).expect("create output dir");
    }
    std::fs::write(&out_path, &json).expect("write schema file");
    println!("Wrote {} tool definitions to {out_path}", definitions.len());
}
