//! Connection gateway HTTP client.

use connection_gateway_models::{
    BatchSendMessageBody, BatchSendUniqueMessagesBody, MessageReceipt, SendMessageBody,
    UniqueMessage,
};

use model_entity::Entity;

mod calendar;
mod email;

/// HTTP client for communicating with the connection gateway service.
#[derive(Clone, Debug)]
pub struct ConnectionGatewayClient {
    connection_gateway_url: String,
    client: reqwest::Client,
}

#[derive(serde::Deserialize, Debug)]
struct Response {
    receipts: Vec<MessageReceipt>,
}

impl ConnectionGatewayClient {
    fn with_trace_headers(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        request.headers(headers)
    }

    /// Create a new connection gateway client.
    pub fn new(internal_auth_key: String, connection_gateway_url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-internal-auth-key", internal_auth_key.parse().unwrap());

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap();

        Self {
            connection_gateway_url,
            client,
        }
    }

    /// Send a message to an entity.
    pub async fn send_message(
        &self,
        entity: Entity<'_>,
        message_type: String,
        message: serde_json::Value,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        let body = SendMessageBody {
            message_type,
            message,
        };

        let request = self.client.post(format!(
            "{}/message/send/{}/{}",
            self.connection_gateway_url, entity.entity_type, entity.entity_id
        ));
        let res = self
            .with_trace_headers(request)
            .json(&body)
            .send()
            .await?
            .json()
            .await?;

        let receipts: Response = serde_json::from_value(res)?;

        Ok(receipts.receipts)
    }

    /// Send a message to multiple entities
    pub async fn batch_send_message(
        &self,
        message_type: String,
        message: serde_json::Value,
        entities: Vec<Entity<'_>>,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        let body = BatchSendMessageBody {
            message,
            entities,
            message_type,
        };
        let request = self.client.post(format!(
            "{}/message/batch_send",
            self.connection_gateway_url
        ));
        let res = self.with_trace_headers(request).json(&body).send().await?;

        let json = res.json().await?;

        let receipts: Response = serde_json::from_value(json)?;

        Ok(receipts.receipts)
    }

    /// Send unique messages to multiple entities
    pub async fn batch_send_unique_messages(
        &self,
        messages: Vec<UniqueMessage>,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        let body = BatchSendUniqueMessagesBody { messages };
        let request = self.client.post(format!(
            "{}/message/batch_send_unique",
            self.connection_gateway_url
        ));
        let res = self.with_trace_headers(request).json(&body).send().await?;

        let json = res.json().await?;

        let receipts: Response = serde_json::from_value(json)?;

        Ok(receipts.receipts)
    }

    /// Get users who are interacting with a given entity.
    pub async fn track_entity_users(&self, entity: Entity<'_>) -> anyhow::Result<Vec<String>> {
        let request = self.client.get(format!(
            "{}/track/{}/{}",
            self.connection_gateway_url, entity.entity_type, entity.entity_id
        ));
        let res = self.with_trace_headers(request).send().await?;

        let json = res.json().await?;

        let result: Vec<String> = serde_json::from_value(json)?;

        Ok(result)
    }
}
