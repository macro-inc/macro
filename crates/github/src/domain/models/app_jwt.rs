use super::GithubError;
use jsonwebtoken::{Algorithm, EncodingKey, Header};

#[cfg(test)]
mod test;

/// How long an App JWT stays valid. GitHub rejects anything over ten minutes.
const LIFETIME_SECONDS: i64 = 10 * 60;

/// How far the issued-at time is backdated, so a small clock skew between us
/// and GitHub cannot make a freshly signed token look future-dated.
const BACKDATE_SECONDS: i64 = 60;

/// The claims GitHub reads off an App JWT. It ignores anything else, and
/// rejects the token outright if these three are wrong.
#[derive(serde::Serialize)]
struct AppClaims<'a> {
    /// Issued at, in seconds since the epoch.
    iat: i64,
    /// Expires at, in seconds since the epoch.
    exp: i64,
    /// The App's client id.
    iss: &'a str,
}

/// A signed, short-lived proof that we are the GitHub App.
///
/// A newtype rather than a `String` because the sync client's port also
/// passes user OAuth access tokens as strings, in the same argument
/// position - and an App JWT handed to a user endpoint (or the reverse)
/// compiles fine and fails only at GitHub, confusingly. The type makes the
/// two credentials unmixable.
pub struct AppJwt(String);

impl AppJwt {
    /// The JWT as GitHub accepts it in a bearer header.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// A credential that can mint tokens for every installation; it stays out of
// debug output.
impl std::fmt::Debug for AppJwt {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AppJwt([REDACTED])")
    }
}

/// Sign a short-lived JWT proving we are the GitHub App.
///
/// This is the first half of every App-authenticated exchange: GitHub trades
/// this JWT for something narrower - an installation access token, or the
/// installation record for a repository - and only ever accepts it directly on
/// the `/app/...` endpoints.
///
/// `iss` is the App's *client id* rather than its numeric App id, which is what
/// GitHub now documents. Both are accepted today, but the numeric form is the
/// legacy one.
pub fn app_jwt(client_id: &str, private_key_pem: &str) -> Result<AppJwt, GithubError> {
    let now = chrono::Utc::now().timestamp();
    let claims = AppClaims {
        iat: now - BACKDATE_SECONDS,
        exp: now + LIFETIME_SECONDS,
        iss: client_id,
    };

    let key = EncodingKey::from_rsa_pem(private_key_pem.as_bytes())
        .map_err(|error| GithubError::Internal(anyhow::anyhow!("invalid PEM key: {error}")))?;

    jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map(AppJwt)
        .map_err(|error| GithubError::Internal(anyhow::anyhow!("failed to encode JWT: {error}")))
}
