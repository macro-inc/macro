use anyhow::Context;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use macro_env::Environment;
use macro_env_var::{VarNameErr, env_var};
use remote_env_var::{LocalOrRemoteSecret, SecretManager};
use thiserror::Error;

use crate::{error::MacroAuthError, macro_api_token::MacroApiToken};

#[derive(Clone)]
pub struct JwtValidationArgs {
    audience: Audience,
    issuer: Issuer,
    jwt_secret: LocalOrRemoteSecret<JwtSecretKey>,
    macro_api_token_issuer: MacroApiTokenIssuer,
    macro_api_token_public_key: LocalOrRemoteSecret<MacroApiTokenPublicKey>,
}

#[derive(Debug, Error)]
pub enum JwtValidationErr<T> {
    #[error("Var error: {0}")]
    VarErr(#[from] VarNameErr),
    #[error("Remote Err: {0}")]
    RemoteErr(T),
}

impl JwtValidationArgs {
    /// create a new instance of self by reading the required data from the environment
    pub async fn new_with_secret_manager<T: SecretManager>(
        env: Environment,
        secret_manager: &T,
    ) -> Result<Self, JwtValidationErr<T::Err>> {
        let Env {
            audience,
            issuer,
            macro_api_token_issuer,
        } = Env::new()?;
        let (jwt_secret, macro_api_token_public_key) = tokio::try_join!(
            secret_manager.get_maybe_secret_value(env, JwtSecretKey::new()?),
            secret_manager.get_maybe_secret_value(env, MacroApiTokenPublicKey::new()?)
        )
        .map_err(JwtValidationErr::RemoteErr)?;
        Ok(Self {
            audience,
            issuer,
            jwt_secret,
            macro_api_token_issuer,
            macro_api_token_public_key,
        })
    }

    #[cfg(feature = "testing")]
    /// create a new instance of Self with all empty values
    pub fn new_testing() -> Self {
        Self {
            audience: Audience::Comptime(""),
            issuer: Issuer::Comptime(""),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::Comptime("")),
            macro_api_token_issuer: MacroApiTokenIssuer::Comptime(""),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::Comptime(""),
            ),
        }
    }
}

env_var! {
    #[derive(Clone)]
    struct JwtSecretKey;
}

env_var! {
    #[derive(Clone)]
    struct MacroApiTokenPublicKey;
}

env_var! {
    #[derive(Debug, Clone)]
    pub struct Env {
        #[derive(Debug, Clone)]
        Audience,
        #[derive(Debug, Clone)]
        Issuer,
        #[derive(Debug, Clone)]
        MacroApiTokenIssuer
    }
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct MacroAccessToken {
    /// The audience of the token
    /// This is the fuisionauth application id
    pub aud: String,
    /// The expiration time of the token
    pub exp: usize,
    /// The tenant id of the token
    pub tid: String,
    /// The issuer of the token
    /// This is the fuisionauth domain
    pub iss: String,
    /// The email of the user
    pub email: String,
    /// The fusionauth id of the user
    pub fusion_user_id: String,
    /// The macro user id of the user
    pub macro_user_id: String,
    /// The organization id for the user if they belong to one
    pub macro_organization_id: Option<i32>,
    /// The root macro id. If provided, if None, use fusion_user_id
    pub root_macro_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub enum JwtToken {
    MacroAccessToken(MacroAccessToken),
    MacroApiToken(MacroApiToken),
}

pub fn validate_macro_access_token(
    macro_access_token: &str,
    args: &JwtValidationArgs,
) -> Result<MacroAccessToken, MacroAuthError> {
    validate_macro_access_token_inner(
        macro_access_token,
        &args.jwt_secret,
        &args.audience,
        &args.issuer,
    )
}

fn validate_macro_access_token_inner(
    macro_access_token: &str,
    jwt_secret: &LocalOrRemoteSecret<JwtSecretKey>,
    audience: &Audience,
    issuer: &Issuer,
) -> Result<MacroAccessToken, MacroAuthError> {
    // Verify and decode the JWT
    let mut validation = Validation::new(Algorithm::HS256);

    validation.leeway = 0;
    validation.reject_tokens_expiring_in_less_than = 60;

    validation.set_audience(&[audience.as_ref()]);
    validation.set_issuer(&[issuer.as_ref()]);

    // Attempt to decode the token.
    let decoded_jwt: MacroAccessToken = match decode::<MacroAccessToken>(
        macro_access_token,
        &DecodingKey::from_secret(jwt_secret.as_ref().as_bytes()),
        &validation,
    ) {
        Ok(decoded) => decoded.claims,
        Err(e) => match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                return Err(MacroAuthError::JwtExpired);
            }
            _ => {
                return Err(MacroAuthError::JwtValidationFailed {
                    details: e.to_string(),
                });
            }
        },
    };

    Ok(decoded_jwt)
}

