//! The encryption context of an account's KMS-wrapped data key
//! ([`kms_envelope`]).
//!
//! KMS is called once per account to generate the data key and once each
//! time a replica takes the account's lease; everything else is local
//! AES-GCM under that key (see [`crate::cipher`]). The wrapped key is bound
//! by its encryption context to one user and one account, and KMS enforces
//! it: a `whatsapp_device` row copied to another account does not unwrap. The
//! KMS key must be WhatsApp's own: whatever can unwrap WhatsApp data keys can
//! read every linked account's sessions.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use uuid::Uuid;

use crate::cipher::ENCRYPTION_VERSION;

/// Names the purpose in the encryption context, so a data key from another
/// feature cannot be unwrapped as a WhatsApp one even under the same KMS key.
const ENCRYPTION_PURPOSE: &str = "whatsapp-session";

/// The encryption context of an account's data key.
pub(crate) fn encryption_context(user_id: &str, account_id: Uuid) -> HashMap<String, String> {
    kms_envelope::kms::encryption_context(
        ENCRYPTION_PURPOSE,
        ENCRYPTION_VERSION,
        &[
            ("user-id", user_id),
            ("account-id", &account_id.to_string()),
        ],
    )
}
