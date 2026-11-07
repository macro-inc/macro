//! Export the view's TypeScript types for the web renderer.
//!
//! Run with:
//!
//! ```text
//! cargo run -p dynamic_ui --features cli --bin export_view_types
//! ```

use dynamic_ui::View;
use specta::Types;
use specta_typescript::Typescript;
use std::fs;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let types = Types::default().register::<View>();
    let generated = Typescript::default().export(&types, specta_serde::PhasesFormat)?;
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");

    // The web renders views; lexical-core types the views stored in DM
    // messages and cannot import from the web app.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for output in [
        "apps/web/src/features/dynamic-ui/generated/types.ts",
        "packages/lexical-core/generated/dynamic-ui.ts",
    ] {
        let output = root.join(output);
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output, format!("{generated}\n"))?;
    }
    Ok(())
}