#[tracing::instrument(skip_all)]
fn validate_macro_api_token(
    macro_api_token: &str,
    public_key: &LocalOrRemoteSecret<MacroApiTokenPublicKey>,
    issuer: &MacroApiTokenIssuer,
) -> Result<MacroApiToken, MacroAuthError> {
    // Verify and decode the JWT
    let mut validation = Validation::new(Algorithm::RS256);

    validation.set_issuer(&[issuer.as_ref()]);

    let decoding_key = DecodingKey::from_rsa_pem(public_key.as_ref().as_bytes())
        .context("unable to decode key")?;

    // Attempt to decode the token.
    let decoded_jwt: MacroApiToken =
        match decode::<MacroApiToken>(macro_api_token, &decoding_key, &validation) {
            Ok(decoded) => decoded.claims,
            Err(e) => match e.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                    return Err(MacroAuthError::JwtExpired);
                }
                _ => {
                    return Err(MacroAuthError::JwtValidationFailed {
                        details: e.to_string(),
                    });
                }
            },
        };

    Ok(decoded_jwt)
}

/// Takes in a token (either a macro-access-token or a macro-api-token) and returns the decoded JWT token.
pub fn handler(
    jwt_validation_args: &JwtValidationArgs,
    access_token: &str,
) -> Result<JwtToken, MacroAuthError> {
    let token = jsonwebtoken::decode_header(access_token).context("unable to decode token")?;

    let kid = token.kid.context("expected kid")?;

    if kid == "macro" {
        let decoded_jwt = match validate_macro_api_token(
            access_token,
            &jwt_validation_args.macro_api_token_public_key,
            &jwt_validation_args.macro_api_token_issuer,
        ) {
            Ok(decoded_jwt) => decoded_jwt,
            Err(e) => {
                match e {
                    MacroAuthError::JwtExpired => {}
                    _ => {
                        tracing::error!(error=?e, "unable to decode jwt");
                    }
                }
                return Err(e);
            }
        };
        Ok(JwtToken::MacroApiToken(decoded_jwt))
    } else {
        let decoded_jwt = match validate_macro_access_token_inner(
            access_token,
            &jwt_validation_args.jwt_secret,
            &jwt_validation_args.audience,
            &jwt_validation_args.issuer,
        ) {
            Ok(decoded_jwt) => decoded_jwt,
            Err(e) => {
                match e {
                    MacroAuthError::JwtExpired => {}
                    _ => {
                        tracing::error!(error=?e, "unable to decode jwt");
                    }
                }
                return Err(e);
            }
        };

        Ok(JwtToken::MacroAccessToken(decoded_jwt))
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use anyhow::Context;

    use super::*;

    fn create_test_jwt(
        audience: &str,
        issuer: &str,
        email: &str,
        jwt_secret: &str,
        time: Option<usize>,
    ) -> String {
        // Get current timestamp
        let now = time.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as usize
        });

        let claims = MacroAccessToken {
            aud: audience.to_string(),
            exp: now + 3600, // Token expires in 1 hour
            iss: issuer.to_string(),
            tid: "tenant_id".to_string(),
            email: email.to_string(),
            fusion_user_id: "fusion_testing".to_string(),
            macro_user_id: "macro|testing".to_string(),
            macro_organization_id: None,
            root_macro_id: None,
        };

        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256);
        header.kid = Some("fromFusionauth".to_string());
        jsonwebtoken::encode(
            &header,
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(jwt_secret.as_ref()),
        )
        .expect("Failed to create test JWT")
    }

    pub const PRIVATE_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAlR0tDzyTkQuUyGg1zHKyvR5O2h2oQQV61MbaqojLL9G1VNQL
