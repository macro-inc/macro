use macro_auth::middleware::decode_jwt::JwtValidationArgs;

use crate::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    domain::validator_service::ValidatorBackedAuthorizationService,
};

impl MacroAuthorizationServiceImpl {
    /// Create the production authorization service from JWT validation
    /// configuration.
    pub fn from_jwt_validation_args(jwt_validation_args: JwtValidationArgs) -> Self {
        let validator = MacroAuthJwtValidator::new(jwt_validation_args);
        Self::new(ValidatorBackedAuthorizationService::new(validator))
    }
}
