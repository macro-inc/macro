use crate::model::ws::{GenericErrorResponse, WebSocketError};

impl From<anyhow::Error> for GenericErrorResponse {
    fn from(err: anyhow::Error) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

impl From<anyhow::Error> for WebSocketError {
    fn from(err: anyhow::Error) -> Self {
        WebSocketError::Generic(GenericErrorResponse::from(err))
    }
}
