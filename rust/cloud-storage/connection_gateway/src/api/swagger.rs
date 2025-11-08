use super::entities;
use super::message;
use super::message::{BatchSendMessageBody, SendMessageBody, SendMessageResponse};
use crate::model::connection::StoredConnectionEntity;
use crate::model::sender::MessageReceipt;
use crate::model::websocket::{ToWebsocketMessage, TrackEntityMessage};
use model::response::{GenericErrorResponse, StringIDResponse};
use model_entity::{Entity, EntityType, TrackAction};
use models_bulk_upload::UploadFolderStatusUpdate;
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

                UploadFolderStatusUpdate
            ),
        ),
        tags(
            (name = "connection gateway", description = "Connection gateway API"),
        )
    )]
pub struct ApiDoc;
