use std::{env, fs, path::PathBuf};
fn main() {
    println!("cargo:rerun-if-changed=src/patterns.rs");
    let source = fs::read_to_string("src/patterns.rs").expect("pattern source");
    let names: Vec<_> = source
        .lines()
        .filter_map(|line| line.trim().strip_prefix("pub(crate) static "))
        .filter_map(|line| line.split(':').next())
        .collect();
    let output = format!("const SOURCE_REGEX_NAMES: &[&str] = &{:?};", names);
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("regex_inventory.rs"),
        output,
    )
    .expect("write regex inventory");
}
