use std::{
    env, fs,
    path::{Path, PathBuf},
};
fn collect(directory: &Path, names: &mut Vec<String>) {
    let mut files: Vec<_> = fs::read_dir(directory)
        .expect("source directory")
        .map(|e| e.expect("source entry").path())
        .collect();
    files.sort();
    for path in files {
        if path.is_dir() {
            collect(&path, names);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let source = fs::read_to_string(path).expect("Rust source");
            for declaration in source.split("static ").skip(1) {
                let Some((header, _)) = declaration.split_once('=') else {
                    continue;
                };
                let compact: String = header.chars().filter(|c| !c.is_whitespace()).collect();
                if compact.contains("LazyLock<RegexMatcher>") {
                    let name = header.split(':').next().expect("static name").trim();
                    names.push(name.into());
                }
            }
        }
    }
}
fn main() {
    println!("cargo:rerun-if-changed=src");
    let mut names = Vec::new();
    collect(Path::new("src"), &mut names);
    names.sort();
    let output = format!("const SOURCE_REGEX_NAMES: &[&str] = &{:?};", names);
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("regex_inventory.rs"),
        output,
    )
    .expect("write regex inventory");
}
