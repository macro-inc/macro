//! Admission scopes for owner, provider host and shared mailbox verification limits.
use super::*;
use hmac::{Hmac, Mac};
use zeroize::Zeroizing;

/// Purpose-specific verification key, derived once from the service auth key.
/// Rotating the auth key starts fresh owner and login admission windows.
pub struct VerificationScopeKey(Zeroizing<[u8; 32]>);

impl std::fmt::Debug for VerificationScopeKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl VerificationScopeKey {
    /// Derive without retaining the raw bearer credential. No new secret is needed.
    pub fn derive(internal_auth_key: &str) -> Result<Self, Error> {
        if internal_auth_key.trim().is_empty() {
            return Err(Error::Invalid);
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(internal_auth_key.as_bytes())
            .map_err(|_| Error::Invalid)?;
        mac.update(b"macro/imap/verification-scope/v1");
        Ok(Self(Zeroizing::new(mac.finalize().into_bytes().into())))
    }

    fn digest(&self, purpose: &[u8], input: &[u8]) -> Result<String, Error> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(self.0.as_ref()).map_err(|_| Error::Invalid)?;
        mac.update(purpose);
        mac.update(input);
        Ok(format!("{:x}", mac.finalize().into_bytes()))
    }

    fn owner_scope(&self, owner: &str) -> Result<String, Error> {
        self.digest(b"imap-verification-owner:", owner.as_bytes())
    }

    fn login_scope(&self, host: &str, username: &str) -> Result<String, Error> {
        // Tuple encoding preserves exact usernames without delimiter ambiguity.
        let input = serde_json::to_vec(&(host.to_ascii_lowercase(), username))
            .map_err(|_| Error::Invalid)?;
        self.digest(b"imap-verification-login:", &input)
    }
}

pub(crate) fn scopes(
    input: &VerifyRequest,
    key: &VerificationScopeKey,
) -> Result<Vec<(String, i32)>, Error> {
    let mut scopes = vec![(key.owner_scope(&input.user_id)?, 10)];
    for endpoint in [&input.imap.endpoint, &input.smtp.endpoint] {
        scopes.push((
            format!(
                "{:x}",
                Sha256::digest(format!("host:{}", endpoint.host.to_ascii_lowercase()))
            ),
            1000,
        ));
        scopes.push((key.login_scope(&endpoint.host, &endpoint.username)?, 10));
    }
    scopes.sort_by(|a, b| a.0.cmp(&b.0));
    scopes.dedup_by(|a, b| a.0 == b.0);
    Ok(scopes)
}

#[cfg(test)]
pub(crate) mod test;
