//! Resolving the Cursor API key a session runs on.
//!
//! A `@cursor` session runs on its owner's own Cursor account, so the key is
//! a per-user secret read at spawn and at every resume — not a deployment-wide
//! value the composition root holds. That is what makes this a port rather
//! than a config field: the manager needs a key *for a user*, and the answer
//! involves a database row and a KMS call.
//!
//! "This user has no key" is not an infrastructure failure, and the manager
//! must not report it as one: it is the ordinary state of anyone who has not
//! visited settings yet, and it has to reach the channel as that sentence.

use cursor_api_key::cipher::{CursorApiKey, CursorApiKeyCipher};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::error::{HarnessError, Result};

/// A user's resolved Cursor configuration: the decrypted key their sessions
/// run on, and the model those sessions start on.
pub struct ResolvedCursorConfig {
    /// The decrypted key.
    pub key: CursorApiKey,
    /// The Cursor model id the user chose for their sessions, or `None` to
    /// leave the choice to the deployment default and then Cursor's own.
    pub default_model_id: Option<String>,
}

/// Resolves a user's Cursor configuration.
pub trait CursorApiKeys: Send + Sync + 'static {
    /// The configuration `owner` registered.
    ///
    /// # Errors
    /// [`HarnessError::CursorNotConnected`] when the user has registered no
    /// key, and [`HarnessError::Container`] when the row exists but cannot be
    /// read or decrypted.
    fn resolve(
        &self,
        owner: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<ResolvedCursorConfig>> + Send;
}

/// Reads keys from `cursor_configs`, decrypting through `cipher`.
#[derive(Clone)]
pub struct PgCursorApiKeys<Cipher> {
    pool: PgPool,
    cipher: Cipher,
}

impl<Cipher> PgCursorApiKeys<Cipher> {
    /// Read keys from `pool` and decrypt them with `cipher`.
    pub fn new(pool: PgPool, cipher: Cipher) -> Self {
        Self { pool, cipher }
    }
}

impl<Cipher> CursorApiKeys for PgCursorApiKeys<Cipher>
where
    Cipher: CursorApiKeyCipher + Clone + 'static,
{
    async fn resolve(&self, owner: &MacroUserIdStr<'_>) -> Result<ResolvedCursorConfig> {
        let owner = owner.as_ref();
        let stored = cursor_api_key::store::get_cursor_api_key(&self.pool, owner)
            .await
            .map_err(|error| {
                HarnessError::Container(format!("could not read a cursor config: {error}"))
            })?
            .ok_or(HarnessError::CursorNotConnected)?;
        // The decrypt error stays opaque on the way out. It can mean the row
        // was written under another user's encryption context, and a caller
        // that could tell that apart from "KMS is down" could probe for it.
        let key = self
            .cipher
            .decrypt(owner, &stored.encrypted)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "could not decrypt a cursor api key");
                HarnessError::Container("could not decrypt the cursor api key".to_owned())
            })?;
        Ok(ResolvedCursorConfig {
            key,
            default_model_id: stored.default_model_id,
        })
    }
}
