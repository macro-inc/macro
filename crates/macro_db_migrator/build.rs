use std::hash::{DefaultHasher, Hash, Hasher};

const MIGRATIONS: &str = "../macro_db_client/migrations";

fn main() {
    // sqlx::migrate! tracks existing files, but stable Rust does not track newly
    // added migrations. Rebuild the embedded migrator when the directory changes.
    println!("cargo:rerun-if-changed={MIGRATIONS}");

    // sccache keys this crate on its compiler arguments, not on the files the
    // macro reads, so a renamed or added migration could reuse a stale build.
    // Fingerprinting the migrations into a cfg puts them in that key.
    let mut entries: Vec<_> = std::fs::read_dir(MIGRATIONS)
        .expect("the migrations directory sits beside this crate")
        .map(|entry| entry.expect("migration entries are readable").path())
        .collect();
    entries.sort();
    let mut hasher = DefaultHasher::new();
    for path in entries {
        path.file_name().hash(&mut hasher);
        std::fs::read(&path)
            .expect("migration files are readable")
            .hash(&mut hasher);
    }
    println!("cargo::rustc-check-cfg=cfg(macro_db_migrations, values(any()))");
    println!(
        "cargo:rustc-cfg=macro_db_migrations=\"{:016x}\"",
        hasher.finish()
    );
}
