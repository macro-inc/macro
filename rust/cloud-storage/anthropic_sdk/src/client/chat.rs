use futures::{Stream, StreamExt};
use reqwest_eventsource::{EventSource, RequestBuilderExt};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Error as JsonError;
use std::pin::Pin;

use super::Client;
use crate::types::request::CreateMessageRequestBody;

pub struct Chat<'c> {
    http_client: &'c Client,
}

impl Client {
    pub fn chat(&'_ self) -> Chat<'_> {
        Chat { http_client: self }
    }
}

impl Chat<'c> {
    pub async fn create_stream(request: CreateMessageRequestBody) -> () {
        todo!()
    }

    pub fn create_stream_unchecked<I, O>(
        &self,
        request: I,
    ) -> impl Future<Output = Pin<Box<dyn Stream<Item = Result<O, JsonError>>>>>
    where
        I: Serialize,
        O: DeserializeOwned + Send + Sync,
    {
        let event_source = self
            .http_client
            .post

    }
}
