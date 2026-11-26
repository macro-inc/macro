//! Shared resource accounting for live email-rule discovery and admission.
//!
//! A successful discovery is complete. A limit failure must discard its result;
//! callers must not return a partial email page or advance its cursor.

use std::{
    fmt,
    time::{Duration, Instant},
};

#[cfg(test)]
mod test;

mod core;
mod ports;
pub use core::discover;
pub use ports::*;

// The measured small-scope boundary, shared with the scoped input query.
pub(crate) const SMALL_CONTRIBUTORS: usize = 8;

/// One independently bounded part of selected contribution discovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailRuleWorkLimit {
    /// Contributing mailboxes, including members whose policies are empty.
    Contributors,
    /// Stored or proposed selectors before deduplication.
    RuleReferences,
    /// Address rows read from distinct live contact sources.
    SourceAddresses,
    /// Domain rows read from distinct live company sources.
    SourceDomains,
    /// The largest live value, checked before normalization or decoding.
    SourceValueBytes,
    /// Accounted literal and live source text, using the larger stored/normalized size.
    SourceBytes,
    /// Exact address/mailbox lookup attempts.
    DirectPairs,
    /// Mailbox contact rows read, including nonmatches.
    MailboxContacts,
    /// Stored mailbox contact text read, including nonmatches.
    ContactBytes,
    /// Conservative count of domain suffix comparisons.
    SuffixChecks,
    /// Checks of a contributor's membership in a source's authorized set.
    MembershipChecks,
    /// The deadline shared by all stages of the enclosing request.
    RequestDeadline,
}

impl EmailRuleWorkLimit {
    /// Stable name for an error or span; never contains a private rule value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Contributors => "contributors",
            Self::RuleReferences => "rule_references",
            Self::SourceAddresses => "source_addresses",
            Self::SourceDomains => "source_domains",
            Self::SourceValueBytes => "source_value_bytes",
            Self::SourceBytes => "source_bytes",
            Self::DirectPairs => "direct_pairs",
            Self::MailboxContacts => "mailbox_contacts",
            Self::ContactBytes => "contact_bytes",
            Self::SuffixChecks => "suffix_checks",
            Self::MembershipChecks => "membership_checks",
            Self::RequestDeadline => "request_deadline_ms",
        }
    }

    /// Request-wide ceiling used by both authoring and reads.
    pub const fn maximum(self) -> u64 {
        match self {
            Self::Contributors => 1_000,
            Self::RuleReferences
            | Self::SourceAddresses
            | Self::SourceDomains
            | Self::DirectPairs => 50_000,
            Self::SourceValueBytes => 4_096,
            Self::SourceBytes => 8 * 1024 * 1024,
            Self::MailboxContacts | Self::MembershipChecks => 250_000,
            Self::ContactBytes => 32 * 1024 * 1024,
            Self::SuffixChecks => 750_000,
            Self::RequestDeadline => 10_000,
        }
    }
}

impl fmt::Display for EmailRuleWorkLimit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A complete result could not be established within a named resource limit.
/// Public error messages expose the name and maximum, not another member's usage.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("email sharing rules exceed the {limit} limit ({maximum})")]
pub struct EmailRuleLimitExceeded {
    /// The resource that prevented completion.
    pub limit: EmailRuleWorkLimit,
    /// Its configured ceiling.
    pub maximum: u64,
    /// Internal telemetry only; do not include in owner-facing aggregate errors.
    pub observed: u64,
}

/// Consumed work, retained across discovery stages and reuse by the reader.
#[derive(Debug, Clone, Default)]
pub struct EmailRuleDiscoveryWork {
    /// Contributor inputs, including empty policies.
    pub contributors: u64,
    /// Raw inclusion selectors.
    pub rule_references: u64,
    /// Raw contact address rows.
    pub source_addresses: u64,
    /// Raw company domain rows.
    pub source_domains: u64,
    /// Largest live value seen, rather than a cumulative sum.
    pub source_value_bytes: u64,
    /// Accounted literal/live text.
    pub source_bytes: u64,
    /// Exact address/mailbox pairs probed.
    pub direct_pairs: u64,
    /// Raw mailbox contact rows.
    pub mailbox_contacts: u64,
    /// Raw mailbox contact text.
    pub contact_bytes: u64,
    /// Conservative count of domain suffix comparisons.
    pub suffix_checks: u64,
    /// Source membership checks.
    pub membership_checks: u64,
}

