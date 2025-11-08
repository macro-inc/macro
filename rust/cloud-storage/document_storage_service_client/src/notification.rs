use crate::error::{DssClientError, GenericErrorResponse};

use super::DocumentStorageServiceClient;

impl DocumentStorageServiceClient {
    /// Gets the users that need to be notified for a given macrotation
    #[tracing::instrument(skip(self))]
    pub async fn get_macrotation_notification_users(
        &self,
        macrotation_id: &str,
    ) -> Result<Vec<String>, DssClientError> {
        let res = self
            .client
            .get(format!(
                "{}/internal/notifications/macrotation/{macrotation_id}",
                self.url
            ))
            .send()
            .await
            .map_err(|e| DssClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                tracing::trace!("macrotation notification users retrieved");
                let result = res.json::<Vec<String>>().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => {
                tracing::error!("unauthorized");
                Err(DssClientError::Unauthorized)
            }
            reqwest::StatusCode::NOT_FOUND => {
                tracing::error!("not found");
                Err(DssClientError::NotFound)
            }
            reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!("internal server error");
                let error_message = res.text().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(DssClientError::InternalServerError {
                    details: error_message,
                })
            }
            _ => {
                let body = res.text().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(DssClientError::Generic(GenericErrorResponse {
                    message: body,
                }))
            }
        }
    }
    /// Gets the users that need to be notified for a given document
    #[tracing::instrument(skip(self))]
    pub async fn get_document_notification_users(
        &self,
        document_id: &str,
    ) -> Result<Vec<String>, DssClientError> {
        tracing::trace!(document_id=?document_id, internal_auth_key=?self.internal_auth_key, url=?self.url, "GETTING DOCUMENT NOTIFICATION USERS");
        let res = self
            .client
            .get(format!(
                "{}/internal/notifications/document/{document_id}",
                self.url
            ))
            .send()
            .await
            .map_err(|e| DssClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                tracing::trace!("document notification users retrieved");
                let result = res.json::<Vec<String>>().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => {
                tracing::error!("unauthorized");
                Err(DssClientError::Unauthorized)
            }
            reqwest::StatusCode::NOT_FOUND => {
                tracing::error!("not found");
                Err(DssClientError::NotFound)
            }
            reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!("internal server error");
                let error_message = res.text().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(DssClientError::InternalServerError {
                    details: error_message,
                })
            }
            _ => {
                let body = res.text().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(DssClientError::Generic(GenericErrorResponse {
                    message: body,
                }))
            }
        }
    }
    /// Gets the users that need to be notified for a given project
    #[tracing::instrument(skip(self))]
    pub async fn get_project_notification_users(
        &self,
        project_id: &str,
    ) -> Result<Vec<String>, DssClientError> {
        let res = self
            .client
            .get(format!(
                "{}/internal/notifications/project/{project_id}",
                self.url
            ))
            .send()
            .await
            .map_err(|e| DssClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        match res.status() {
            reqwest::StatusCode::OK => {
                tracing::trace!("project notification users retrieved");
                let result = res.json::<Vec<String>>().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Ok(result)
            }
            reqwest::StatusCode::UNAUTHORIZED => {
                tracing::error!("unauthorized");
                Err(DssClientError::Unauthorized)
            }
            reqwest::StatusCode::NOT_FOUND => {
                tracing::error!("not found");
                Err(DssClientError::NotFound)
            }
            reqwest::StatusCode::INTERNAL_SERVER_ERROR => {
                tracing::error!("internal server error");
                let error_message = res.text().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(DssClientError::InternalServerError {
                    details: error_message,
                })
            }
            _ => {
                let body = res.text().await.map_err(|e| {
                    DssClientError::Generic(GenericErrorResponse {
                        message: e.to_string(),
                    })
                })?;

                Err(DssClientError::Generic(GenericErrorResponse {
                    message: body,
                }))
            }
        }
    }
}
