//! Worker delete response and transport cache invalidation.
use super::{HttpHandlers, response, room_error};
use sync_server_core::domain::{ports::RoomPorts, types::SessionKey};
use worker::{Response, Result};
impl HttpHandlers<'_> {
    pub(in crate::inbound) async fn delete_handler(
        &mut self,
        document_id: &str,
    ) -> Result<Response> {
        self.room
            .delete(&SessionKey::new(document_id.to_owned()))
            .await
            .map_err(room_error)?;
        self.room.ports().snapshots().forget();
        Ok(response(200))
    }
}
