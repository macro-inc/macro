//! Export the fold's wire contract as TypeScript.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_fold --bin export_types
//! ```

use agent_fold::domain::model::SessionMetadata;
use agent_fold::inbound::wire::{FoldedMessage, FoldedStreamEvent};
use specta::Types;
use specta_typescript::Typescript;
use std::fs;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let types = Types::default()
        .register::<FoldedMessage>()
        .register::<FoldedStreamEvent>()
        .register::<SessionMetadata>();
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/src/lib/service-clients/service-agent-fold/generated/types.ts");

    let generated = Typescript::default().export(&types, specta_serde::Format)?;
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(output, format!("{generated}\n"))?;
    Ok(())
}
