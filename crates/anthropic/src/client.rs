pub mod chat;
use crate::error::AnthropicError;
use crate::openai::request::AnthropicRequestExtension;
use crate::prelude::ApiError;
use crate::types::request::{CODE_EXECUTION_TOOL_HEADER, WEB_FETCH_TOOL_HEADER};
use crate::{config::Config, openai::request::AnthropicRequestExtensions};
use futures::stream::{Stream, StreamExt};
use reqwest::Client as RequestClient;
use serde::{Serialize, de::DeserializeOwned};
use std::pin::Pin;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::io::StreamReader;

#[derive(Clone, Debug)]
pub struct Client {
    http_client: RequestClient,
    config: Config,
}

impl Client {
    pub fn dangerously_try_from_env(extensions: Option<AnthropicRequestExtensions>) -> Self {
        let mut config = Config::dangrously_try_from_env();
        if let Some(ref extensions) = extensions {
            if extensions.0.contains(&AnthropicRequestExtension::FetchTool) {
                tracing::debug!("Adding web_fetch beta header");
                config.headers.append(
                    WEB_FETCH_TOOL_HEADER.0.clone(),
                    WEB_FETCH_TOOL_HEADER.1.clone(),
                );
            }
            if extensions
                .0
                .contains(&AnthropicRequestExtension::CodeExecutionTool)
            {
                tracing::debug!("Adding code_execution beta header");
                config.headers.append(
                    CODE_EXECUTION_TOOL_HEADER.0.clone(),
                    CODE_EXECUTION_TOOL_HEADER.1.clone(),
                );
            }
        }
        tracing::debug!("Anthropic client headers: {:?}", config.headers);
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
    pub(crate) async fn post<I, O>(&self, path: &str, request: I) -> Result<O, AnthropicError>
    where
        I: Serialize + std::fmt::Debug,
        O: DeserializeOwned,
    {
        let response = self
            .http_client
            .post(format!("{}{}", self.config.api_base, path))
            .headers(self.config.headers.clone())
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.map_err(AnthropicError::Reqwest)?;

        if !status.is_success() {
            return match serde_json::from_str::<ApiError>(&body) {
                Ok(api_error) => Err(AnthropicError::ApiError {
                    api_error,
                    status_code: status,
                }),
                Err(e) => {
                    tracing::error!(%body, "failed to parse API error response");
                    Err(AnthropicError::JsonDeserialize(e))
                }
            };
        }

        serde_json::from_str::<O>(&body).map_err(|e| {
            tracing::error!(%body, "failed to deserialize response");
            AnthropicError::JsonDeserialize(e)
        })
    }

    pub(crate) async fn post_stream<I, O>(
        &self,
        path: &str,
        request: I,
    ) -> Pin<Box<dyn Stream<Item = Result<O, AnthropicError>> + Send>>
    where
        I: Serialize + std::fmt::Debug,
        O: DeserializeOwned + Send + Sync + 'static,
    {
        tracing::debug!("{:#?}", request);
        let fut = self
            .http_client
            .post(format!("{}{}", self.config.api_base, path))
            .headers(self.config.headers.clone())
            .json(&request)
            .send();

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();

        tokio::spawn(async move {
            let response = match fut.await {
                Err(e) => {
                    let _ = tx.send(Err(AnthropicError::Reqwest(e)));
                    return;
                }
                Ok(r) => r,
            };

            if !response.status().is_success() {
                let code = response.status();
                let err = match response.json::<serde_json::Value>().await {
                    Err(e) => AnthropicError::Reqwest(e),
                    Ok(json) => match serde_json::from_value::<ApiError>(json) {
                        Ok(api_error) => AnthropicError::ApiError {
                            api_error,
                            status_code: code,
                        },
                        Err(e) => AnthropicError::JsonDeserialize(e),
                    },
                };
                let _ = tx.send(Err(err));
                return;
            }

            let byte_stream = response
                .bytes_stream()
                .map(|r| r.map_err(std::io::Error::other));
            let reader = BufReader::new(StreamReader::new(byte_stream));
            let mut lines = reader.lines();
            let mut pending_data = String::new();

            loop {
                match lines.next_line().await {
                    Err(e) => {
                        let _ = tx.send(Err(AnthropicError::StreamError(e.to_string())));
                        break;
                    }
                    Ok(None) => break,
                    Ok(Some(line)) => {
                        if let Some(data) = line.strip_prefix("data: ") {
                            pending_data = data.to_string();
                        } else if line.is_empty() && !pending_data.is_empty() {
                            if pending_data == "[DONE]" {
                                break;
                            }
                            let result = match serde_json::from_str::<O>(&pending_data) {
                                Err(e) => Err(AnthropicError::JsonDeserialize(e)),
                                Ok(output) => Ok(output),
                            };
                            pending_data.clear();
                            if tx.send(result).is_err() {
                                break;
                            }
                        }
                    }
                }
            }
        });

        Box::pin(tokio_stream::wrappers::UnboundedReceiverStream::new(rx))
    }
}
