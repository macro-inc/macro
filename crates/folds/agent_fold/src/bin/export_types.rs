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
    // Optional notification errors are omitted on output but accepted as null
    // on input; phased types preserve both without weakening the payload union.
    let generated = Typescript::default().export(&types, specta_serde::PhasesFormat)?;
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");

    // The web client folds in the browser; the SDK reads the same messages
    // folded by `GET /agent-sessions/{id}/log/folded`.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for output in [
        "apps/web/src/lib/service-clients/service-agent-fold/generated/types.ts",
        "packages/sdk/generated/agent-fold/index.ts",
    ] {
        let output = root.join(output);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output, format!("{generated}\n"))?;
    }
    Ok(())
}
