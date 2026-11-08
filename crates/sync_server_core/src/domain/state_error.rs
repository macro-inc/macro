//! Errors preserve the legacy boundary text while retaining typed sources.

/// Import, export or JSON decoding failure in document state.
#[derive(Debug, thiserror::Error)]
pub enum StateError {
    /// A snapshot left unresolved operations after import.
    #[error("failed to import snapshot")]
    InvalidSnapshot,
    /// Loro failed while importing state or operations.
    #[error("{context} : {source:?}")]
    Import {
        /// Legacy operation context.
        context: &'static str,
        /// Original Loro failure.
        source: loro::LoroError,
    },
    /// Loro failed while exporting state or operations.
    #[error("{context} : {source:?}")]
    Export {
        /// Legacy operation context.
        context: &'static str,
        /// Original Loro encoding failure.
        source: loro::LoroEncodeError,
    },
    /// The deep document value was not valid JSON.
    #[error("{context} : {source:?}")]
    Json {
        /// Legacy operation context.
        context: &'static str,
        /// Original JSON failure.
        source: serde_json::Error,
    },
}

pub(super) trait ResultExt<T> {
    fn context(self, context: &'static str) -> Result<T, StateError>;
}
macro_rules! context {
    ($source:ty, $variant:ident) => {
        impl<T> ResultExt<T> for Result<T, $source> {
            fn context(self, context: &'static str) -> Result<T, StateError> {
                self.map_err(|source| {
                    tracing::error!(err = ?source, "{context}");
                    StateError::$variant { context, source }
                })
            }
        }
    };
}
context!(loro::LoroError, Import);
context!(loro::LoroEncodeError, Export);
context!(serde_json::Error, Json);
