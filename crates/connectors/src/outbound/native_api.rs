//! REST apps Macro signs in to with its own OAuth client: the native API
//! source. Autodesk (Autodesk Platform Services) is the one app so far.
//!
//! A user connects by authorizing Macro's registered client at the vendor
//! (authorization code with PKCE); the vendor redirects to the fixed callback
//! route, which exchanges the code and stores the grant. The grant lives in
//! `api_app_connections` only as a KMS envelope bound to the user and app
//! (CS-72). Each API call reads it, refreshes the access token when it is
//! about to expire (under a row lock, since the vendor rotates the refresh
//! token on every refresh), and stamps it as a bearer on a request that may
//! only go to the app's API origin.

pub(crate) mod app;
pub(crate) mod cipher;
pub(crate) mod oauth;
pub(crate) mod pending;
pub(crate) mod repo;
pub(crate) mod source;

use zeroize::Zeroizing;

/// Macro's registered OAuth client at Autodesk, and where its grants are
/// encrypted. Without one, the native API source is not composed and
/// Autodesk is not connectable.
pub struct AutodeskConfig {
    /// The APS app's client id.
    pub client_id: String,
    /// The APS app's client secret.
    pub client_secret: Zeroizing<String>,
    /// The callback URL registered with the APS app: the cognition public
    /// origin plus [`crate::inbound::callbacks::APP_OAUTH_CALLBACK_PATH`].
    pub redirect_uri: url::Url,
    /// The KMS client grants are envelope-encrypted with.
    pub kms: aws_sdk_kms::Client,
    /// The KMS key (id, ARN or alias) that wraps each grant's data key.
    pub kms_key_id: String,
}

impl std::fmt::Debug for AutodeskConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AutodeskConfig")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<redacted>")
            .field("redirect_uri", &self.redirect_uri.as_str())
            .field("kms_key_id", &self.kms_key_id)
            .finish_non_exhaustive()
    }
}
