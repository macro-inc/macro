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
    internal_auth: InternalAuthConfig,
}

impl<V> MacroAuthorizationServiceImpl<V> {
    /// Create an authorization service using the supplied validator and required internal authorization configuration.
    pub fn new(validator: V, internal_auth: InternalAuthConfig) -> Self {
        Self {
            validator,
            internal_auth,
        }
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
        if !constant_time_eq(
            provided_key.as_bytes(),
            self.internal_auth.api_key.as_bytes(),
        ) {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let Some(user_id) = claims
            .user_id
            .or_else(|| self.internal_auth.default_user_id.clone())
        else {
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
