use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};
use tracing::error;
use worker::Error;

use crate::{constants::header_names, error::ResultExt, secrets::Secrets};

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum AccessLevel {
    /// User can view the document
    #[default]
    View = 0,
    /// User can comment on the document
    /// In this context, this is the same thing as [AccessLevel::View]
    Comment = 1,
    /// User can edit the document
    Edit = 2,
    /// User is the owner of the document
    Owner = 3,
    /// Internal communication
    Admin = 4,
}

impl AccessLevel {
    pub fn can_edit(&self) -> bool {
        self >= &AccessLevel::Comment
    }
}

#[derive(Deserialize, Debug)]
pub struct AuthToken {
    pub user_id: Option<String>,
    document_id: String,
    pub access_level: AccessLevel,
}

impl AuthToken {
    pub fn has_permission(&self, al: &AccessLevel) -> bool {
        if self.access_level < *al {
            error!(
                "Current permission level [{:?}] is not enough for [{:?}]",
                self.access_level, al
            );
            return false;
        }
        true
    }
    pub fn has_document_id_access(&self, document_id: &str) -> bool {
        if !(self.document_id == document_id || matches!(self.access_level, AccessLevel::Admin)) {
            error!(
                "Don't have permission for document: [{:?}]
Auth'd document [{:?}]
access level [{:?}]",
                document_id, self.document_id, self.access_level
            );
            return false;
        }
        true
    }
}

#[derive(Deserialize, Debug)]
pub struct WebsocketQueryParams {
    pub token: String,
}

pub enum TokenFrom {
    Headers,
    QueryParams,
}

pub fn decode_jwt(
    req: &worker::Request,
    env: &worker::Env,
    token_from: TokenFrom,
) -> worker::Result<AuthToken> {
    let secrets = Secrets::from(env);
    let token = match token_from {
        TokenFrom::Headers => {
            // NB: rewrite with if/let chain on edition 2024
            let is_admin = match req
                .headers()
                .get(header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY)?
            {
                // sholud we warn when false?
                Some(internal_key) => {
                    let res = internal_key == secrets.internal_api_secret;
                    if !res {
                        error!(
                            "provided header: {internal_key}
did not match expected value: {}",
                            secrets.internal_api_secret
                        );
                    }
                    res
                }
                None => false,
            };

            if is_admin {
                return Ok(AuthToken {
                    user_id: None,
                    document_id: "TODO should be option".to_string(),
                    access_level: AccessLevel::Admin,
                });
            }

            match req.headers().get(header_names::AUTHORIZATION)? {
                Some(header) => match header.strip_prefix("Bearer ") {
                    Some(token) => token.to_string(),
                    None => {
                        return Err(Error::from(
                            "'Authorization' heard malformed. No 'Bearer ' prefix",
                        ));
                    }
                },
                None => return Err(Error::from("Missing 'Authorization' header")),
            }
        }
        TokenFrom::QueryParams => req.query::<WebsocketQueryParams>()?.token,
    };

    let validation = Validation::new(Algorithm::HS256);
    let secret = secrets.document_permissions_secret;
    let key = DecodingKey::from_secret(secret.to_string().as_bytes());

    let claims = decode::<AuthToken>(&token, &key, &validation)
        .context("failed to decode `AuthToken`")?
        .claims;

    Ok(claims)
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    #[allow(clippy::nonminimal_bool, reason = "demonstrate ordering")]
    fn orderable() {
        let view = AccessLevel::View;
        let comment = AccessLevel::Comment;
        let edit = AccessLevel::Edit;
        let owner = AccessLevel::Owner;

        assert!(view < comment);
        assert!(view <= view);
        assert!(!(view < view));
        assert!(edit <= owner);
        assert!(view <= edit);
        assert!(view < owner);
        assert!(!(owner < view));
    }
}
