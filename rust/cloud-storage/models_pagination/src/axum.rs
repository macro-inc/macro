use crate::{Base64SerdeErr, Base64Str, Cursor, CursorVal, CursorWithValAndFilter, Sortable};
use axum::Json;
use axum::extract::{FromRequestParts, OptionalFromRequestParts, Query};
use axum::http::{StatusCode, request::Parts};
use axum::response::IntoResponse;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

/// Extension trait adding `into_query` to `Option<CursorWithValAndFilter<...>>`
/// for convenient conversion from an optional extracted cursor to a pagination query.
pub trait CursorOptionExt<Id, S: Sortable, F> {
    /// Convert into a [Query] by supplying a fallback sort and filter.
    fn into_query(self, sort: S, filter: F) -> crate::cursor::Query<Id, S, F>;
}

impl<Id, S: Sortable, F> CursorOptionExt<Id, S, F> for Option<CursorWithValAndFilter<Id, S, F>> {
    fn into_query(self, sort: S, filter: F) -> crate::cursor::Query<Id, S, F> {
        crate::cursor::Query::new(self, sort, filter)
    }
}

/// represents an error that can occur while extracting a cursor
/// from the axum request parts
#[derive(Debug, Error)]
pub enum CursorExtractErr {
    /// an error occurred while decoding the input value
    #[error(transparent)]
    DecodeErr(Base64SerdeErr<serde_json::Error>),
    /// The query was too large to deserialize
    #[error("Query is too large, must be < 32kb")]
    SizeErr,
    /// The cursor query parameters could not be parsed
    #[error("invalid cursor query parameters")]
    InvalidQueryParamsErr,
    /// Both forward and backward cursors were provided.
    #[error("provide only one of cursor or previous_cursor")]
    MutuallyExclusiveErr,
}

impl IntoResponse for CursorExtractErr {
    fn into_response(self) -> axum::response::Response {
        match self {
            CursorExtractErr::DecodeErr(Base64SerdeErr::DecodeErr(_e)) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "failed to decode cursor value".into(),
                }),
            ),
            CursorExtractErr::DecodeErr(Base64SerdeErr::SerdeErr(_e)) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "the cursor contained unexpected data".into(),
                }),
            ),
            CursorExtractErr::SizeErr => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "Query is too large, must be <32kb".into(),
                }),
            ),
            CursorExtractErr::InvalidQueryParamsErr => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid cursor query parameters".into(),
                }),
            ),
            CursorExtractErr::MutuallyExclusiveErr => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "provide only one of cursor or previous_cursor".into(),
                }),
            ),
        }
        .into_response()
    }
}

fn decode_cursor<Id, Sort, F>(
    encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>>,
) -> Result<CursorWithValAndFilter<Id, Sort, F>, CursorExtractErr>
where
    Sort: Sortable + DeserializeOwned,
    Sort::Value: DeserializeOwned,
    Id: DeserializeOwned,
    F: DeserializeOwned,
{
    let bytes = encoded.len();
    if bytes > 32_000 {
        return Err(CursorExtractErr::SizeErr);
    }

    encoded
        .decode(|bytes| {
            let mut deserializer = serde_json::Deserializer::from_slice(&bytes);
            <CursorWithValAndFilter<Id, Sort, F>>::deserialize(&mut deserializer)
        })
        .map_err(CursorExtractErr::DecodeErr)
}

impl<S, Id, Sort, F> OptionalFromRequestParts<S> for Cursor<Id, CursorVal<Sort>, F>
where
    S: Send + Sync,
    Sort: Sortable + DeserializeOwned,
    Sort::Value: DeserializeOwned,
    Id: DeserializeOwned,
    F: DeserializeOwned,
{
    type Rejection = CursorExtractErr;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        #[derive(Deserialize)]
        struct Params {
            cursor: Option<String>,
        }
        let Query(Params { cursor }) = <Query<Params>>::from_request_parts(parts, state)
            .await
            .map_err(|_| CursorExtractErr::InvalidQueryParamsErr)?;

        let Some(cursor) = cursor else {
            return Ok(None);
        };

        let encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>> =
            Base64Str::new_from_string(cursor);

        let decoded = decode_cursor(encoded)?;

        Ok(Some(decoded))
    }
}

/// A parsed bidirectional cursor used for pagination.
#[derive(Debug)]
pub enum BidirectionalCursor<Id, S: Sortable, F> {
    /// The client provided a cursor to fetch the next page.
    Next(Cursor<Id, CursorVal<S>, F>),
    /// The client provided a cursor to fetch the previous page.
    Previous(Cursor<Id, CursorVal<S>, F>),
}

impl<S, Id, Sort, F> OptionalFromRequestParts<S> for BidirectionalCursor<Id, Sort, F>
where
    S: Send + Sync,
    Sort: Sortable + DeserializeOwned,
    Sort::Value: DeserializeOwned,
    Id: DeserializeOwned,
    F: DeserializeOwned,
{
    type Rejection = CursorExtractErr;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        #[derive(Deserialize)]
        struct Params {
            cursor: Option<String>,
            previous_cursor: Option<String>,
        }
        let Query(Params {
            cursor,
            previous_cursor,
        }) = <Query<Params>>::from_request_parts(parts, state)
            .await
            .map_err(|_| CursorExtractErr::InvalidQueryParamsErr)?;

        match (cursor, previous_cursor) {
            (Some(_), Some(_)) => Err(CursorExtractErr::MutuallyExclusiveErr),
            (Some(cursor), None) => {
                let encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>> =
                    Base64Str::new_from_string(cursor);
                let decoded = decode_cursor(encoded)?;
                Ok(Some(BidirectionalCursor::Next(decoded)))
            }
            (None, Some(previous_cursor)) => {
                let encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>> =
                    Base64Str::new_from_string(previous_cursor);
                let decoded = decode_cursor(encoded)?;
                Ok(Some(BidirectionalCursor::Previous(decoded)))
            }
            (None, None) => Ok(None),
        }
    }
}
