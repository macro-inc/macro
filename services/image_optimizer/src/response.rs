use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;

/// Lambda Function URL response returned to CloudFront.
#[derive(Serialize)]
pub struct FunctionUrlResponse {
    #[serde(rename = "statusCode")]
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(rename = "isBase64Encoded")]
    pub is_base64_encoded: bool,
}

/// Builds a base64-encoded image response with the given cache-control header.
pub fn image_response(
    status: u16,
    body: &[u8],
    content_type: &str,
    cache_control: &str,
) -> FunctionUrlResponse {
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), content_type.to_string());
    headers.insert("cache-control".to_string(), cache_control.to_string());

    FunctionUrlResponse {
        status_code: status,
        headers,
        body: Some(base64::engine::general_purpose::STANDARD.encode(body)),
        is_base64_encoded: true,
    }
}

/// Builds a JSON error response.
pub fn error_response(status: u16, message: &str) -> FunctionUrlResponse {
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());

    FunctionUrlResponse {
        status_code: status,
        headers,
        body: Some(serde_json::json!({"error": message}).to_string()),
        is_base64_encoded: false,
    }
}
