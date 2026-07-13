use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use strum::{EnumString, VariantArray};
use utoipa::ToSchema;

#[derive(Deserialize)]
pub struct VersionParams {
    pub version: Option<String>,
}

#[derive(Clone)]
pub struct ServiceNameState {
    pub service_name: VersionedApiServiceName,
}

#[derive(Clone)]
pub enum VersionedApiServiceName {
    DocumentStorageService,
    NotificationService,
    DocumentCognitionService,
    CommunicationService,
}

#[derive(Clone, Debug, Copy)]
pub enum ApiVersionEnum {
    DocumentStorageService(DocumentStorageServiceApiVersion),
    NotificationService(NotificationServiceApiVersion),
    DocumentCognitionService(DocumentCognitionServiceApiVersion),
    CommunicationService(CommunicationServiceApiVersion),
}

impl TryFrom<ApiVersionEnum> for DocumentStorageServiceApiVersion {
    type Error = anyhow::Error;

    fn try_from(value: ApiVersionEnum) -> Result<Self, Self::Error> {
        match value {
            ApiVersionEnum::DocumentStorageService(version) => Ok(version),
            _ => Err(anyhow::Error::msg("invalid api version")),
        }
    }
}

impl TryFrom<ApiVersionEnum> for DocumentCognitionServiceApiVersion {
    type Error = anyhow::Error;

    fn try_from(value: ApiVersionEnum) -> Result<Self, Self::Error> {
        match value {
            ApiVersionEnum::DocumentCognitionService(version) => Ok(version),
            _ => Err(anyhow::Error::msg("invalid api version")),
        }
    }
}

// NOTE: the versions should be in chronologically ascending order, latest version should be last

#[derive(
    EnumString, VariantArray, Clone, Debug, Serialize, Deserialize, Eq, PartialEq, ToSchema, Copy,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum DocumentStorageServiceApiVersion {
    V1,
    V2,
}

#[derive(
    EnumString, VariantArray, Clone, Debug, Serialize, Deserialize, Eq, PartialEq, ToSchema, Copy,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum NotificationServiceApiVersion {
    V1,
}

#[derive(
    EnumString, VariantArray, Clone, Debug, Serialize, Deserialize, Eq, PartialEq, ToSchema, Copy,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum DocumentCognitionServiceApiVersion {
    V1,
    V2,
}

#[derive(
    EnumString, VariantArray, Clone, Debug, Serialize, Deserialize, Eq, PartialEq, ToSchema, Copy,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CommunicationServiceApiVersion {
    V1,
}

pub fn latest<T: VariantArray + Clone>() -> T {
    T::VARIANTS.last().unwrap().clone()
}

fn parse<T: FromStr>(version: &str) -> Option<T> {
    T::from_str(version).ok()
}

fn get_latest(service_name: &VersionedApiServiceName) -> ApiVersionEnum {
    match service_name {
        VersionedApiServiceName::DocumentStorageService => {
            ApiVersionEnum::DocumentStorageService(latest::<DocumentStorageServiceApiVersion>())
        }
        VersionedApiServiceName::NotificationService => {
            ApiVersionEnum::NotificationService(latest::<NotificationServiceApiVersion>())
        }
        VersionedApiServiceName::DocumentCognitionService => {
            ApiVersionEnum::DocumentCognitionService(latest::<DocumentCognitionServiceApiVersion>())
        }
        VersionedApiServiceName::CommunicationService => {
            ApiVersionEnum::CommunicationService(latest::<CommunicationServiceApiVersion>())
        }
    }
}

fn parse_version(service_name: &VersionedApiServiceName, version: &str) -> Option<ApiVersionEnum> {
    match service_name {
        VersionedApiServiceName::DocumentStorageService => {
            parse::<DocumentStorageServiceApiVersion>(version)
                .map(ApiVersionEnum::DocumentStorageService)
        }
        VersionedApiServiceName::NotificationService => {
            parse::<NotificationServiceApiVersion>(version).map(ApiVersionEnum::NotificationService)
        }
        VersionedApiServiceName::DocumentCognitionService => {
            parse::<DocumentCognitionServiceApiVersion>(version)
                .map(ApiVersionEnum::DocumentCognitionService)
        }
        VersionedApiServiceName::CommunicationService => {
            parse::<CommunicationServiceApiVersion>(version)
                .map(ApiVersionEnum::CommunicationService)
        }
    }
}

pub async fn validate_api_version(
    State(state): State<ServiceNameState>,
    Path(VersionParams { version }): Path<VersionParams>,
    mut request: Request,
    next: Next,
) -> Response {
    let api_version = version.as_deref();
    match api_version {
        Some(api_version) => {
            if let Some(valid_api_version) = parse_version(&state.service_name, api_version) {
                request.extensions_mut().insert(valid_api_version);
                return next.run(request).await;
            }
            (
                StatusCode::NOT_FOUND,
                format!("invalid api version {}", api_version),
            )
                .into_response()
        }
        None => {
            request
                .extensions_mut()
                .insert(get_latest(&state.service_name));
            next.run(request).await
        }
    }
}
