//! Form liveness through the connection gateway: a ping to the form's
//! entity naming only the form. Each page re-reads what it shows under its
//! own access, so nothing about the change is pushed.

#[cfg(test)]
mod test;

use connection_gateway_client::client::ConnectionGatewayClient;
use model_entity::EntityType;
use serde::Serialize;

use crate::domain::models::FormId;
use crate::domain::ports::FormEventPublisher;

/// Message type delivered to gateway subscribers of the form entity.
pub const FORM_CHANGED_MESSAGE_TYPE: &str = "form_changed";

/// The [`FORM_CHANGED_MESSAGE_TYPE`] payload: which form changed, and
/// nothing about how or by whom.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormChanged {
    /// The form.
    pub form_id: FormId,
}

/// Errors from publishing a form's ping.
#[derive(Debug, thiserror::Error)]
pub enum FormPublishError {
    /// The gateway rejected or failed the publish.
    #[error("gateway publish failed: {0}")]
    Gateway(String),
    /// The payload did not serialize.
    #[error("payload serialization failed")]
    Serialize(#[source] serde_json::Error),
}

/// [`FormEventPublisher`] over the connection gateway.
#[derive(Debug, Clone)]
pub struct GatewayFormEventPublisher {
    client: ConnectionGatewayClient,
}

impl GatewayFormEventPublisher {
    /// A publisher over the given gateway client.
    pub fn new(client: ConnectionGatewayClient) -> Self {
        Self { client }
    }
}

impl FormEventPublisher for GatewayFormEventPublisher {
    type Error = FormPublishError;

    #[tracing::instrument(skip(self), err)]
    async fn form_changed(&self, form: FormId) -> Result<(), Self::Error> {
        self.client
            .send_message(
                EntityType::Form.with_entity_string(form.to_string()),
                FORM_CHANGED_MESSAGE_TYPE.to_string(),
                serde_json::to_value(FormChanged { form_id: form })
                    .map_err(FormPublishError::Serialize)?,
            )
            .await
            .map_err(|error| FormPublishError::Gateway(format!("{error:#}")))?;
        Ok(())
    }
}
