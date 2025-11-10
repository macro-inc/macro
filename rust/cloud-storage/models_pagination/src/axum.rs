use crate::{
    Base64SerdeErr, Base64Str, Cursor, CursorVal, CursorWithVal, CursorWithValAndFilter, Sortable,
};
use axum::extract::{FromRequestParts, Query};
use axum::http::{StatusCode, request::Parts};
use axum::response::IntoResponse;
use axum::{Json, RequestPartsExt, async_trait};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use serde::de::DeserializeOwned;

/// An enum which denotes either the client did not provide a cursor value
/// or the cursor was provided and parsed.
/// Provided but invalid cursors will be rejected as 401
// TODO: in axum 0.8 there is OptionalFromRequestParts which is preferable to this
#[derive(Debug)]
pub enum CursorExtractor<Id, S: Sortable, F> {
    /// the client provided a valid parsed cursor
    Some(Cursor<Id, CursorVal<S, F>>),
    /// the client did not provide a cursor param
    None,
}

impl<Id, S: Sortable, F> CursorExtractor<Id, S, F> {
    /// convert self into an [Option]
    pub fn into_option(self) -> Option<CursorWithValAndFilter<Id, S, F>> {
        match self {
            CursorExtractor::Some(parsed_cursor) => Some(parsed_cursor),
            CursorExtractor::None => None,
        }
    }
    /// convert self into a [Query] by supplying a fallback
    pub fn into_query(self, sort: S) -> crate::cursor::Query<Id, S, F> {
        crate::cursor::Query::new(self.into_option(), sort)
    }
}

/// represents an error that can occur while extracting a [CursorExtractor]
/// from the axum request parts
#[derive(Debug)]
pub enum CusorExtractErr {
    /// an error occurred while decoding the input value
    DecodeErr(Base64SerdeErr<serde_json::Error>),
}

impl IntoResponse for CusorExtractErr {
    fn into_response(self) -> axum::response::Response {
        match self {
            CusorExtractErr::DecodeErr(Base64SerdeErr::DecodeErr(_e)) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "failed to decode cursor value",
                }),
            ),
            CusorExtractErr::DecodeErr(Base64SerdeErr::SerdeErr(_e)) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "the cursor contained unexpected data",
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
    type Rejection = CusorExtractErr;

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

        let decoded = encoded
            .decode(|bytes| serde_json::from_slice(&bytes))
            .map_err(CusorExtractErr::DecodeErr)?;

        Ok(CursorExtractor::Some(decoded))
    }
}

/// utility type for handling the cases where exactly 1 of 2 extractors must pass
pub enum Either<L, R> {
    /// the left value
    Left(L),
    /// the right value
    Right(R),
}

impl<L, R> IntoResponse for Either<L, R>
where
    L: IntoResponse,
    R: IntoResponse,
{
    fn into_response(self) -> axum::response::Response {
        match self {
            Either::Left(l) => l.into_response(),
            Either::Right(r) => r.into_response(),
        }
    }
}

#[axum::async_trait]
impl<S, L, R> FromRequestParts<S> for Either<L, R>
where
    L: FromRequestParts<S> + Send + 'static,
    L::Rejection: Send,
    R: FromRequestParts<S> + Send + 'static,
    R::Rejection: Send,
    S: Send + Sync,
{
    type Rejection = Either<L::Rejection, R::Rejection>;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let res: Result<L, _> = parts.extract_with_state(state).await;
        if let Ok(left) = res {
            return Ok(Either::Left(left));
        }
        let res2: Result<R, _> = parts.extract_with_state(state).await;

        res2.map(Either::Right).map_err(Either::Right)
    }
}
