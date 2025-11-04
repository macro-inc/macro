use futures::Stream;
use serde::{Serialize, de::DeserializeOwned};
use std::fmt::Debug;
use std::pin::Pin;

use super::Client;
use crate::error::AnthropicError;
use crate::types::request::CreateMessageRequestBody;
use crate::types::stream_response::StreamEvent;

pub struct Chat<'c> {
    inner: &'c Client,
}

impl Client {
    pub fn chat(&'_ self) -> Chat<'_> {
        Chat { inner: self }
    }
}

impl<'c> Chat<'c> {
    pub async fn create_stream<I>(
        &self,
        request: I,
    ) -> Pin<Box<dyn Stream<Item = Result<StreamEvent, AnthropicError>> + Send>>
    where
        I: Into<CreateMessageRequestBody>,
    {
        let mut request = request.into();
        request.stream = Some(true);
        self.create_stream_unchecked(request).await
    }

    pub async fn create_stream_unchecked<I, O>(
        &self,
        request: I,
    ) -> Pin<Box<dyn Stream<Item = Result<O, AnthropicError>> + Send>>
    where
        I: Serialize + Debug,
        O: DeserializeOwned + Send + Sync + 'static,
    {
        tracing::debug!("{:#?}", request);
        self.inner.post_stream("/v1/messages", request).await
    }
}
