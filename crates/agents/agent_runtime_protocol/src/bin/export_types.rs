//! Export the Rust wire contract as TypeScript.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_runtime_protocol --bin export_types
//! ```

use std::fs;
use std::path::Path;

use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use specta::Types;
use specta_typescript::Typescript;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let types = Types::default()
        .register::<ToRuntimeMessage>()
        .register::<ToServerMessage>();
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../services/coding-agent-worker/src/protocol/generated.ts");

    let generated = Typescript::default().export(&types, specta_serde::PhasesFormat)?;
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(output, format!("{generated}\n"))?;
    Ok(())
}
