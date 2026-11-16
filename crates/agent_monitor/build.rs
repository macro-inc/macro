//! Compiles the monitor's `.proto` with the pure-Rust `protox` compiler, so no
//! `protoc` binary is needed, and generates prost types plus the tonic client
//! and server from it.

const PROTO_ROOT: &str = "proto";
const PROTO_FILE: &str = "proto/agent_monitor.proto";

fn main() {
    println!("cargo:rerun-if-changed={PROTO_ROOT}");

    let descriptors =
        protox::compile([PROTO_FILE], [PROTO_ROOT]).expect("the monitor's .proto file compiles");
    tonic_prost_build::configure()
        .include_file("_includes.rs")
        .compile_fds(descriptors)
        .expect("tonic-prost-build can write generated code into OUT_DIR");
}
