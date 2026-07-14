#[cfg(test)]
mod test;

use constant_time_eq::constant_time_eq;
use model_user::UserContext;
use rootcause::Report;

use super::{
    models::{InternalAuthConfig, InternalIdentityClaims, MacroAuthorizationError},
    ports::{JwtValidator, MacroAuthorizationService},
};

/// Default authorization service backed by a credential validator.
#[derive(Clone)]
pub struct MacroAuthorizationServiceImpl<V> {
    validator: V,
    internal_auth: Option<InternalAuthConfig>,
}

impl<V> MacroAuthorizationServiceImpl<V> {
    /// Create an authorization service using the supplied validator.
    pub fn new(validator: V) -> Self {
        Self {
            validator,
            internal_auth: None,
        }
    }

    /// Enable internal service-to-service authorization using the supplied configuration.
    pub fn with_internal_auth(mut self, config: InternalAuthConfig) -> Self {
        self.internal_auth = Some(config);
        self
    }
}

impl<V> MacroAuthorizationService for MacroAuthorizationServiceImpl<V>
where
    V: JwtValidator,
{
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        let identity = self.validator.validate(jwt)?;

        Ok(UserContext {
            user_id: identity.user_id,
            fusion_user_id: identity.fusion_user_id,
            permissions: identity.permissions,
            organization_id: identity.organization_id,
        })
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        let Some(config) = &self.internal_auth else {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        };

        if !constant_time_eq(provided_key.as_bytes(), config.api_key.as_bytes()) {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let Some(user_id) = claims.user_id.or_else(|| config.default_user_id.clone()) else {
            return Ok(None);
        };

        Ok(Some(UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            permissions: None,
            organization_id: claims.organization_id,
        }))
    }
}
