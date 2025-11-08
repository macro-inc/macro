pub mod user;

use utoipa::ToSchema;

/// Empty response is required due to custom fetch forcing `response.json()`
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, Default)]
pub struct EmptyResponse {}
