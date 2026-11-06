//! One-time bootstrap material for the fleet operator, never a user route.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use hosted_runtimes::domain::{
    ids::ComputerId,
    persona_credentials::{EnrollmentGeneration, PersonaCredentialError, PersonaEnrollment},
    ports::PersonaCredentialSource,
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::ser::SerializeStruct;

/// Explicit one-time transport serializer; the domain secret type is not Serialize.
struct EnrollmentResponse(PersonaEnrollment);

impl serde::Serialize for EnrollmentResponse {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut fields = serializer.serialize_struct("PersonaEnrollment", 2)?;
        fields.serialize_field("secrets", self.0.secrets.expose())?;
        fields.serialize_field("env", self.0.env.as_map())?;
        fields.end()
    }
}

#[tracing::instrument(skip_all, fields(%computer, generation), err)]
pub async fn handler<S: PersonaCredentialSource + 'static, A: MacroAuthorizationService>(
    State(source): State<Arc<S>>,
    _authorization: MacroAuthorizationExtractor<A, InternalOnly>,
    Path((computer, generation)): Path<(ComputerId, u32)>,
) -> Result<Response, StatusCode> {
    let enrollment = source
        .issue(computer, EnrollmentGeneration::new(generation))
        .await
        .map_err(|error| match error {
            PersonaCredentialError::NotFound => StatusCode::NOT_FOUND,
            _ => StatusCode::SERVICE_UNAVAILABLE,
        })?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(EnrollmentResponse(enrollment)),
    )
        .into_response())
}
