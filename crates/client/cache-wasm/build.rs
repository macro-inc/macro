//! Parses the bundled GraphQL schema when the engine is built, so an engine
//! worker decodes its lookup tables instead of parsing the schema's SDL each
//! time it starts, and takes the schema's hash with them instead of computing
//! it again.
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=../../../static_assets/schema.graphql");
    let schema = cache_schema::Schema::from_sdl(cache_schema::BUNDLED_SCHEMA_SDL)
        .expect("the bundled schema parses");
    let tables = postcard::to_allocvec(schema.artifact()).expect("schema tables encode");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    std::fs::write(out.join("bundled_schema.postcard"), tables).expect("write schema tables");
    std::fs::write(out.join("bundled_schema.hash"), schema.hash()).expect("write schema hash");
}
