//! Discovery facts and the injected, transaction-preserving boundary.
use super::{
    super::{email_rules::EmailInclusionRule, model::CrmError},
    EmailRuleDiscoveryWork,
};
use std::{fmt::Debug, time::Instant};
use uuid::Uuid;

/// Replacement evaluated without storing a revision or granting contribution.
#[derive(Debug, Clone)]
pub struct ProposedEmailRules {
    /// Authenticated member, never taken from a command body.
    pub user_id: String,
    /// Exact primary mailbox authorized for that member.
    pub link_id: Uuid,
    /// Canonical selectors, replacing the member's current definition.
    pub rules: Vec<EmailInclusionRule>,
}

/// Read one page's contributors, or admit a replacement against the whole team.
#[derive(Debug, Clone)]
pub struct EmailRuleDiscoveryRequest {
    /// Already authorized CRM team.
    pub team_id: Uuid,
    /// Selected mailbox subset from the reader's snapshot; None means the team.
    pub links: Option<Vec<Uuid>>,
    /// Only authoring sets this, after target authorization and canonicalization.
    pub proposed: Option<ProposedEmailRules>,
}

/// Complete contact discovery. Partial collections are never returned on error.
#[derive(Debug, Clone)]
pub struct EmailRuleDiscovery {
    /// Distinct mailbox/contact pairs. Whole threads are resolved by the reader.
    pub contacts: Vec<(Uuid, Uuid)>,
    /// Numeric work only, suitable for telemetry without rule contents.
    pub work: EmailRuleDiscoveryWork,
    /// Algorithm chosen from contributor/rule counts before live expansion.
    pub small_input: bool,
}

/// The owning domain executes against a caller-supplied transaction context.
/// Composition supplies the adapter; consumers do not construct CRM storage.
#[async_trait::async_trait]
pub trait EmailRuleDiscoveryService<C: Send>: Debug + Send + Sync {
    /// Enforce one deadline and return all matches, or a typed limit error.
    async fn discover(
        &self,
        context: &mut C,
        request: EmailRuleDiscoveryRequest,
        deadline: Instant,
    ) -> Result<EmailRuleDiscovery, CrmError>;
}

/// Authorized, active selected contributor facts, including empty definitions.
#[derive(Debug, Clone)]
pub struct RuleContributor {
    /// Mailbox-local scope of every match.
    pub link_id: Uuid,
    /// Owner of the consent and rule revision.
    pub user_id: String,
    /// Current role permits hidden CRM sources.
    pub sees_hidden: bool,
    /// None only for a proposed first policy.
    pub revision: Option<i64>,
}

/// A stored selector joined to its exact contributor.
#[derive(Debug, Clone)]
pub struct ContributorRule {
    /// Mailbox owning the selector.
    pub link_id: Uuid,
    /// One of the five canonical selector kinds.
    pub rule: EmailInclusionRule,
}

/// Bounded input headers and raw stored selectors, before live expansion.
#[derive(Debug, Clone)]
pub struct RuleInputs {
    /// Active contributors, including empty and proposed policies.
    pub contributors: Vec<RuleContributor>,
    /// Stored selectors; excludes the proposed owner's previous policy.
    pub rules: Vec<ContributorRule>,
}

/// Target-specific live source; identities from different tables never alias.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RuleSource {
    /// All current addresses of a visible contact.
    Contact(Uuid),
    /// Current domains only, not company contacts.
    Company(Uuid),
}

/// Visibility facts; domain code intersects these with each contributor's role.
#[derive(Debug, Clone)]
pub struct RuleSourceFacts {
    /// Requested target identity.
    pub source: RuleSource,
    /// Both the target and any parent belong to the requested team.
    pub in_team: bool,
    /// The target or its parent is hidden.
    pub hidden: bool,
}

/// A bounded live row. Oversized text is withheld by storage before decoding.
#[derive(Debug, Clone)]
pub struct RuleSourceValue {
    /// Stored key for keyset continuation; absent at a byte limit.
    pub key: Option<String>,
    /// Exact contact address or database-normalized company domain.
    pub value: Option<String>,
    /// Larger stored/normalized byte length, before visibility filtering.
    pub bytes: u64,
    /// False for a malformed company-domain row belonging to another team.
    pub in_team: bool,
}

