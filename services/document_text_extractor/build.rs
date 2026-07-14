use std::path::Path;

fn main() {
    // Determine which platform library to use based on feature
    let (lib_path, lib_filename) = if cfg!(feature = "macos") {
        ("./pdfium-lib/macos", "libpdfium.dylib")
    } else {
        ("./pdfium-lib/linux", "libpdfium.so")
    };

    // Check that the required pdfium library file exists at build time
    let lib_file = format!("{}/{}", lib_path, lib_filename);
    if !Path::new(&lib_file).exists() {
        panic!(
            "Missing pdfium library: {}. Please ensure the library file exists.",
            lib_file
        );
    }

    // Set environment variable for use in main.rs
    println!("cargo:rustc-env=PDFIUM_LIB_PATH={}", lib_path);

    println!("cargo:rerun-if-changed=pdfium-lib/");
    println!("cargo:rerun-if-changed=pdfium-lib/macos/libpdfium.dylib");
    println!("cargo:rerun-if-changed=pdfium-lib/linux/libpdfium.so");
}
