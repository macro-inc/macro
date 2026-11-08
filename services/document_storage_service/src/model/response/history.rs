use utoipa::ToSchema;

use serde::{Deserialize, Serialize};
use shared_types::item::Item;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetUserHistoryResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: Vec<Item>,
}