/// One budget for the complete discovery; never recreate it between stages.
pub struct EmailRuleDiscoveryBudget {
    deadline: Instant,
    work: EmailRuleDiscoveryWork,
}

impl EmailRuleDiscoveryBudget {
    /// Share the caller's deadline rather than extending it at each query.
    pub fn new(deadline: Instant) -> Self {
        Self {
            deadline: deadline.min(
                Instant::now()
                    + Duration::from_millis(EmailRuleWorkLimit::RequestDeadline.maximum()),
            ),
            work: EmailRuleDiscoveryWork::default(),
        }
    }

    /// Unconsumed data work; fetch at most one additional sentinel row.
    pub fn remaining(&self, limit: EmailRuleWorkLimit) -> u64 {
        let used = match limit {
            EmailRuleWorkLimit::Contributors => self.work.contributors,
            EmailRuleWorkLimit::RuleReferences => self.work.rule_references,
            EmailRuleWorkLimit::SourceAddresses => self.work.source_addresses,
            EmailRuleWorkLimit::SourceDomains => self.work.source_domains,
            EmailRuleWorkLimit::SourceValueBytes => self.work.source_value_bytes,
            EmailRuleWorkLimit::SourceBytes => self.work.source_bytes,
            EmailRuleWorkLimit::DirectPairs => self.work.direct_pairs,
            EmailRuleWorkLimit::MailboxContacts => self.work.mailbox_contacts,
            EmailRuleWorkLimit::ContactBytes => self.work.contact_bytes,
            EmailRuleWorkLimit::SuffixChecks => self.work.suffix_checks,
            EmailRuleWorkLimit::MembershipChecks => self.work.membership_checks,
            EmailRuleWorkLimit::RequestDeadline => {
                return self
                    .deadline
                    .saturating_duration_since(Instant::now())
                    .as_millis() as u64;
            }
        };
        limit.maximum().saturating_sub(used)
    }

    /// Work already consumed, including the row or value that crossed a limit.
    pub fn work(&self) -> &EmailRuleDiscoveryWork {
        &self.work
    }

    /// The deadline database operations must continue to enforce.
    pub fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Refuse further work after the enclosing request's deadline.
    pub fn check_deadline(&self) -> Result<(), EmailRuleLimitExceeded> {
        if Instant::now() >= self.deadline {
            let limit = EmailRuleWorkLimit::RequestDeadline;
            return Err(EmailRuleLimitExceeded {
                limit,
                maximum: limit.maximum(),
                observed: limit.maximum(),
            });
        }
        Ok(())
    }

    /// Account before filtering or deduplication. A live-value charge records
    /// its maximum; every other data charge accumulates across all stages.
    pub fn charge(
        &mut self,
        limit: EmailRuleWorkLimit,
        amount: u64,
    ) -> Result<(), EmailRuleLimitExceeded> {
        self.check_deadline()?;
        let counter = match limit {
            EmailRuleWorkLimit::Contributors => &mut self.work.contributors,
            EmailRuleWorkLimit::RuleReferences => &mut self.work.rule_references,
            EmailRuleWorkLimit::SourceAddresses => &mut self.work.source_addresses,
            EmailRuleWorkLimit::SourceDomains => &mut self.work.source_domains,
            EmailRuleWorkLimit::SourceValueBytes => &mut self.work.source_value_bytes,
            EmailRuleWorkLimit::SourceBytes => &mut self.work.source_bytes,
            EmailRuleWorkLimit::DirectPairs => &mut self.work.direct_pairs,
            EmailRuleWorkLimit::MailboxContacts => &mut self.work.mailbox_contacts,
            EmailRuleWorkLimit::ContactBytes => &mut self.work.contact_bytes,
            EmailRuleWorkLimit::SuffixChecks => &mut self.work.suffix_checks,
            EmailRuleWorkLimit::MembershipChecks => &mut self.work.membership_checks,
            EmailRuleWorkLimit::RequestDeadline => return self.check_deadline(),
        };
        *counter = if limit == EmailRuleWorkLimit::SourceValueBytes {
            (*counter).max(amount)
        } else {
            counter.saturating_add(amount)
        };
        if *counter > limit.maximum() {
            return Err(EmailRuleLimitExceeded {
                limit,
                maximum: limit.maximum(),
                observed: *counter,
            });
        }
        Ok(())
    }
}
