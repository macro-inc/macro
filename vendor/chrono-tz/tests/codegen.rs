use std::path::PathBuf;
use std::{env, fs};

#[test]
fn codegen() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("src/prebuilt");
    let old_directory = fs::read_to_string(root.join("directory.rs")).unwrap();
    let old_timezones = fs::read_to_string(root.join("timezones.rs")).unwrap();

    fs::create_dir_all(&root).unwrap();
    chrono_tz_build::main(&root, false, false);
    let new_directory = fs::read_to_string(root.join("directory.rs")).unwrap();
    let new_timezones = fs::read_to_string(root.join("timezones.rs")).unwrap();

    if old_directory != new_directory || old_timezones != new_timezones {
        panic!("prebuilt files changed -- updated");
    }
}
