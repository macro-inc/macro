//! Makes `cargo test` build the service's real binary, under the same features as
//! the tests. The test targets never compile the body of `run`, which only the
//! binary's `main` polls, and clippy stops before monomorphization, so this is what
//! fails a pull request on a failure only a real build finds.

#[test]
fn service_binary_builds() {
    assert!(std::path::Path::new(env!("CARGO_BIN_EXE_email_service")).exists());
}
