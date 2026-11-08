//! Package failures retain their owning model or conversion error.
use std::borrow::Cow;
/// A document-model operation failed.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Loro snapshot or projection failure.
    #[error(transparent)]
    Loro(#[from] lexical_loro::ProjectionError),
    /// Transactional core model failure.
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
    /// The configured registry could not be built.
    #[error(transparent)]
    Build(#[from] lexical_model::BuildError),
    /// Invalid serialized JSON.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Rich-node operation failure.
    #[error(transparent)]
    RichNodes(#[from] lexical_rich_nodes::Error),
    /// Markdown engine or callback failure.
    #[error(transparent)]
    Markdown(lexical_markdown::Error),
    /// The caller must provide a hostname for this external document link.
    #[error("external document links require an explicit app hostname")]
    MissingHostname,
    /// A caller argument is invalid for this operation.
    #[error("invalid document model argument: {0}")]
    InvalidArgument(Cow<'static, str>),
}
impl From<lexical_markdown::Error> for Error {
    fn from(error: lexical_markdown::Error) -> Self {
        match error {
            lexical_markdown::Error::Transformer(error) => match error.downcast::<Self>() {
                Ok(error) => *error,
                Err(error) => Self::Markdown(lexical_markdown::Error::Transformer(error)),
            },
            error => Self::Markdown(error),
        }
    }
}
