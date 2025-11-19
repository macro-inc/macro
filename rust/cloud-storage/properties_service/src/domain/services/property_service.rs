//! Consolidated service implementation for all property operations

use crate::domain::{
    error::{PropertyError, Result},
    models::{CreatePropertyRequest, CreatePropertyResponse, PropertyDefinition},
    ports::{PermissionChecker, PropertiesStorage, PropertyService},
};

/// Concrete implementation of PropertyService
pub struct PropertyServiceImpl<S, P> {
    storage: S,
    permission_checker: P,
}

impl<S, P> PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: PermissionChecker,
{
    /// Create a new property service implementation
    pub fn new(storage: S, permission_checker: P) -> Self {
        Self {
            storage,
            permission_checker,
        }
    }
}

impl<S, P> PropertyService for PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // ===== Property Definition Operations =====

    async fn create_property(
        &self,
        request: CreatePropertyRequest,
    ) -> Result<CreatePropertyResponse> {
        // Build the property definition
        let definition = PropertyDefinition::new(
            request.display_name,
            request.data_type,
            request.owner,
            request.is_multi_select,
            request.specific_entity_type,
        );

        // Validate the definition
        definition
            .validate()
            .map_err(|e| PropertyError::ValidationError(e))?;

        // Create via storage
        self.storage
            .create_property_definition(definition)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(CreatePropertyResponse {})
    }

    // TODO: Implement remaining PropertyService trait methods
}
