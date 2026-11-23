//! Messages on the CRM population queue (`macro_queues::EmailCrmPopulationQueue`).
//!
//! The queue is FIFO and each message's group is its mailbox, so a mailbox
//! runs one population at a time.

use super::backfill::{PopulateCrmContactPayload, PopulateCrmPolicyPayload};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One unit of CRM population work for one mailbox.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum CrmPopulationMessage {
    /// Reconcile one correspondent of one mailbox with its stored mail.
    Contact(CrmPopulationContact),
    /// One page of a consented mailbox's durable email history.
    PolicyPage(PopulateCrmPolicyPayload),
}

impl CrmPopulationMessage {
    /// The mailbox the work belongs to, which is also its message group.
    pub fn link_id(&self) -> Uuid {
        match self {
            CrmPopulationMessage::Contact(contact) => contact.link_id,
            CrmPopulationMessage::PolicyPage(page) => page.link_id,
        }
    }
}

/// A correspondent to reconcile, and the claim it was queued under.
///
/// Producers that find a queued message for the same correspondent merge
/// their hints into the pending entry instead of sending another. `contact`
/// holds this message's own hints, used when the pending entry is gone.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrmPopulationContact {
    pub link_id: Uuid,
    pub claim: Uuid,
    pub contact: PopulateCrmContactPayload,
}
