#[cfg(test)]
mod test;

use model_user::UserContext;
use rootcause::Report;

use super::{
    models::MacroAuthorizationError,
    ports::{JwtValidator, MacroAuthorizationService},
};

#[derive(Clone)]
pub(crate) struct ValidatorBackedAuthorizationService<V> {
    validator: V,
}

impl<V> ValidatorBackedAuthorizationService<V> {
    pub(crate) fn new(validator: V) -> Self {
        Self { validator }
    }
}

impl<V> MacroAuthorizationService for ValidatorBackedAuthorizationService<V>
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
