use super::entities;
use super::message;
use crate::model::connection::StoredConnectionEntity;
use crate::model::tracking::TrackAction;
use crate::model::websocket::{ToWebsocketMessage, TrackEntityMessage};
use connection_gateway_models::{
    BatchSendMessageBody, MessageReceipt, SendMessageBody, SendMessageResponse,
};
use model::response::{GenericErrorResponse, StringIDResponse};
use model_entity::{Entity, EntityType};
use models_bulk_upload::UploadFolderStatusUpdate;
use stream::domain::{StreamEvent, StreamItem};
use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "internal-api-key",
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("x-internal-auth-key"))),
            );
        }
    }
}

#[derive(OpenApi)]
#[openapi(
        modifiers(&SecurityAddon),
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            message::send_message_handler,
            message::batch_send_message_handler,
            entities::get_entity_handler,
        ),
        components(
            schemas(
                BatchSendMessageBody,
                StringIDResponse,
                GenericErrorResponse,
                SendMessageResponse,
                SendMessageBody,
                Entity,
                MessageReceipt,

                TrackAction,
                ToWebsocketMessage,
                TrackEntityMessage,
                StoredConnectionEntity,
                EntityType,

                UploadFolderStatusUpdate,

                StreamEvent,
                StreamItem,
            ),
        ),
        tags(
            (name = "connection gateway", description = "Connection gateway API"),
        )
    )]
pub struct ApiDoc;
