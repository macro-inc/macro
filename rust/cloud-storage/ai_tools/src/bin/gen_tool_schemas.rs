//! Binary to generate tool schemas JSON file.

fn main() {
    let schemas = ai_tools::all_tool_schemas();
    let json = serde_json::to_string_pretty(&schemas).expect("serialize schemas");
    std::fs::create_dir("schemas").expect("create schemas dir");
    std::fs::write("schemas/tools.json", &json).expect("write tools.json");
    println!("Generated ai_tools/schemas/tools.json");
}
