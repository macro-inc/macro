//! LID ↔ phone number mappings.
//!
//! whatsmeow keeps one mapping table shared by every device; here each
//! account has its own, since accounts belong to different people. Which LID
//! belongs to which phone number is personal data (it de-pseudonymizes a
//! LID), so each direction is a sealed value: `lid_by_pn` keyed by the phone
//! number user, `pn_by_lid` keyed by the LID user. The users themselves are
//! plaintext keys, as JIDs are everywhere else in the store.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use sqlx::PgConnection;
use whatsmeow::store::{LidMapping, LidStore, StoreError};
use whatsmeow::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid};

use super::PgWhatsAppStore;
use crate::cipher::StoreName;
use crate::error::WhatsAppStoreError;

fn user_jid(user: Vec<u8>, device: u16, server: &str) -> Result<Jid, WhatsAppStoreError> {
    Ok(Jid {
        user: String::from_utf8(user).map_err(|_| WhatsAppStoreError::Malformed)?,
        device,
        server: server.to_owned(),
        ..Jid::default()
    })
}

fn is_valid_mapping(lid: &Jid, pn: &Jid) -> bool {
    lid.server == HIDDEN_USER_SERVER && pn.server == DEFAULT_USER_SERVER
}

impl PgWhatsAppStore {
    /// The JID followed by its other identity (LID or phone number) when one
    /// is known, for lookups that accept either.
    pub(super) async fn with_alternate(&self, jid: Jid) -> Result<Vec<Jid>, WhatsAppStoreError> {
        let alternate = match jid.server.as_str() {
            DEFAULT_USER_SERVER => {
                self.lookup(&jid, StoreName::LidByPn, HIDDEN_USER_SERVER)
                    .await?
            }
            HIDDEN_USER_SERVER => {
                self.lookup(&jid, StoreName::PnByLid, DEFAULT_USER_SERVER)
                    .await?
            }
            _ => None,
        };
        Ok(std::iter::once(jid).chain(alternate).collect())
    }

    async fn lookup(
        &self,
        source: &Jid,
        store: StoreName,
        target_server: &str,
    ) -> Result<Option<Jid>, WhatsAppStoreError> {
        self.get_value(&self.pool, store, &source.user)
            .await?
            .map(|user| user_jid(user, source.device, target_server))
            .transpose()
    }

    /// Applies mappings in order, each replacing any older mapping of either
    /// side, as whatsmeow's `PutLIDMapping` does. Reads both directions of
    /// every user in one query each, then writes and deletes in one each.
    async fn put_mappings(
        &self,
        connection: &mut PgConnection,
        mappings: &[&LidMapping],
    ) -> Result<(), WhatsAppStoreError> {
        let pns: Vec<String> = mappings
            .iter()
            .map(|mapping| mapping.pn.user.clone())
            .collect();
        let lids: Vec<String> = mappings
            .iter()
            .map(|mapping| mapping.lid.user.clone())
            .collect();
        // `None` marks a mapping deleted in this batch.
        let mut lid_by_pn: HashMap<String, Option<String>> = HashMap::new();
        let mut pn_by_lid: HashMap<String, Option<String>> = HashMap::new();
        for (pn, lid) in self
            .get_values(&mut *connection, StoreName::LidByPn, &pns)
            .await?
        {
            lid_by_pn.insert(
                pn,
                Some(String::from_utf8(lid).map_err(|_| WhatsAppStoreError::Malformed)?),
            );
        }
        for (lid, pn) in self
            .get_values(&mut *connection, StoreName::PnByLid, &lids)
            .await?
        {
            pn_by_lid.insert(
                lid,
                Some(String::from_utf8(pn).map_err(|_| WhatsAppStoreError::Malformed)?),
            );
        }

        for mapping in mappings {
            let (lid, pn) = (&mapping.lid.user, &mapping.pn.user);
            let old_lid = lid_by_pn.insert(pn.clone(), Some(lid.clone())).flatten();
            let old_pn = pn_by_lid.insert(lid.clone(), Some(pn.clone())).flatten();
            if let Some(old_lid) = old_lid
                && old_lid != *lid
            {
                pn_by_lid.insert(old_lid, None);
            }
            if let Some(old_pn) = old_pn
                && old_pn != *pn
            {
                lid_by_pn.insert(old_pn, None);
            }
        }

        for (store, entries) in [
            (StoreName::LidByPn, lid_by_pn),
            (StoreName::PnByLid, pn_by_lid),
        ] {
            let mut puts = BTreeMap::new();
            let mut deletes = Vec::new();
            for (key, value) in entries {
                match value {
                    Some(value) => {
                        puts.insert(key, value.into_bytes());
                    }
                    None => deletes.push(key),
                }
            }
            self.delete_values(connection, store, &deletes).await?;
            self.put_values(connection, store, puts).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl LidStore for PgWhatsAppStore {
    async fn put_many_lid_mappings(&self, mappings: &[LidMapping]) -> Result<(), StoreError> {
        // Invalid entries are skipped, as whatsmeow skips them.
        let valid: Vec<&LidMapping> = mappings
            .iter()
            .filter(|mapping| is_valid_mapping(&mapping.lid, &mapping.pn))
            .collect();
        if valid.is_empty() {
            return Ok(());
        }
        let mut transaction = self.begin_write().await?;
        self.lock_device(&mut transaction).await?;
        self.put_mappings(&mut transaction, &valid).await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn put_lid_mapping(&self, lid: &Jid, jid: &Jid) -> Result<(), StoreError> {
        if !is_valid_mapping(lid, jid) {
            return Err(StoreError::InvalidArgument(
                "invalid PutLIDMapping call: expected a LID and a phone number JID".to_owned(),
            ));
        }
        let mapping = LidMapping {
            lid: lid.clone(),
            pn: jid.clone(),
        };
        let mut transaction = self.begin_write().await?;
        self.lock_device(&mut transaction).await?;
        self.put_mappings(&mut transaction, &[&mapping]).await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn get_pn_for_lid(&self, lid: &Jid) -> Result<Option<Jid>, StoreError> {
        if lid.server != HIDDEN_USER_SERVER {
            return Err(StoreError::InvalidArgument(
                "invalid GetPNForLID call with non-LID JID".to_owned(),
            ));
        }
        Ok(self
            .lookup(lid, StoreName::PnByLid, DEFAULT_USER_SERVER)
            .await?)
    }

    async fn get_lid_for_pn(&self, pn: &Jid) -> Result<Option<Jid>, StoreError> {
        if pn.server != DEFAULT_USER_SERVER {
            return Err(StoreError::InvalidArgument(
                "invalid GetLIDForPN call with non-PN JID".to_owned(),
            ));
        }
        Ok(self
            .lookup(pn, StoreName::LidByPn, HIDDEN_USER_SERVER)
            .await?)
    }

    async fn get_many_lids_for_pns(&self, pns: &[Jid]) -> Result<HashMap<Jid, Jid>, StoreError> {
        let pns: Vec<&Jid> = pns
            .iter()
            .filter(|pn| pn.server == DEFAULT_USER_SERVER)
            .collect();
        let users: Vec<String> = pns.iter().map(|pn| pn.user.clone()).collect();
        let lids = self
            .get_values(&self.pool, StoreName::LidByPn, &users)
            .await?;
        Ok(pns
            .into_iter()
            .filter_map(|pn| {
                let lid = lids.get(&pn.user)?;
                Some(
                    user_jid(lid.clone(), pn.device, HIDDEN_USER_SERVER)
                        .map(|lid| (pn.clone(), lid)),
                )
            })
            .collect::<Result<_, WhatsAppStoreError>>()?)
    }
}
