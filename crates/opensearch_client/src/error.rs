use models_opensearch::OpenSearchEntityType;
use opensearch::{Error, http::response::Response};

#[derive(thiserror::Error, Debug, serde::Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum OpensearchClientError {
    #[error("error deserializing response body. method: {method:?} details: {details}")]
    DeserializationFailed {
        details: String,
        method: Option<String>,
    },

    #[error("error deserializing search response. error: {details}, raw_body: {raw_body}")]
    SearchDeserializationFailed { details: String, raw_body: String },

    #[error("unable to grab bytes from http response: {details}")]
    HttpBytesError { details: String },

    #[error("unable to serialize into json. method: {method:?} details: {details}")]
    SerializationFailed {
        details: String,
        method: Option<String>,
    },

    #[error("a network error occurred. status_code: {status_code} message: {message}")]
    NetworkError { status_code: u16, message: String },

    /// OpenSearch rejected the query for exceeding its clause limit
    /// (`indices.query.bool.max_clause_count`). The query, not the cluster,
    /// is at fault, so retrying it cannot succeed.
    #[error("query has more clauses than OpenSearch allows. message: {message}")]
    TooManyClauses { message: String },

    #[error("invalid match type. match_type: {match_type}")]
    InvalidMatchType { match_type: String },

    #[error("validation failed: {details}")]
    ValidationFailed { details: String },

    #[error("no terms provided")]
    NoTermsProvided,

    #[error("empty search indices provided")]
    EmptySearchIndices,

    #[error("an unknown error occurred. method: {method:?} details: {details}")]
    Unknown {
        details: String,
        method: Option<String>,
    },

    #[error("no title key is available for name search")]
    NoTitleKeyForNameSearch,

    #[error("bool query not built")]
    BoolQueryNotBuilt,

    #[error("empty ids with ids only for {0}")]
    EmptyIdsWithIdsOnly(OpenSearchEntityType),

    #[error("USER_ID_KEY is required for ids_only=false search on {0}")]
    UserIdKeyRequired(OpenSearchEntityType),

    #[error("searching with exhausted cursor")]
    SearchWithExhaustedCursor,
}

impl From<anyhow::Error> for OpensearchClientError {
    fn from(err: anyhow::Error) -> Self {
        OpensearchClientError::Unknown {
            details: err.to_string(),
            method: None,
        }
    }
}

pub trait ResponseExt {
    #[allow(async_fn_in_trait)]
    async fn map_client_error(self) -> Result<Response, OpensearchClientError>;
}

impl ResponseExt for Response {
    async fn map_client_error(self) -> Result<Response, OpensearchClientError> {
        if self.status_code().is_success() {
            Ok(self)
        } else {
            let status_code = self.status_code().as_u16();
            let message = self.text().await.unwrap_or_default();
            if is_too_many_clauses(&message) {
                Err(OpensearchClientError::TooManyClauses { message })
            } else {
                Err(OpensearchClientError::NetworkError {
                    status_code,
                    message,
                })
            }
        }
    }
}

/// Whether an OpenSearch error body is the clause limit: the total across the
/// query tree (`too_many_nested_clauses`) or one bool query
/// (`too_many_clauses`). The limit error can sit in `root_cause` or deeper in
/// a `caused_by` chain, depending on the phase that hit it.
fn is_too_many_clauses(body: &str) -> bool {
    fn has_clause_error(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(map) => {
                matches!(
                    map.get("type").and_then(serde_json::Value::as_str),
                    Some("too_many_nested_clauses" | "too_many_clauses")
                ) || map.values().any(has_clause_error)
            }
            serde_json::Value::Array(values) => values.iter().any(has_clause_error),
            _ => false,
        }
    }
    serde_json::from_str::<serde_json::Value>(body)
        .is_ok_and(|body| has_clause_error(&body["error"]))
}

impl ResponseExt for Result<Response, Error> {
    async fn map_client_error(self) -> Result<Response, OpensearchClientError> {
        match self {
            Ok(response) => response.map_client_error().await,
            Err(e) => Err(OpensearchClientError::Unknown {
                details: e.to_string(),
                method: None,
            }),
        }
    }
}

#[cfg(test)]
mod test;
