// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Compiles whatsmeow's `.proto` files with the pure-Rust `protox` compiler, so
//! no `protoc` binary is needed, and generates prost types from them.

use std::path::{Path, PathBuf};

const PROTO_ROOT: &str = "proto";

fn main() {
    let mut files = Vec::new();
    collect_proto_files(Path::new(PROTO_ROOT), &mut files);
    files.sort();
    println!("cargo:rerun-if-changed={PROTO_ROOT}");

    let descriptors = protox::compile(&files, [PROTO_ROOT])
        .expect("the vendored .proto files compile; they are copied verbatim from whatsmeow");
    prost_build::Config::new()
        .include_file("_includes.rs")
        .compile_fds(descriptors)
        .expect("prost can write generated code into OUT_DIR");
}

fn collect_proto_files(directory: &Path, files: &mut Vec<PathBuf>) {
    let entries = std::fs::read_dir(directory).expect("the proto directory is readable");
    for entry in entries {
        let path = entry.expect("proto directory entries are readable").path();
        if path.is_dir() {
            collect_proto_files(&path, files);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "proto")
        {
            files.push(path);
        }
    }
}
