use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::borrow::Cow;
use url::{ParseError, Url};

#[cfg(test)]
mod test;

/// The query parameter name used to store the HMAC signature.
const SIG_PARAM: &str = "sig";

/// Append `path` onto `base` without discarding `base`'s existing path.
pub fn append_path(mut base: Url, path: &str) -> Url {
    let prefix = base.path().trim_end_matches('/');
    let suffix = path.trim_start_matches('/');
    base.set_path(&format!("{prefix}/{suffix}"));
    base
}

/// Rebuild the public URL the client requested.
pub fn public_request_url(
    scheme: &str,
    host: &str,
    path_and_query: &str,
) -> Result<Url, ParseError> {
    let path_and_query = if path_and_query.starts_with('/') {
        Cow::Borrowed(path_and_query)
    } else {
        Cow::Owned(format!("/{path_and_query}"))
    };
    Url::parse(&format!("{scheme}://{host}{path_and_query}"))
}

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

/// Marks an unsubscribe link in an email body that the producer cannot sign. The notification
/// service holds the signing key and replaces `macro-unsubscribe:<type name>` with a signed URL
/// that turns that notification type off for the recipient.
pub const UNSUBSCRIBE_PLACEHOLDER_PREFIX: &str = "macro-unsubscribe:";

/// The placeholder an email template puts in its unsubscribe `href` for `type_name`.
pub fn unsubscribe_placeholder(type_name: &str) -> String {
    format!("{UNSUBSCRIBE_PLACEHOLDER_PREFIX}{type_name}")
}

/// The signed URL that turns `type_name` off for `user_id` without signing in.
pub fn unsubscribe_url(
    notification_service_url: Url,
    type_name: &str,
    user_id: &str,
    mac: Hmac<Sha256>,
) -> SignedUrl {
    let mut url = append_path(
        notification_service_url,
        &format!("/user_notifications/preferences/{type_name}/disable"),
    );
    url.query_pairs_mut().append_pair("id", user_id).finish();
    SignedUrl::new(url, mac)
}

/// Replaces every unsubscribe placeholder in an HTML `body` with a signed URL for `user_id`.
/// Returns `None` when the body has no placeholder.
pub fn sign_unsubscribe_placeholders(
    body: &str,
    notification_service_url: &Url,
    user_id: &str,
    mac: &Hmac<Sha256>,
) -> Option<String> {
    if !body.contains(UNSUBSCRIBE_PLACEHOLDER_PREFIX) {
        return None;
    }
    let mut signed = String::with_capacity(body.len() + 256);
    let mut rest = body;
    while let Some(start) = rest.find(UNSUBSCRIBE_PLACEHOLDER_PREFIX) {
        signed.push_str(&rest[..start]);
        let after = &rest[start + UNSUBSCRIBE_PLACEHOLDER_PREFIX.len()..];
        let type_len = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        let url = unsubscribe_url(
            notification_service_url.clone(),
            &after[..type_len],
            user_id,
            mac.clone(),
        );
        signed.push_str(&url.as_ref().as_str().replace('&', "&amp;"));
        rest = &after[type_len..];
    }
    signed.push_str(rest);
    Some(signed)
}

impl AsRef<Url> for SignedUrl {
    fn as_ref(&self) -> &Url {
        &self.0
    }
}
