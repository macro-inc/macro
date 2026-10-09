//! Fingerprint the embedded SDL for build diagnostics only.
use sha2::{Digest, Sha256};
fn main() {
    let path = "../../../static_assets/schema.graphql";
    println!("cargo:rerun-if-changed={path}");
    let sdl = std::fs::read(path).expect("read bundled schema");
    println!(
        "cargo:rustc-env=CACHE_BUNDLED_SCHEMA_HASH={:x}",
        Sha256::digest(sdl)
    );
}
