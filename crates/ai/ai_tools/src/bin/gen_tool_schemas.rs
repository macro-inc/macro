//! Generate frontend transcript schemas or the current public MCP registry.

use clap::Parser;

#[derive(Parser)]
struct Args {
    /// Export the executable public MCP registry instead of transcript schemas.
    #[arg(long)]
    mcp: bool,
}

fn main() {
    let public_mcp = Args::parse().mcp;
    let schemas = if public_mcp {
        ai_toolset::schema::frontend_schemas_builder()
            .merge(&ai_tools::tools_for(ai_tools::AiHost::Mcp))
            .build()
    } else {
        ai_tools::all_tool_frontend_schemas()
    };
    let json = schemas.to_json_pretty().expect("serialize schemas");
    std::fs::create_dir_all("schemas").expect("create schemas dir");
    let output = if public_mcp {
        "schemas/mcp-tools.json"
    } else {
        "schemas/tools.json"
    };
    std::fs::write(output, &json).expect("write tool schemas");
    println!("Generated {output}");
}