/// One source's first bounded page, including sources with no current values.
#[derive(Debug, Clone)]
pub struct RuleSourcePage {
    /// Requested target identity.
    pub source: RuleSource,
    /// Raw ordered rows, before contributor visibility or deduplication.
    pub values: Vec<RuleSourceValue>,
}

/// One mailbox contact, with normalization performed using database semantics.
#[derive(Debug, Clone)]
pub struct RuleMailboxContact {
    /// Contact ID, not a CRM contact ID.
    pub id: Uuid,
    /// Stored unique mailbox/address key; absent when the byte limit is hit.
    pub key: Option<String>,
    /// Lowercased address; absent after the byte limit.
    pub address: Option<String>,
    /// Lowercased second @-separated component, matching the SQL readers.
    pub domain: Option<String>,
    /// Stored address length, before normalization.
    pub bytes: u64,
}

/// Result of an indexed exact-address batch.
#[derive(Debug, Clone)]
pub struct RuleDirectContact {
    /// Mailbox matched by the lookup.
    pub link_id: Uuid,
    /// All contact identities survive normalization collisions.
    pub id: Uuid,
    /// Stored text length for request-wide accounting.
    pub bytes: u64,
}

/// Small-input matching remains in the database, returning counts and IDs only.
#[derive(Debug, Clone)]
pub struct RuleSmallMatches {
    /// Every inspected mailbox contact, including nonmatches.
    pub rows: u64,
    /// Stored address bytes, including nonmatches.
    pub bytes: u64,
    /// Upper bound on suffix comparisons across all inspected contacts.
    pub suffix_checks: u64,
    /// Matching contact identities; discarded if any counter exceeds its cap.
    pub ids: Vec<Uuid>,
}

/// Factual operations used by the shared domain algorithm. Implementations must
/// apply the same deadline to every operation and respect row/byte sentinels.
pub trait EmailRuleDiscoveryReader: Send {
    /// Independently cap contributors and raw selectors; preserve empty policies.
    /// A proposed owner replaces itself and contributes no stored selectors.
    fn inputs(
        &mut self,
        request: &EmailRuleDiscoveryRequest,
        contributor_limit: usize,
        rule_limit: usize,
    ) -> impl Future<Output = Result<RuleInputs, CrmError>> + Send;
    /// Primary-key facts for distinct targets, not expanded source rows.
    fn source_facts(
        &mut self,
        team: Uuid,
        sources: &[RuleSource],
    ) -> impl Future<Output = Result<Vec<RuleSourceFacts>, CrmError>> + Send;
    /// Indexed ordered continuation, with oversized values withheld.
    fn source_values(
        &mut self,
        team: Uuid,
        source: RuleSource,
        after: Option<&str>,
        limit: usize,
        bytes: u64,
    ) -> impl Future<Output = Result<Vec<RuleSourceValue>, CrmError>> + Send;
    /// Batch first pages for many distinct targets. The caller bounds both the
    /// number of sources and their combined worst-case row count. Return an
    /// empty page for an empty source; full pages continue through source_values.
    fn source_first_pages(
        &mut self,
        team: Uuid,
        sources: &[RuleSource],
        limit_per_source: usize,
        bytes: u64,
    ) -> impl Future<Output = Result<Vec<RuleSourcePage>, CrmError>> + Send;
    /// Indexed exact address pairs; row sentinel applies globally and per pair.
    fn direct_contacts(
        &mut self,
        pairs: &[(Uuid, &str)],
        limit: usize,
    ) -> impl Future<Output = Result<Vec<RuleDirectContact>, CrmError>> + Send;
    /// One mailbox's existing unique address index, with byte guards.
    fn mailbox_contacts(
        &mut self,
        link: Uuid,
        after: Option<&str>,
        limit: usize,
        bytes: u64,
    ) -> impl Future<Output = Result<Vec<RuleMailboxContact>, CrmError>> + Send;
    /// Bounded scan with hashed address/suffix membership for small inputs.
    /// Guard matching with the remaining suffix allowance; return raw totals
    /// so the domain rejects the whole result when an allowance is exceeded.
    fn small_matches(
        &mut self,
        link: Uuid,
        addresses: &[String],
        domains: &[String],
        limit: usize,
        bytes: u64,
        suffix_checks: u64,
    ) -> impl Future<Output = Result<RuleSmallMatches, CrmError>> + Send;
}
