use anyhow::{Context, Result};
use async_openai::types::{ChatCompletionResponseStream, CreateChatCompletionRequest};
use serde::Serialize;
use crate::types::AiError;

#[derive(Clone, Debug)]
pub struct RequestExtensions(serde_json::Value);

impl RequestExtensions {
    pub fn new(extensions: impl Serialize) -> Result<Self> {
        let extensions = serde_json::to_value(extensions).context("serialization")?;
        match extensions {
            obj @ serde_json::Value::Object(_) => Ok(Self(obj)),
            _ => Err(anyhow::anyhow!("extensions must be an object")),
        }
    }

    pub fn into_inner(self) -> serde_json::Value {
        self.0
    }
}

pub trait Client {
    fn chat_stream(
        &self,
        request: CreateChatCompletionRequest,
        extensions: Option<RequestExtensions>,
    ) -> impl Future<Output = Result<ChatCompletionResponseStream, AiError>> + Send;

    fn extend_request(
        &self,
        request: CreateChatCompletionRequest,
        extensions: RequestExtensions,
    ) -> Result<serde_json::Value> {
        fn dumb_merge(a: serde_json::Value, b: serde_json::Value) -> serde_json::Value {
            match (a, b) {
                (serde_json::Value::Object(mut oa), serde_json::Value::Object(ob)) => {
                    for (k, v) in ob.into_iter() {
                        oa.insert(k, v);
                    }
                    serde_json::Value::Object(oa)
                }
                (a, _) => a,
            }
        }

        let request = serde_json::to_value(request).context("jsonify request")?;

        Ok(dumb_merge(request, extensions.into_inner()))
    }
}
