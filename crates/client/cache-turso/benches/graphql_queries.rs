//! Production GraphQL query benchmarks and browser fixture export.
#[cfg(not(target_arch = "wasm32"))]
#[path = "support/native.rs"]
mod native;

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    native::run();
}

#[cfg(target_arch = "wasm32")]
fn main() {}
