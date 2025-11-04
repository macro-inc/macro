use crate::config::Config;
use crate::error::AnthropicError;
use futures::stream::{Stream, StreamExt};
use reqwest::Client as RequestClient;
use reqwest_eventsource::{Event, EventSource, RequestBuilderExt};
use serde::{Serialize, de::DeserializeOwned};
use std::pin::Pin;

#[derive(Clone, Debug)]
pub struct Client {
    http_client: RequestClient,
    config: Config,
}

impl Client {
    pub fn dangerously_try_from_env() -> Self {
        let config = Config::dangrously_try_from_env();
        Self::with_config(config)
    }
}

impl Client {
    pub fn with_config(config: Config) -> Self {
        let client = reqwest::Client::builder()
            .default_headers(config.headers.clone())
            .build()
            .expect("reqwest client");
        Self {
            config,
            http_client: client,
        }
    }

    pub fn with_client(self, client: RequestClient) -> Self {
        Self {
            http_client: client,
            ..self
        }
    }
}

impl Client {
    pub(crate) async fn post_stream<I, O>(
        &self,
        path: &str,
        request: I,
    ) -> Pin<Box<dyn Stream<Item = Result<O, AnthropicError>> + Send>>
    where
        I: Serialize,
        O: DeserializeOwned + Send + Sync + 'static,
    {
        let event_source = self
            .http_client
            .post(format!("{}{}", self.config.api_base, path))
            .headers(self.config.headers.clone())
            .json(&request)
            .eventsource()
            .expect("event source");

        stream(event_source).await
    }
}

async fn stream<O>(
    mut event_source: EventSource,
) -> Pin<Box<dyn Stream<Item = Result<O, AnthropicError>> + Send>>
where
    O: DeserializeOwned + std::marker::Send + 'static,
{
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();

    tokio::spawn(async move {
        while let Some(ev) = event_source.next().await {
            match ev {
                Err(e) => {
                    if let Err(_e) = tx.send(Err(AnthropicError::StreamClosed(e.to_string()))) {
                        // rx dropped
                        break;
                    }
                }
                Ok(event) => match event {
                    Event::Message(message) => {
                        if message.data == "[DONE]" {
                            break;
                        }

                        let response = match serde_json::from_str::<O>(&message.data) {
                            Err(e) => Err(AnthropicError::JsonDeserialize(e)),
                            Ok(output) => Ok(output),
                        };

                        if let Err(_e) = tx.send(response) {
                            // rx dropped
                            break;
                        }
                    }
                    Event::Open => continue,
                },
            }
        }

        event_source.close();
    });
    Box::pin(tokio_stream::wrappers::UnboundedReceiverStream::new(rx))
}
