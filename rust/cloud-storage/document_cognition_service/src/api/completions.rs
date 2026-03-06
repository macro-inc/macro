use axum::{extract, response::IntoResponse};

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

/// A non-streaming proxy to the chatgpt api
#[tracing::instrument(err(Debug), skip(body))]
pub async fn handler(
    extract::Json(mut body): extract::Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Some(obj) = body.as_object_mut() {
        obj.insert("stream".to_string(), serde_json::Value::Bool(false));
    }

    let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();

    let response = reqwest::Client::new()
        .post(OPENAI_CHAT_COMPLETIONS_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .inspect_err(|err| tracing::error!(error=?err, "failed to proxy chat completion"))
        .map_err(|err| (axum::http::StatusCode::BAD_GATEWAY, err.to_string()))?;

    let status = axum::http::StatusCode::from_u16(response.status().as_u16())
        .unwrap_or(axum::http::StatusCode::OK);
    let bytes = response.bytes().await.map_err(|err| {
        tracing::error!(error=?err, "failed to read chat completion response");
        (axum::http::StatusCode::BAD_GATEWAY, err.to_string())
    })?;

    Ok::<_, (axum::http::StatusCode, String)>((
        status,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        bytes,
    ))
}
