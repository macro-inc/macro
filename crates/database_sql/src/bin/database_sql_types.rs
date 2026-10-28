//! Export the engine's wire contract as TypeScript.
//!
//! Run with:
//!
//! ```text
//! cargo run -p database_sql --features cli --bin database_sql_types
//! ```

use database_sql::catalog::Schema;
use database_sql::formula::FormulaReading;
use database_sql::{Bin, Board, Catalog, EngineError, Outcome, Page, Step};
use models_databases::views::{CardPosition, DatabaseView};
use models_databases::{Formula, OpResult};
use specta::Types;
use specta::datatype::{DataType, Fields};
use specta_typescript::Typescript;
use specta_typescript::semantic::Configuration;
use std::fs;
use std::path::Path;

// `specta_serde`'s spellings of the two field attributes; the crate is pinned.
const FIELD_DEFAULT: &str = "serde:field:default";
const FIELD_SKIP_SERIALIZING_IF: &str = "serde:field:skip_serializing_if";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // What the `wasm` entry points read, return and throw; everything else
    // is reached from these.
    let types = Types::default()
        .register::<Schema>()
        .register::<Catalog>()
        .register::<Step>()
        .register::<Page>()
        .register::<Bin>()
        .register::<OpResult>()
        .register::<Outcome>()
        .register::<DatabaseView>()
        .register::<CardPosition>()
        .register::<Board>()
        .register::<EngineError>()
        .register::<FormulaReading>()
        .register::<Formula>();
    // serde-wasm-bindgen hands `NaN` and the infinities across as numbers,
    // so an `f64` is a plain `number` rather than JSON's `number | null`.
    let types = Configuration::empty()
        .enable_lossless_floats()
        .apply_types(&types)
        .into_owned();
    let types = symmetric_omissions(types);
    let types = apart_from_the_catalog(types);
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/src/lib/core/database-sql/generated/types.ts");

    let generated = Typescript::default().export(&types, specta_serde::Format)?;
    let generated = generated
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    fs::create_dir_all(output.parent().ok_or("the output has a directory")?)?;
    fs::write(output, format!("{generated}\n"))?;
    Ok(())
}

/// The ops name a column type and an entity kind as the catalog does, but
/// mean something narrower (no options, no relations); TypeScript gets them
/// under names of their own.
fn apart_from_the_catalog(types: Types) -> Types {
    types.map(|mut named| {
        if named.module_path.starts_with("models_databases") {
            match named.name.as_ref() {
                "ColumnKind" => named.name = "OpColumnKind".into(),
                "EntityKind" => named.name = "OpEntityKind".into(),
                _ => {}
            }
        }
        named
    })
}

/// `specta_serde::Format` refuses every `skip_serializing_if`, because an
/// omission on write alone would make the two directions differ. A field
/// that is also `default` may be absent both ways, so it is one optional
/// field and the attribute says nothing more; drop it there, in a struct or
/// in an enum variant. A field without `default` keeps it, and the export
/// fails on it.
fn symmetric_omissions(types: Types) -> Types {
    types.map(|mut named| {
        match &mut named.ty {
            Some(DataType::Struct(structure)) => drop_symmetric_omissions(&mut structure.fields),
            Some(DataType::Enum(enumeration)) => {
                for (_, variant) in &mut enumeration.variants {
                    drop_symmetric_omissions(&mut variant.fields);
                }
            }
            _ => {}
        }
        named
    })
}

fn drop_symmetric_omissions(fields: &mut Fields) {
    if let Fields::Named(fields) = fields {
        for (_, field) in &mut fields.fields {
            if field.attributes.contains_key(FIELD_DEFAULT) {
                field.attributes.remove(FIELD_SKIP_SERIALIZING_IF);
            }
        }
    }
}
