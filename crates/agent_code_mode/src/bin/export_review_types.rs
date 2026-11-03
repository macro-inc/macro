//! Export the review wire contract as TypeScript.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_code_mode --bin export_review_types
//! ```

use agent_code_mode::domain::reviews::{CreateReview, ReviewDecision, ReviewRecord};
use specta::Types;
use specta_typescript::Typescript;
use std::fs;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let types = Types::default()
        .register::<CreateReview>()
        .register::<ReviewDecision>()
        .register::<ReviewRecord>();
    // Defaulted fields are optional on input and always present on output.
    let generated = Typescript::default().export(&types, specta_serde::PhasesFormat)?;
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");

    // The web review card and the SDK's review handles read the same records.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for output in [
        "apps/web/src/lib/service-clients/service-agent-reviews/generated/types.ts",
        "packages/sdk/generated/agent-reviews/index.ts",
    ] {
        let output = root.join(output);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output, format!("{generated}\n"))?;
    }
    Ok(())
}
