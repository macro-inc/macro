//! Binary to generate AI tools JSON schema.
//!
//! Usage: cargo run -p document_cognition_service --bin document_cognition_service_tools_schema

fn main() {
    let tool_schemas =
        serde_json::to_string_pretty(&ai_tools::all_tool_schemas()).expect("tool schemas");
    println!("{}", tool_schemas);
}
