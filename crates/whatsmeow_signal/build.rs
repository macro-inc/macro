//! Compiles the vendored libsignal `.proto` files with the pure-Rust `protox`
//! compiler, so no `protoc` binary is needed, and generates prost types.

const PROTO_FILES: [&str; 2] = ["proto/wire.proto", "proto/storage.proto"];

fn main() {
    println!("cargo:rerun-if-changed=proto");
    let descriptors =
        protox::compile(PROTO_FILES, ["proto"]).expect("the vendored .proto files compile");
    prost_build::Config::new()
        .compile_fds(descriptors)
        .expect("prost can write generated code into OUT_DIR");
}
