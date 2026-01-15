use crate::{Base64SerdeErr, Base64Str, Cursor, CursorVal, CursorWithValAndFilter, Sortable};
use axum::extract::{FromRequestParts, Query};
use axum::http::{StatusCode, request::Parts};
use axum::response::IntoResponse;
use axum::{Json, async_trait};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

/// An enum which denotes either the client did not provide a cursor value
/// or the cursor was provided and parsed.
/// Provided but invalid cursors will be rejected as 401
// TODO: in axum 0.8 there is OptionalFromRequestParts which is preferable to this
#[derive(Debug)]
pub enum CursorExtractor<Id, S: Sortable, F> {
    /// the client provided a valid parsed cursor
    Some(Cursor<Id, CursorVal<S>, F>),
    /// the client did not provide a cursor param
    None,
}

impl<Id, S: Sortable, F> CursorExtractor<Id, S, F> {
    /// convert self into an [Option]CursorWithVal
    pub fn into_option(self) -> Option<CursorWithValAndFilter<Id, S, F>> {
        match self {
            CursorExtractor::Some(parsed_cursor) => Some(parsed_cursor),
            CursorExtractor::None => None,
        }
    }
    /// convert self into a [Query] by supplying a fallback
    pub fn into_query(self, sort: S, filter: F) -> crate::cursor::Query<Id, S, F> {
        crate::cursor::Query::new(self.into_option(), sort, filter)
    }
}

/// represents an error that can occur while extracting a [CursorExtractor]
/// from the axum request parts
#[derive(Debug, Error)]
pub enum CursorExtractErr {
    /// an error occurred while decoding the input value
    #[error(transparent)]
    DecodeErr(Base64SerdeErr<serde_json::Error>),
    /// The query was too large to deserialize
    #[error("Query is too large, must be < 32kb")]
    SizeErr,
}

impl IntoResponse for CursorExtractErr {
    fn into_response(self) -> axum::response::Response {
        match self {
            CursorExtractErr::DecodeErr(Base64SerdeErr::DecodeErr(_e)) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "failed to decode cursor value",
                }),
            ),
            CursorExtractErr::DecodeErr(Base64SerdeErr::SerdeErr(_e)) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "the cursor contained unexpected data",
                }),
            ),
            CursorExtractErr::SizeErr => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "Query is too large, must be <32kb",
                }),
            ),
        }
        .into_response()
    }
}

#[async_trait]
impl<S, Id, Sort, F> FromRequestParts<S> for CursorExtractor<Id, Sort, F>
where
    S: Send + Sync,
    Sort: Sortable + DeserializeOwned,
    Sort::Value: DeserializeOwned,
    Id: DeserializeOwned,
    F: DeserializeOwned,
{
    type Rejection = CursorExtractErr;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        #[derive(Deserialize)]
        struct Params {
            cursor: String,
        }
        let Ok(Query(Params { cursor })) = <Query<Params>>::from_request_parts(parts, state).await
        else {
            return Ok(CursorExtractor::None);
        };

        let encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>> =
            Base64Str::new_from_string(cursor);

        let bytes = encoded.len();
        if bytes > 32_000 {
            return Err(CursorExtractErr::SizeErr);
        }

        let decoded = encoded
            .decode(|bytes| {
                let mut deserializer = serde_json::Deserializer::from_slice(&bytes);
                deserializer.disable_recursion_limit();
                <CursorWithValAndFilter<Id, Sort, F>>::deserialize(&mut deserializer)
            })
            .inspect_err(|e| {
                dbg!(e);
            })
            .map_err(CursorExtractErr::DecodeErr)?;

        Ok(CursorExtractor::Some(decoded))
    }
}
