use connection_gateway_client::client::ConnectionGatewayClient;
use model::annotations::AnnotationIncrementalUpdate;
use model_entity::EntityType;

#[tracing::instrument(skip(client))]
pub async fn update_live_comment_state(
    client: &ConnectionGatewayClient,
    document_id: &str,
    message: AnnotationIncrementalUpdate<'_>,
) -> () {
    if cfg!(not(feature = "connection_gateway")) {
        tracing::info!("bypassing connection gateway");
    } else {
        let entities = vec![EntityType::Document.with_entity_str(document_id)];

        match serde_json::to_value(message) {
            Ok(message) => {
                client
                    .batch_send_message("comment".to_string(), message, entities)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error = ?e, "failed to send message to connection gateway");
                    })
                    .ok();
            }
            Err(e) => {
                tracing::error!(error = ?e, "failed to serialize message");
            }
        }
    }
}
