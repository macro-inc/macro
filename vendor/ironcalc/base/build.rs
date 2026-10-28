// MACRO: upstream reads the release from `git describe`, which inside this
// repository would describe Macro's history. INFO("release") reports the
// vendored upstream commit instead.
fn main() {
    println!("cargo:rustc-env=GIT_VERSION=ironcalc-4deab8f-macro");
}
