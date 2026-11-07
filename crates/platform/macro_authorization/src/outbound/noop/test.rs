use super::*;

#[test]
#[should_panic(expected = "NoopMacroAuthJwtValidator cannot validate JWTs")]
fn validate_panics() {
    let _ = NoopMacroAuthJwtValidator.validate("jwt");
}