flHcqLI0XBglzRR0el21pRaNZYgguf78DpOF08KvWmKSpcqLM4P/F0GG5T4fT08a
kkXJH0+nejy4oa8CvnbDT/1C0H6gONQHzLFlzydtAlk2bjeXWaWrro0X9YTILRZS
QmPkN/4A/9xDdI2LTHP8VdcopYh1Uj+VFtFF9x7qpjXRkRlOHzD2Lj0qtmFY68v7
8aFtMbrCp8OmE5sg/6vOFTjz/dcjpdHPa++ab4zZbyQjbfy7RQdG/2zki8N3znMP
aa5JO4R5/Ot48vLAOowM9GR0FVYMBPqT0voECwIDAQABAoIBADX//mDtsY0N8iAP
aSg0g1ksoCaqJdQCPYTPzMGET3zuR2pEbjMdRzlKa97MGehmV3Y2+ICkJamWvi9N
UY+fyg+xidpEJ1JmAroxu4/6+XSMZj9M6NT+88JkkMSaN8zJuccq8DlIAMnLiY96
7aYpujJmVzpJ/4WzmRpsfjt0ui/9i9fefnZBFPFnNK16jrJ2RQBokglMKmpUg+yL
lVdPp57RS38LcBKEbMb6C20iMtZ+ZNxPF4rgzXEJyNRjl0Gh9ukjbnxm8aDkj/Xy
MHizGM0SnZ7VIkclu5CgtOM59V3HSG6ilifj9JkfkEe1pHHp71hVSHz8RF2NjfXa
rLRnuCkCgYEAzu97s4VMKXG5IvX2/m64sUJL/rB4WmtCl4x6Ru+gM+vUEmpmE1VF
FimOF0U10CsSKkJ51ZVVcdldQCO8uZD52N0iBJSVkzXcMUQUQs25NrAkmhqdqwQk
qm7KXXDBO1to3cMKeVUkrb5/uJpzsxOtctqYdqRkGsEGrGJJ+w8ByvkCgYEAuHgO
tgH5dI9wnyV1MlRlFT/60rvJq4GRD6zkR59/kGx6pvUfjl0s3+OoOi2Fco7girt2
1gznpfYgFRzE8Q9LKZCl3kdquNEEadoyRpERhYYKWW20FyYqFAPVrjdnjebrD/D1
wYzBsQyylzpwsgOCUX9raQczb2Ua+9L8EwCCZCMCgYAjyzjSbJQn9wvXCESY7f30
a0tJ2qx2t2blX98mtfw3/urH5K+TWISCuN1jGQ2d3FVgCe+ZCiOldbuzhHr4fiM5
Z8ailDDrLb3Qp735cCxBUWaDYWc0VZsh/9fxIbfK1Jzm/v2ozxlxFCpzfAPXTegK
ndURcI4AMrM8ziON0aK1wQKBgEj8Z4Wn3lU586tkHKyfK6duuwTp++75wrVbCK81
8jjoUtcAIU4om3qyDnuGS0h6M2lwpqImVPkbGrJ/wYRHMsvtSVNbGmSpfn+LL10w
RKh50lpzx09pcDifE8psbXJ9rP+PrQy5bmFozrh7DN/B96vbKFpT2Qv4CuccIVQ7
XVvVAoGAahMpYHYDr+BsB2On8xd5rzkDpUeDwiWCyCaZTb7BjrpWhv5K35GOWkYh
rS9MdSsDAdjiHGRRkX9C6oTx4w4pfxKSN65wAO6gI22oVrcWAMIR7CACmJHnIMxV
wuFWLzXAeE7o05XSvntpugiYm2fkekCTRoJM9OdIfrxLC4fTIeA=
-----END RSA PRIVATE KEY-----"#;
    pub const PUBLIC_KEY: &str = r#"-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlR0tDzyTkQuUyGg1zHKy
