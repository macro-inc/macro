#[cfg(test)]
mod test;

use rootcause::Report;

use crate::domain::{
    models::{MacroAuthorizationError, ValidatedCredential},
    ports::JwtValidator,
};

/// JWT validator for services that only support internal authorization.
///
/// Calling [`JwtValidator::validate_credential`] is a configuration error and will panic.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoopMacroAuthJwtValidator;

impl JwtValidator for NoopMacroAuthJwtValidator {
    fn validate_credential(
        &self,
        _jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        unimplemented!("NoopMacroAuthJwtValidator cannot validate JWTs")
    }
}
