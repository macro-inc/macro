use utoipa::ToSchema;

use model::item::Item;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetUserHistoryResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: Vec<Item>,
}
