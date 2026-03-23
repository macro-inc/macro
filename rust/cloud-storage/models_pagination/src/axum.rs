use crate::{Base64SerdeErr, Base64Str, Cursor, CursorVal, CursorWithValAndFilter, Sortable};
use axum::Json;
use axum::extract::{FromRequestParts, Query};
use axum::http::{StatusCode, request::Parts};
use axum::response::IntoResponse;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

/// An enum which denotes either the client did not provide a cursor value
/// or the cursor was provided and parsed.
/// Provided but invalid cursors will be rejected as 400
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
            CursorExtractErr::InvalidQueryParamsErr => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid cursor query parameters",
                }),
            ),
            CursorExtractErr::MutuallyExclusiveErr => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "provide only one of cursor or previous_cursor",
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
            cursor: Option<String>,
        }
        let Query(Params { cursor }) = <Query<Params>>::from_request_parts(parts, state)
            .await
            .map_err(|_| CursorExtractErr::InvalidQueryParamsErr)?;

        let Some(cursor) = cursor else {
            return Ok(CursorExtractor::None);
        };

        let encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>> =
            Base64Str::new_from_string(cursor);

        let decoded = decode_cursor(encoded)?;

        Ok(CursorExtractor::Some(decoded))
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

/// An enum which denotes either the client did not provide cursor params
/// or exactly one cursor direction was provided and parsed.
/// Provided but invalid cursors will be rejected as 400.
// TODO: in axum 0.8 there is OptionalFromRequestParts which is preferable to this
#[derive(Debug)]
pub enum BidirectionalCursorExtractor<Id, S: Sortable, F> {
    /// The client provided a valid parsed cursor.
    Some(BidirectionalCursor<Id, S, F>),
    /// The client did not provide cursor params.
    None,
}

impl<Id, S: Sortable, F> BidirectionalCursorExtractor<Id, S, F> {
    /// convert self into an optional [BidirectionalCursor]
    pub fn into_option(self) -> Option<BidirectionalCursor<Id, S, F>> {
        match self {
            BidirectionalCursorExtractor::Some(parsed_cursor) => Some(parsed_cursor),
            BidirectionalCursorExtractor::None => None,
        }
    }
}

impl<S, Id, Sort, F> FromRequestParts<S> for BidirectionalCursorExtractor<Id, Sort, F>
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
                Ok(BidirectionalCursorExtractor::Some(
                    BidirectionalCursor::Next(decoded),
                ))
            }
            (None, Some(previous_cursor)) => {
                let encoded: Base64Str<CursorWithValAndFilter<Id, Sort, F>> =
                    Base64Str::new_from_string(previous_cursor);
                let decoded = decode_cursor(encoded)?;
                Ok(BidirectionalCursorExtractor::Some(
                    BidirectionalCursor::Previous(decoded),
                ))
            }
            (None, None) => Ok(BidirectionalCursorExtractor::None),
        }
    }
}
