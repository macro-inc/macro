use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::borrow::Cow;
use url::Url;

#[cfg(test)]
mod test;

/// The query parameter name used to store the HMAC signature.
const SIG_PARAM: &str = "sig";

/// A wrapper over url which is guaranteed to be a cryptographically signed url.
/// The signature exists as a query param under "sig".
pub struct SignedUrl(Url);

impl SignedUrl {
    /// Create a signed URL by computing an HMAC-SHA256 over the canonicalized
    /// URL string and appending the hex-encoded signature as the `sig` query parameter.
    pub fn new(u: Url, mac: Hmac<Sha256>) -> Self {
        let canonical = Self::canonicalize(&u);
        let sig = hex::encode(Self::compute_mac(&canonical, mac).into_bytes());
        let mut signed = canonical;
        signed.query_pairs_mut().append_pair(SIG_PARAM, &sig);
        Self(signed)
    }

    /// Canonicalize a URL by re-serializing its query pairs through
    /// `query_pairs()`/`extend_pairs()` so that both `new()` and `verify()`
    /// MAC the same byte representation.
    fn canonicalize(u: &Url) -> Url {
        let pairs: Vec<(Cow<'_, str>, Cow<'_, str>)> = u.query_pairs().collect();
        let mut canonical = u.clone();
        canonical
            .query_pairs_mut()
            .clear()
            .extend_pairs(pairs)
            .finish();
        canonical
    }

    fn compute_mac(u: &Url, mut mac: Hmac<Sha256>) -> hmac::digest::CtOutput<Hmac<Sha256>> {
        mac.update(u.as_str().as_bytes());
        mac.finalize()
    }

    /// Verify a URL that is expected to contain a `sig` query parameter.
    /// Returns `Some(SignedUrl)` if the signature is valid, `None` otherwise.
    pub fn verify(u: Url, mac: Hmac<Sha256>) -> Option<Self> {
        let (sig, others) = u
            .query_pairs()
            .partition::<Vec<(Cow<'_, str>, Cow<'_, str>)>, _>(|(k, _v)| k == SIG_PARAM);

        let [(_key, expected)] = sig.as_slice() else {
            return None;
        };

        // Reconstruct the URL without the sig param to compute the expected HMAC.
        let mut unsigned = u.clone();
        unsigned
            .query_pairs_mut()
            .clear()
            .extend_pairs(others)
            .finish();

        let expected_bytes = hex::decode(expected.as_ref()).ok()?;
        let mut verifier = mac;
        verifier.update(unsigned.as_str().as_bytes());
        verifier
            .verify_slice(&expected_bytes)
            .ok()
            .map(|()| Self(u))
    }
}

impl AsRef<Url> for SignedUrl {
    fn as_ref(&self) -> &Url {
        &self.0
    }
}
