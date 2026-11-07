//! Embed the shared tooling pin without runtime filesystem access.
fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest directory");
    let pin = std::path::Path::new(&manifest)
        .join("../../../../packages/lexical-conformance/upstream.lock");
    println!("cargo:rerun-if-changed={}", pin.display());
    let contents = std::fs::read_to_string(pin).expect("shared upstream pin");
    let value: serde_json::Value =
        serde_json::from_str(&contents).expect("valid upstream pin JSON");
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .expect("upstream version");
    println!("cargo:rustc-env=LEXICAL_UPSTREAM_VERSION={version}");
}
