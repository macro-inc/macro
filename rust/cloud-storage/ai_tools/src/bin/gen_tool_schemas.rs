//! Binary to generate combined tool schemas JSON file.

fn main() {
    let mut combined = ai_tools::all_tool_combined_schema();
    combined.mangle_collisions();
    let json = serde_json::to_string_pretty(&combined).expect("serialize schemas");
    std::fs::create_dir("schemas").expect("create schemas dir");
    std::fs::write("schemas/tools.json", &json).expect("write tools.json");
    println!("Generated ai_tools/schemas/tools.json");
}
