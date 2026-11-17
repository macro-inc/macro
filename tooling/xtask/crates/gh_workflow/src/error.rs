//! The crate's error type: serializing a workflow to YAML failed.

#[derive(Debug)]
pub enum Error {
    Yaml(serde_yml::Error),
}

impl From<serde_yml::Error> for Error {
    fn from(error: serde_yml::Error) -> Self {
        Self::Yaml(error)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
