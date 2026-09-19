use axum::{
    body::Body,
    http::{Response, StatusCode},
};
pub use model_error_response::ErrorResponse;
use serde_json::{Value, json};
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UserTokensResponse {
    /// The users access token
    pub access_token: String,
    /// The users refresh token
    pub refresh_token: String,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresignedUrl {
    /// The sha of the item
    pub sha: String,
    /// The presigned url used to upload the sha
    pub presigned_url: String,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct StringIDResponse {
    pub id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct GenericResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Message to explain failure
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Data to be returned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(bound = "T: serde::Serialize + serde::de::DeserializeOwned")]
pub struct TypedSuccessResponse<T> {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    #[schema(inline)]
    pub data: T,
}

impl GenericResponse {
    pub fn builder() -> Self {
        GenericResponse {
            error: false,
            message: None,
            data: None,
        }
    }

    pub fn data<T: for<'de> serde::Deserialize<'de> + std::fmt::Debug + serde::Serialize>(
        mut self,
        data: &T,
    ) -> Self {
        self.data = serde_json::to_value(data).ok();
        self
    }

    pub fn message(mut self, message: &str) -> Self {
        self.message = Some(message.to_string());
        self
    }

    pub fn is_error(mut self, is_error: bool) -> Self {
        self.error = is_error;
        self
    }

    pub fn send(self, status_code: StatusCode) -> Response<Body> {
        let mut json_response = serde_json::Map::new();

        // Always include the error field.
        json_response.insert("error".to_string(), json!(self.error));

        // Include message only if it's Some.
        if let Some(message) = self.message {
            json_response.insert("message".to_string(), json!(message));
        }

        // Include data only if it's Some.
        if let Some(data) = self.data {
            json_response.insert("data".to_string(), data);
        }

        let json = Value::Object(json_response);

        Response::builder()
            .status(status_code)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&json).unwrap()))
            .unwrap()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct GenericSuccessResponse {
    /// Indicates if the request was successful
    pub success: bool,
}

impl Default for GenericSuccessResponse {
    fn default() -> Self {
        Self { success: true }
    }
}

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GenericErrorResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Message to explain failure
    pub message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct SuccessResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: GenericSuccessResponse,
}

/// Empty response is required due to custom fetch forcing `response.json()`
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, Default)]
pub struct EmptyResponse {}