vR5O2h2oQQV61MbaqojLL9G1VNQLflHcqLI0XBglzRR0el21pRaNZYgguf78DpOF
08KvWmKSpcqLM4P/F0GG5T4fT08akkXJH0+nejy4oa8CvnbDT/1C0H6gONQHzLFl
zydtAlk2bjeXWaWrro0X9YTILRZSQmPkN/4A/9xDdI2LTHP8VdcopYh1Uj+VFtFF
9x7qpjXRkRlOHzD2Lj0qtmFY68v78aFtMbrCp8OmE5sg/6vOFTjz/dcjpdHPa++a
b4zZbyQjbfy7RQdG/2zki8N3znMPaa5JO4R5/Ot48vLAOowM9GR0FVYMBPqT0voE
CwIDAQAB
-----END PUBLIC KEY-----"#;

    fn create_test_macro_api_token_jwt(
        issuer: &str,
        macro_user_id: &str,
        fusionauth_id: &str,
        organization_id: Option<i32>,
        private_key: &str,
        time: Option<usize>,
    ) -> String {
        // Get current timestamp
        let now = time.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as usize
        });

        let claims = MacroApiToken {
            exp: now + 3600, // Token expires in 1 hour
            iss: issuer.to_string(),
            fusion_user_id: fusionauth_id.to_string(),
            macro_user_id: macro_user_id.to_string(),
            macro_organization_id: organization_id,
        };

        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        header.kid = Some("macro".to_string());
        jsonwebtoken::encode(
            &header,
            &claims,
            &jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_ref()).unwrap(),
        )
        .expect("Failed to create test JWT")
    }

    #[test]
    fn test_handler_macro_access_token() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing("test_audience"),
            issuer: Issuer::new_testing("test.macro.com"),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("super_secret_key")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(PUBLIC_KEY),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing("test.macro.com"),
        };

        let token = create_test_jwt(
            "test_audience",
            "test.macro.com",
            "test@macro.com",
            "super_secret_key",
            None,
        );

        let result = handler(&jwt_validation_args, &token)?;

        let result = match result {
            JwtToken::MacroAccessToken(token) => token,
            _ => panic!("expected macro-access-token"),
        };

        assert_eq!(result.aud, "test_audience");

        Ok(())
    }

    #[test]
    fn test_handler_macro_api_token() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing("test_audience"),
            issuer: Issuer::new_testing("test.macro.com"),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("super_secret_key")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(PUBLIC_KEY),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing("test.macro.com"),
        };

        let token = create_test_macro_api_token_jwt(
            "test.macro.com",
            "macro|test@macro.com",
            "fusionauth_user_id",
            None,
            PRIVATE_KEY,
            None,
        );

        let result = handler(&jwt_validation_args, &token)?;

        let result = match result {
            JwtToken::MacroApiToken(token) => token,
            _ => panic!("expected macro-api-token"),
        };

        assert!(!result.fusion_user_id.is_empty());

        Ok(())
    }

    #[test]
    fn test_validate_macro_access_token_jwt_token() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing("test_audience"),
            issuer: Issuer::new_testing("test.macro.com"),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("super_secret_key")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(""),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing(""),
        };

        let token = create_test_jwt(
            "test_audience",
            "test.macro.com",
            "test@macro.com",
            "super_secret_key",
            None,
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_access_token_inner(
            &token,
            &jwt_validation_args.jwt_secret,
            &jwt_validation_args.audience,
            &jwt_validation_args.issuer,
        )?;

        assert_eq!(result.email, "test@macro.com");

        Ok(())
    }

    #[test]
    fn test_validate_macro_access_token_jwt_token_invalid_audience() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing("test_audience"),
            issuer: Issuer::new_testing("test.macro.com"),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("super_secret_key")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(""),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing(""),
        };

        let token = create_test_jwt(
            "bad",
            "test.macro.com",
            "test@macro.com",
            "super_secret_key",
            None,
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_access_token_inner(
            &token,
            &jwt_validation_args.jwt_secret,
            &jwt_validation_args.audience,
            &jwt_validation_args.issuer,
        )
        .err()
        .context("expected error")?;

        assert_eq!(result.to_string(), "jwt validation failed: InvalidAudience");

        Ok(())
    }

    #[test]
    fn test_validate_macro_access_token_jwt_token_invalid_issuer() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing("test_audience"),
            issuer: Issuer::new_testing("test.macro.com"),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("super_secret_key")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(""),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing(""),
        };

        let token = create_test_jwt(
            "test_audience",
            "bad.macro.com",
            "test@macro.com",
            "super_secret_key",
            None,
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_access_token_inner(
            &token,
            &jwt_validation_args.jwt_secret,
            &jwt_validation_args.audience,
            &jwt_validation_args.issuer,
        )
        .err()
        .context("expected error")?;

        assert_eq!(result.to_string(), "jwt validation failed: InvalidIssuer");

        Ok(())
    }

    #[test]
    fn test_validate_macro_access_token_jwt_token_expired() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing("test_audience"),
            issuer: Issuer::new_testing("test.macro.com"),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("super_secret_key")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(""),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing(""),
        };

        let token = create_test_jwt(
            "test_audience",
            "bad.macro.com",
            "test@macro.com",
            "super_secret_key",
            Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as usize
                    - 10000,
            ),
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_access_token_inner(
            &token,
            &jwt_validation_args.jwt_secret,
            &jwt_validation_args.audience,
            &jwt_validation_args.issuer,
        )
        .err()
        .context("expected error")?;

        assert_eq!(result.to_string(), "jwt is expired");

        Ok(())
    }

    #[test]
    fn test_validate_macro_api_token_jwt_token() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing(""),
            issuer: Issuer::new_testing(""),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(PUBLIC_KEY),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing("test.macro.com"),
        };

        let token = create_test_macro_api_token_jwt(
            "test.macro.com",
            "macro|test@macro.com",
            "fusionauth_user_id",
            None,
            PRIVATE_KEY,
            None,
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_api_token(
            &token,
            &jwt_validation_args.macro_api_token_public_key,
            &jwt_validation_args.macro_api_token_issuer,
        )?;

        assert_eq!(result.macro_user_id, "macro|test@macro.com");

        Ok(())
    }

    #[test]
    fn test_validate_macro_api_token_jwt_token_invalid_issuer() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing(""),
            issuer: Issuer::new_testing(""),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(PUBLIC_KEY),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing("test.macro.com"),
        };

        let token = create_test_macro_api_token_jwt(
            "bad.macro.com",
            "macro|test@macro.com",
            "fusionauth_user_id",
            None,
            PRIVATE_KEY,
            None,
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_api_token(
            &token,
            &jwt_validation_args.macro_api_token_public_key,
            &jwt_validation_args.macro_api_token_issuer,
        )
        .err()
        .context("expected error")?;

        assert_eq!(result.to_string(), "jwt validation failed: InvalidIssuer");

        Ok(())
    }

    #[test]
    fn test_validate_macro_api_token_jwt_token_expired() -> anyhow::Result<()> {
        let jwt_validation_args = JwtValidationArgs {
            audience: Audience::new_testing(""),
            issuer: Issuer::new_testing(""),
            jwt_secret: LocalOrRemoteSecret::Local(JwtSecretKey::new_testing("")),
            macro_api_token_public_key: LocalOrRemoteSecret::Local(
                MacroApiTokenPublicKey::new_testing(PUBLIC_KEY),
            ),
            macro_api_token_issuer: MacroApiTokenIssuer::new_testing("test.macro.com"),
        };

        let token = create_test_macro_api_token_jwt(
            "test.macro.com",
            "macro|test@macro.com",
            "fusionauth_user_id",
            None,
            PRIVATE_KEY,
            Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as usize
                    - 10000,
            ),
        );

        // Make jwt here using jsonwebtoken crate
        let result = validate_macro_api_token(
            &token,
            &jwt_validation_args.macro_api_token_public_key,
            &jwt_validation_args.macro_api_token_issuer,
        )
        .err()
        .context("expected error")?;

        assert_eq!(result.to_string(), "jwt is expired");

        Ok(())
    }
}
