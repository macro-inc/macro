#[cfg(test)]
mod test;

use model_user::UserContext;
use rootcause::Report;

use super::{
    models::MacroAuthorizationError,
    ports::{JwtValidator, MacroAuthorizationService},
};

/// Default authorization service backed by a credential validator.
#[derive(Clone)]
pub struct MacroAuthorizationServiceImpl<V> {
    validator: V,
}

impl<V> MacroAuthorizationServiceImpl<V> {
    /// Create an authorization service using the supplied validator.
    pub fn new(validator: V) -> Self {
        Self { validator }
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
}
