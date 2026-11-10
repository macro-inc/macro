//! Signature selection, sanitization, and atomic settings-patch policy.

use email_api_client::domain::models::AccessToken;
use email_utils::sanitize_html_fragment;
use models_email::service::settings::{Settings, SettingsPatch};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Provider alias facts needed to choose an imported signature.
pub struct SignatureAlias {
    /// Address represented by the alias.
    pub email: String,
    /// Signature HTML, including a possible empty value.
    pub signature: Option<String>,
    /// Whether the provider marks this alias as primary.
    pub primary: bool,
}

/// Persists only the fields supplied in a settings patch.
pub trait SettingsWriter: Send + Sync + 'static {
    /// Original persistence failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Apply one settings patch and return the resulting settings.
    fn patch(
        &self,
        patch: SettingsPatch,
    ) -> impl Future<Output = Result<Settings, Self::Err>> + Send;
}

/// Rehosts publicly fetchable images using the existing shared image helper.
pub trait SignatureImages: Send + Sync + 'static {
    /// Failure whose Debug representation preserves the helper's original error.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Return rewritten HTML and the number of unresolved images.
    fn rehost(&self, html: &str)
    -> impl Future<Output = Result<(String, usize), Self::Err>> + Send;
}

/// Provider credentials and send-as alias reads used by signature import.
pub trait SignatureProvider: Send + Sync + 'static {
    /// Credential lookup failure.
    type TokenErr: std::error::Error + Send + Sync + 'static;
    /// Provider alias lookup failure.
    type ReadErr: std::error::Error + Send + Sync + 'static;
    /// Get a fresh credential for the selected inbox.
    fn fresh_token(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<AccessToken, Self::TokenErr>> + Send;
    /// Read aliases without imposing selection or fallback policy.
    fn aliases(
        &self,
        token: &AccessToken,
    ) -> impl Future<Output = Result<Vec<SignatureAlias>, Self::ReadErr>> + Send;
}

/// A settings patch was rejected before or during persistence.
#[derive(Debug, thiserror::Error)]
pub enum SettingsPatchError<E> {
    /// No settings fields were saved because some images remain unresolved.
    #[error("{0} signature image(s) could not be loaded")]
    UnresolvedImages(u32),
    /// The original settings write failed.
    #[error("Failed to update settings")]
    Database(#[source] E),
}

/// Signature import failed at a credential, provider, preparation, or storage step.
#[derive(Debug, thiserror::Error)]
pub enum SignatureImportError<W, T, P> {
    /// The preferred alias has no non-empty signature.
    #[error("No signature found in Gmail")]
    NoSignature,
    /// Fresh credentials could not be loaded.
    #[error("Failed to get Gmail access token")]
    Token(#[source] T),
    /// The provider's alias list could not be loaded.
    #[error("Failed to fetch Gmail signature")]
    Provider(#[source] P),
    /// No settings fields were saved because some images remain unresolved.
    #[error("{0} signature image(s) could not be loaded")]
    UnresolvedImages(u32),
    /// The original settings write failed.
    #[error("Failed to update settings")]
    Database(#[source] W),
}

/// Prepares signatures before persisting any field of a settings patch.
pub struct SignatureSettingsService<W, I, P> {
    /// Writes the final patch atomically.
    pub writer: W,
    /// Rehosts signature images.
    pub images: I,
    /// Fetches fresh provider credentials and alias facts.
    pub provider: P,
}

impl<W: SettingsWriter, I: SignatureImages, P> SignatureSettingsService<W, I, P> {
    /// Sanitize supplied HTML, preserve omitted fields, and reject unresolved images.
    pub async fn patch(
        &self,
        mut patch: SettingsPatch,
    ) -> Result<Settings, SettingsPatchError<W::Err>> {
        patch.signature = patch.signature.map(|html| sanitize_html_fragment(&html));
        if let Some(signature) = patch.signature.clone() {
            match self.images.rehost(&signature).await {
                Ok((rehosted, unresolved)) => {
                    if unresolved > 0 {
                        return Err(SettingsPatchError::UnresolvedImages(unresolved as u32));
                    }
                    patch.signature = Some(rehosted);
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "signature image rehost failed; persisting signature unchanged");
                }
            }
        }
        self.writer
            .patch(patch)
            .await
            .map_err(SettingsPatchError::Database)
    }
}

impl<W: SettingsWriter, I: SignatureImages, P: SignatureProvider>
    SignatureSettingsService<W, I, P>
{
    /// Prefer the inbox's address case-insensitively, then the first primary alias.
    pub async fn import(
        &self,
        link: Uuid,
        email: &str,
    ) -> Result<Settings, SignatureImportError<W::Err, P::TokenErr, P::ReadErr>> {
        let token = self
            .provider
            .fresh_token(link)
            .await
            .map_err(SignatureImportError::Token)?;
        let aliases = self
            .provider
            .aliases(&token)
            .await
            .map_err(SignatureImportError::Provider)?;
        let alias = aliases
            .iter()
            .find(|alias| alias.email.eq_ignore_ascii_case(email))
            .or_else(|| aliases.iter().find(|alias| alias.primary));
        let signature = alias
            .and_then(|alias| alias.signature.clone())
            .filter(|sig| !sig.trim().is_empty())
            .ok_or(SignatureImportError::NoSignature)?;
        let mut sanitized_signature = sanitize_html_fragment(&signature);
        match self.images.rehost(&sanitized_signature).await {
            Ok((rehosted, unresolved)) => {
                if unresolved > 0 {
                    return Err(SignatureImportError::UnresolvedImages(unresolved as u32));
                }
                sanitized_signature = rehosted;
            }
            Err(e) => {
                tracing::warn!(error = ?e, "signature image rehost failed; importing signature unchanged");
            }
        }
        self.writer
            .patch(SettingsPatch {
                link_id: link,
                signature: Some(sanitized_signature),
                signature_on_replies_forwards: None,
                read_receipts_enabled: None,
            })
            .await
            .map_err(SignatureImportError::Database)
    }
}
