// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow cstoken.go (MPL-2.0, Copyright (c) Tulir Asokan)

//! Contact-scoped tokens (`cstoken`), sent instead of a privacy token when
//! there is none.

use std::sync::Arc;

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::client::Client;
use crate::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, PSA_JID};

/// Whether messages to the JID carry a cstoken.
pub(crate) fn should_send_cs_token(jid: &Jid) -> bool {
    let jid = jid.to_non_ad();
    (jid.server == DEFAULT_USER_SERVER || jid.server == HIDDEN_USER_SERVER)
        && jid.user != PSA_JID.user
        && !jid.is_bot()
}

/// HMAC-SHA256 of the recipient LID string keyed with the salt.
pub fn cs_token_for(salt: &[u8], recipient_lid: &Jid) -> Vec<u8> {
    // HMAC accepts keys of any length.
    let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(salt) else {
        return Vec::new();
    };
    mac.update(recipient_lid.to_string().as_bytes());
    mac.finalize().into_bytes().to_vec()
}

impl Client {
    /// The cstoken for a recipient, derived from the NCT salt and their LID;
    /// `None` when there is no salt or LID.
    pub(crate) async fn generate_cs_token(&self, jid: &Jid) -> Option<Vec<u8>> {
        if !should_send_cs_token(jid) {
            return None;
        }
        let (nct_salt, lids) = {
            let store = self.store.read().await;
            (Arc::clone(&store.nct_salt), Arc::clone(&store.lids))
        };
        let salt = match nct_salt.get_nct_salt().await {
            Err(error) => {
                tracing::debug!(error = %error, "failed to load NCT salt for cstoken");
                return None;
            }
            Ok(salt) => salt.filter(|salt| !salt.is_empty())?,
        };
        let recipient_lid = match jid.server.as_str() {
            HIDDEN_USER_SERVER => jid.to_non_ad(),
            DEFAULT_USER_SERVER => match lids.get_lid_for_pn(&jid.to_non_ad()).await {
                Err(error) => {
                    tracing::debug!(error = %error, "failed to resolve LID for cstoken");
                    return None;
                }
                Ok(lid) => lid.filter(|lid| !lid.is_empty())?.to_non_ad(),
            },
            _ => return None,
        };
        if recipient_lid.server != HIDDEN_USER_SERVER {
            return None;
        }
        Some(cs_token_for(&salt, &recipient_lid))
    }
}
