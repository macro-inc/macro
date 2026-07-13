//! Domain types and traits for the stream service.

mod ext;
mod traits;
mod types;

pub use ext::StreamRepoExt;
pub use traits::{
    DEFAULT_STREAM_TIMEOUT, ItemId, ItemStream, PayloadStream, StreamManager, StreamRepo,
};
pub use types::{Result, StreamEvent, StreamId, StreamItem, StreamServiceError};
