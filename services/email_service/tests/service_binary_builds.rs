//! Built only by the `build-service-bins` CI job, never run: building it makes
//! cargo build this package's real binaries under the same features as `cargo
//! test`, so that job compiles nothing the test job doesn't already compile.

#[test]
fn service_binary_builds() {
    assert!(std::path::Path::new(env!("CARGO_BIN_EXE_email_service")).exists());
}
