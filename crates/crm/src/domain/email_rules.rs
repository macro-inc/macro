//! Dormant policy definitions for a member's selected email contribution.
//!
//! Parsing or checking these definitions does not grant mailbox access. The
//! activation service must authorize the exact mailbox and every referenced
//! record, validate/normalize addresses and domains, and persist a revision
//! under the privacy lock before any definition can become active.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Remote rollout key; missing/failed evaluations must refuse new activations.
/// Existing stored policies remain enforced independently of this flag.
pub const SELECTIVE_EMAIL_CONTRIBUTION_FLAG: &str = "enable-crm-selective-email-contribution";
/// Supported rule format, distinct from the member's policy revision.
pub const EMAIL_RULE_SCHEMA_VERSION: u16 = 1;
/// Maximum authoring selectors, checked before resolving live references.
pub const MAX_EMAIL_INCLUSION_RULES: usize = 500;
/// Maximum canonical stored JSON size, including structural separator spaces.
pub const MAX_EMAIL_RULE_BYTES: usize = 65_536;

/// The scope of an explicitly granted mailbox contribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmailContributionMode {
    /// Every eligible thread, subject to the existing exclusions.
    All,
    /// Only threads matching the member's live inclusion rules.
    Selected,
}

/// One positive whole-thread selector; denials always take precedence.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EmailInclusionRule {
    /// A mailbox-local thread owned by the contributor.
    Thread {
        /// Internal thread ID, never a provider thread ID.
        thread_id: Uuid,
    },
    /// An exact sender or recipient address, without alias inference.
    Address {
        /// Address to normalize and validate before activation.
        address: String,
    },
    /// All current addresses of an authorized contact in the same team.
    Contact {
        /// Stable contact ID, resolved live rather than expanded on activation.
        contact_id: Uuid,
    },
    /// A domain and its dot-boundary subdomains.
    Domain {
        /// Bare domain to normalize and validate before activation.
        domain: String,
    },
    /// All current domains of an authorized company in the same team.
    Company {
        /// Stable company ID, resolved live rather than expanded on activation.
        company_id: Uuid,
    },
}

/// A complete replacement definition; an empty list selects no mail.
/// Contact/company edits affect matching without rewriting this definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailRuleSet {
    /// Wire-format version, not a contribution grant or revision number.
    pub schema_version: u16,
    /// OR-combined positive selectors over all non-draft thread participants.
    pub include: Vec<EmailInclusionRule>,
}

/// A definition that cannot enter the bounded activation workflow.
#[derive(Debug, thiserror::Error)]
pub enum EmailRuleDefinitionError {
    /// The caller used a format this service does not understand.
    #[error("unsupported email rule schema version")]
    UnsupportedVersion,
    /// Too many authoring rules, even if some may later deduplicate.
    #[error("too many email inclusion rules")]
    TooManyRules,
    /// The serialized definition exceeds the storage/request budget.
    #[error("email rule definition is too large")]
    TooLarge,
    /// The definition could not be encoded for storage.
    #[error("could not encode email rule definition: {0}")]
    Encoding(#[from] serde_json::Error),
}

impl EmailRuleSet {
    /// Check format and resource bounds only, without resolving or authorizing
    /// references. Callers must still validate targets and canonicalize the
    /// definition, then repeat this check before persisting that canonical form.
    pub fn validate_shape(&self) -> Result<(), EmailRuleDefinitionError> {
        if self.schema_version != EMAIL_RULE_SCHEMA_VERSION {
            return Err(EmailRuleDefinitionError::UnsupportedVersion);
        }
        if self.include.len() > MAX_EMAIL_INCLUSION_RULES {
            return Err(EmailRuleDefinitionError::TooManyRules);
        }
        // Version 1 has two fields in the outer object and in every selector.
        // JSONB text adds one space after each object colon/comma and array
        // comma. Count those too, so a definition accepted here fits storage.
        // The database-backed boundary test checks this serialization contract.
        let selectors = self.include.len();
        let separator_spaces = 3 + 3 * selectors + selectors.saturating_sub(1);
        if serde_json::to_vec(self)?.len() + separator_spaces > MAX_EMAIL_RULE_BYTES {
            return Err(EmailRuleDefinitionError::TooLarge);
        }
        Ok(())
    }
}

/// Provenance established by authenticated credentials, never a request field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmailPolicyActorKind {
    /// The member's own interactive session.
    Member,
    /// A verified delegated agent acting for that member.
    Agent,
    /// A user-authorized API credential without verified agent attribution.
    Api,
    /// Mailbox lifecycle or live-target reconciliation.
    System,
}

/// Events in the member-only policy history; records never contain mail content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmailPolicyAuditAction {
    /// A member or agent replaced and activated the rule definition.
    RulesActivated,
    /// The member or their agent explicitly chose all-mail contribution.
    AllMailEnabled,
    /// Contribution was withdrawn, retaining CRM records and dates.
    Withdrawn,
    /// A mailbox lifecycle change revoked the exact-link grant.
    MailboxRevoked,
    /// A referenced contact/company changed the effective live selection.
    LiveTargetsChanged,
}
