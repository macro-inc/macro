use futures::Stream;
use serde::{Serialize, de::DeserializeOwned};
use std::fmt::Debug;
use std::pin::Pin;

use super::Client;
use crate::error::AnthropicError;
use crate::types::request::CreateMessageRequestBody;
use crate::types::request::transform_request_web_fetch;
use crate::types::response::{MessageResponse, StreamEvent};

pub type MessageCompletionResponseStream =
    Pin<Box<dyn Stream<Item = Result<StreamEvent, AnthropicError>> + Send>>;

pub struct Chat<'c> {
    pub(crate) inner: &'c Client,
}

impl Client {
    pub fn chat(&'_ self) -> Chat<'_> {
        Chat { inner: self }
    }
}

impl<'c> Chat<'c> {
    pub async fn create<I>(
        &self,
        request: I,
    ) -> Result<MessageResponse, crate::error::AnthropicError>
    where
        I: Into<CreateMessageRequestBody>,
    {
        let request = request.into();
        let request = transform_request_web_fetch(request);
        self.inner.post("/v1/messages", request).await
    }

    pub async fn create_stream<I>(&self, request: I) -> MessageCompletionResponseStream
    where
        I: Into<CreateMessageRequestBody>,
    {
        let mut request = request.into();
        request.stream = Some(true);
        let request = transform_request_web_fetch(request);
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
        self.inner.post_stream("/v1/messages", request).await
    }
}
