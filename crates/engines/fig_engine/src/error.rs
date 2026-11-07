use thiserror::Error;

/// Why a file could not be opened or a request could not be served.
#[derive(Debug, Error)]
pub enum FigError {
    #[error("not a Figma file")]
    NotFigma,
    #[error("the Figma file is damaged: {0}")]
    Corrupt(String),
    #[error("unsupported Figma file: {0}")]
    Unsupported(String),
    #[error("no such page: {0}")]
    NoSuchPage(usize),
    #[error("no such layer: {0}")]
    NoSuchNode(String),
    #[error("{0}")]
    Render(String),
}

pub type Result<T> = std::result::Result<T, FigError>;

pub(crate) fn corrupt(what: impl Into<String>) -> FigError {
    FigError::Corrupt(what.into())
}
