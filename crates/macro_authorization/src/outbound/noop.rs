#[cfg(test)]
mod test;

use rootcause::Report;

use crate::domain::{
    models::{MacroAuthorizationError, ValidatedIdentity},
    ports::JwtValidator,
};

/// JWT validator for services that only support internal authorization.
///
/// Calling [`JwtValidator::validate`] is a configuration error and will panic.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoopMacroAuthJwtValidator;

impl JwtValidator for NoopMacroAuthJwtValidator {
    fn validate(&self, _jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        unimplemented!("NoopMacroAuthJwtValidator cannot validate JWTs")
    }
}
