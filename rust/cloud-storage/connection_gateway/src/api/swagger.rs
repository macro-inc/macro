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
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
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
