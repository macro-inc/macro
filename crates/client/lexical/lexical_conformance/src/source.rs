//! Fixture loading is separate from interpretation.
use crate::replay::ReplayError;
/// Fixture bytes can be supplied by a native filesystem or a wasm host.
pub trait FixtureSource {
    /// Read one fixture relative to this source.
    fn read(&self, path: &str) -> Result<String, ReplayError>;
}
/// Native filesystem source, absent on wasm.
#[cfg(not(target_arch = "wasm32"))]
pub struct Directory(pub std::path::PathBuf);
#[cfg(not(target_arch = "wasm32"))]
impl FixtureSource for Directory {
    fn read(&self, path: &str) -> Result<String, ReplayError> {
        Ok(std::fs::read_to_string(self.0.join(path))?)
    }
}
