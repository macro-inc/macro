//! Resolve each distinct live source once, preserving contributor visibility.
use super::*;
use crate::domain::{email_rules::EmailInclusionRule, model::CrmError};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    time::Instant,
};
use uuid::Uuid;

// Selected before any live expansion. The crossover is measured end to end.
const SMALL_RULES: usize = 4_000;
const SOURCE_BATCH: usize = 2_048;
const SOURCE_FIRST_ROWS: usize = 8;
const SOURCE_FIRST_SOURCES: usize = 128;
const SOURCE_BATCH_THRESHOLD: usize = 8;
const CONTACT_BATCH: usize = 8_192;
type Members = BTreeSet<Uuid>;
type Values = HashMap<String, Members>;

fn insert(map: &mut Values, value: String, link: Uuid) {
    map.entry(value).or_default().insert(link);
}

fn over(limit: EmailRuleWorkLimit) -> CrmError {
    EmailRuleLimitExceeded {
        limit,
        maximum: limit.maximum(),
        observed: limit.maximum() + 1,
    }
    .into()
}

/// Account a fetched page before another source can spend its remaining budget.
struct SourceValues {
    values: Vec<String>,
    after: Option<String>,
    count: usize,
}

impl SourceValues {
    fn account(
        rows: Vec<RuleSourceValue>,
        budget: &mut EmailRuleDiscoveryBudget,
        counter: EmailRuleWorkLimit,
    ) -> Result<Self, CrmError> {
        let mut page = Self {
            values: Vec::new(),
            after: None,
            count: rows.len(),
        };
        for row in rows {
            budget.charge(counter, 1)?;
            budget.charge(EmailRuleWorkLimit::SourceValueBytes, row.bytes)?;
            budget.charge(EmailRuleWorkLimit::SourceBytes, row.bytes)?;
            let value = row
                .value
                .ok_or_else(|| over(EmailRuleWorkLimit::SourceBytes))?;
            page.after = row.key;
            if row.in_team {
                page.values.push(value);
            }
        }
        Ok(page)
    }
}

/// Discover complete selected contacts using factual operations in one context.
/// Source sharing never lets one member use a target hidden from their role.
#[tracing::instrument(
    name = "crm.email_rules.discovery",
    skip_all,
    fields(
        contributors,
        rule_references,
        source_addresses,
        source_domains,
        source_bytes,
        source_value_bytes,
        mailbox_contacts,
        contact_bytes,
        direct_pairs,
        suffix_checks,
        membership_checks,
        small_input,
        contacts,
        limit_hit,
    ),
    err
)]
pub async fn discover<R: EmailRuleDiscoveryReader>(
    reader: &mut R,
    request: EmailRuleDiscoveryRequest,
    deadline: Instant,
) -> Result<EmailRuleDiscovery, CrmError> {
    let mut budget = EmailRuleDiscoveryBudget::new(deadline);
    let result = discover_inner(reader, request, &mut budget).await;
    let span = tracing::Span::current();
    let work = budget.work();
    span.record("contributors", work.contributors);
    span.record("rule_references", work.rule_references);
    span.record("source_addresses", work.source_addresses);
    span.record("source_domains", work.source_domains);
    span.record("source_bytes", work.source_bytes);
    span.record("source_value_bytes", work.source_value_bytes);
    span.record("mailbox_contacts", work.mailbox_contacts);
    span.record("contact_bytes", work.contact_bytes);
    span.record("direct_pairs", work.direct_pairs);
    span.record("suffix_checks", work.suffix_checks);
    span.record("membership_checks", work.membership_checks);
    if let Err(CrmError::EmailRuleLimitExceeded(error)) = &result {
        span.record("limit_hit", error.limit.as_str());
    }
    result
}

async fn discover_inner<R: EmailRuleDiscoveryReader>(
    reader: &mut R,
    request: EmailRuleDiscoveryRequest,
    budget: &mut EmailRuleDiscoveryBudget,
) -> Result<EmailRuleDiscovery, CrmError> {
    use EmailRuleWorkLimit as L;
    budget.check_deadline()?;
    // Refuse excessive caller input before sending an unbounded array to storage.
    if request
        .links
        .as_ref()
        .is_some_and(|links| links.len() > L::Contributors.maximum() as usize)
    {
        return Err(over(L::Contributors));
    }
    let RuleInputs {
        contributors,
        mut rules,
    } = reader
        .inputs(
            &request,
            L::Contributors.maximum() as usize + 1,
            L::RuleReferences.maximum() as usize + 1,
        )
        .await?;
    budget.charge(L::Contributors, contributors.len() as u64)?;
    if let Some(proposed) = &request.proposed {
        if !contributors
            .iter()
            .any(|c| c.link_id == proposed.link_id && c.user_id == proposed.user_id)
        {
            return Err(CrmError::EmailPolicyConflict);
        }
        rules.extend(proposed.rules.iter().cloned().map(|rule| ContributorRule {
            link_id: proposed.link_id,
            rule,
        }));
    }
    budget.charge(L::RuleReferences, rules.len() as u64)?;
    let small_input = contributors.len() <= SMALL_CONTRIBUTORS && rules.len() <= SMALL_RULES;
    tracing::Span::current().record("small_input", small_input);
    let roles: BTreeMap<_, _> = contributors
        .iter()
        .map(|c| (c.link_id, c.sees_hidden))
        .collect();
    let mut addresses = Values::new();
    let mut domains = Values::new();
    let mut references = BTreeMap::<RuleSource, Members>::new();
    for rule in rules {
        budget.check_deadline()?;
        match rule.rule {
            EmailInclusionRule::Address { address } => {
                budget.charge(L::SourceBytes, address.len() as u64)?;
                insert(&mut addresses, address, rule.link_id);
            }
            EmailInclusionRule::Domain { domain } => {
                budget.charge(L::SourceBytes, domain.len() as u64)?;
                insert(&mut domains, domain, rule.link_id);
            }
            EmailInclusionRule::Contact { contact_id } => {
                references
                    .entry(RuleSource::Contact(contact_id))
                    .or_default()
                    .insert(rule.link_id);
            }
            EmailInclusionRule::Company { company_id } => {
                references
                    .entry(RuleSource::Company(company_id))
                    .or_default()
                    .insert(rule.link_id);
            }
            EmailInclusionRule::Thread { .. } => {}
        }
    }
    let facts = reader
        .source_facts(
            request.team_id,
            &references.keys().copied().collect::<Vec<_>>(),
        )
        .await?;
    let mut visible = BTreeMap::new();
    for fact in facts {
        let Some(members) = references.get(&fact.source) else {
            continue;
        };
        let members: Members = members
            .iter()
            .copied()
            .filter(|link| fact.in_team && (!fact.hidden || roles.get(link) == Some(&true)))
            .collect();
        if !members.is_empty() {
            visible.insert(fact.source, members);
        }
    }
    // A handful of shared records keeps its existing large-page reads. Many
    // distinct records start with small pages in one indexed batch, so empty or
    // singleton records do not each require a separate database roundtrip.
    let batch_first_pages = visible.len() > SOURCE_BATCH_THRESHOLD;
    let mut pending = visible.into_iter().peekable();
    let mut live = BTreeMap::<RuleSource, (Members, Vec<String>)>::new();
    while let Some((source, members)) = pending.next() {
        budget.check_deadline()?;
        let counter = match source {
            RuleSource::Contact(_) => L::SourceAddresses,
            RuleSource::Company(_) => L::SourceDomains,
        };
        let mut sources = vec![(source, members)];
        let first_cap = SOURCE_FIRST_ROWS.min(budget.remaining(counter) as usize + 1);
        let mut first_pages = BTreeMap::new();
        if batch_first_pages {
            // Even full first pages can read at most the remaining allowance
            // plus one sentinel, across the entire batch rather than per source.
            let source_cap =
                SOURCE_FIRST_SOURCES.min((budget.remaining(counter) as usize + 1) / first_cap);
            while sources.len() < source_cap {
                let Some(next) = pending.next_if(|(next, _)| {
                    matches!(
                        (source, *next),
                        (RuleSource::Contact(_), RuleSource::Contact(_))
                            | (RuleSource::Company(_), RuleSource::Company(_))
                    )
                }) else {
                    break;
                };
                sources.push(next);
            }
            let pages = reader
                .source_first_pages(
                    request.team_id,
                    &sources
                        .iter()
                        .map(|(source, _)| *source)
                        .collect::<Vec<_>>(),
                    first_cap,
                    budget.remaining(L::SourceBytes),
                )
                .await?;
            // Charge all prefetched rows before continuing any full source.
            // Otherwise its continuation could spend the allowance already
            // consumed by the other first pages in this batch.
            for page in pages {
                first_pages.insert(
                    page.source,
                    SourceValues::account(page.values, budget, counter)?,
                );
            }
        }
        for (source, members) in sources {
            let first = first_pages.remove(&source);
            let complete = first.as_ref().is_some_and(|page| page.count < first_cap);
            let (mut values, mut after) = match first {
                Some(page) => (page.values, page.after),
                None => (Vec::new(), None),
            };
            if !complete {
                loop {
                    budget.check_deadline()?;
                    let cap = SOURCE_BATCH.min(budget.remaining(counter) as usize + 1);
                    let rows = reader
                        .source_values(
                            request.team_id,
                            source,
                            after.as_deref(),
                            cap,
                            budget.remaining(L::SourceBytes),
                        )
                        .await?;
                    let page = SourceValues::account(rows, budget, counter)?;
                    after = page.after;
                    values.extend(page.values);
                    if page.count < cap {
                        break;
                    }
                    if after.is_none() {
                        return Err(over(L::SourceBytes));
                    }
                }
            }
            live.insert(source, (members, values));
        }
    }
    // Estimate without materializing a cross product. Falling back is always
    // allowed: direct-pair count chooses a strategy, never rejects a policy.
    let mut pairs = addresses.values().map(|m| m.len() as u64).sum::<u64>();
    let mut live_domains = false;
    let mut active = Members::new();
    for members in addresses.values().chain(domains.values()) {
        active.extend(members);
    }
    for (source, (members, values)) in &live {
        if values.is_empty() {
            continue;
        }
        active.extend(members);
        match source {
            RuleSource::Contact(_) => {
                pairs =
                    pairs.saturating_add((members.len() as u64).saturating_mul(values.len() as u64))
            }
            RuleSource::Company(_) => live_domains = true,
        }
    }
    let direct = domains.is_empty() && !live_domains && pairs <= L::DirectPairs.maximum();
    let mut matches = BTreeSet::new();
    if direct {
        let mut lookups = BTreeSet::new();
        for (address, members) in &addresses {
            for member in members {
                lookups.insert((*member, address.as_str()));
            }
        }
        for (source, (members, values)) in &live {
            if !matches!(source, RuleSource::Contact(_)) {
                continue;
            }
            for member in members {
                for value in values {
                    lookups.insert((*member, value.as_str()));
                }
            }
        }
        budget.charge(L::DirectPairs, lookups.len() as u64)?;
        let lookups: Vec<_> = lookups.into_iter().collect();
        // Borrow shared strings and cap encoded batch bytes. Repeated large
        // live values must not become a 200 MiB argument buffer across owners.
        // A common policy still fits in one query.
        let mut offset = 0;
        while offset < lookups.len() {
            let mut end = offset;
            let mut bytes = 0;
            while end < lookups.len() {
                let next = lookups[end].1.len() + 32;
                if end > offset && bytes + next > 1024 * 1024 {
                    break;
                }
                bytes += next;
                end += 1;
            }
            let batch = &lookups[offset..end];
            let rows = reader
                .direct_contacts(batch, budget.remaining(L::MailboxContacts) as usize + 1)
                .await?;
            for row in rows {
                budget.charge(L::MailboxContacts, 1)?;
                budget.charge(L::ContactBytes, row.bytes)?;
                matches.insert((row.link_id, row.id));
            }
            offset = end;
        }
    } else if small_input {
        // No expansion cross product: build one contributor's flattened set at
        // a time. Each has at most the globally bounded live/literal values.
        for link in active {
            let mut a: BTreeSet<_> = addresses
                .iter()
                .filter(|(_, m)| m.contains(&link))
                .map(|(v, _)| v.clone())
                .collect();
            let mut d: BTreeSet<_> = domains
                .iter()
                .filter(|(_, m)| m.contains(&link))
                .map(|(v, _)| v.clone())
                .collect();
            for (source, (members, values)) in &live {
                if !members.contains(&link) {
                    continue;
                }
                match source {
                    RuleSource::Contact(_) => a.extend(values.iter().cloned()),
                    RuleSource::Company(_) => d.extend(values.iter().cloned()),
                }
            }
            budget.check_deadline()?;
            let result = reader
                .small_matches(
                    link,
                    &a.into_iter().collect::<Vec<_>>(),
                    &d.into_iter().collect::<Vec<_>>(),
                    budget.remaining(L::MailboxContacts) as usize + 1,
                    budget.remaining(L::ContactBytes),
                    budget.remaining(L::SuffixChecks),
                )
                .await?;
            budget.charge(L::MailboxContacts, result.rows)?;
            budget.charge(L::ContactBytes, result.bytes)?;
            budget.charge(L::SuffixChecks, result.suffix_checks)?;
            matches.extend(result.ids.into_iter().map(|id| (link, id)));
        }
    } else {
        // Fold repeated sources once; keep membership separate from the values
        // so 1,000 members do not multiply a 50,000-address live source.
        let mut address_sources = HashMap::<&str, Vec<RuleSource>>::new();
        let mut domain_sources = HashMap::<&str, Vec<RuleSource>>::new();
        let mut domain_members: Members = domains.values().flatten().copied().collect();
        for (source, (members, values)) in &live {
            let map = match source {
                RuleSource::Contact(_) => &mut address_sources,
                RuleSource::Company(_) => {
                    if !values.is_empty() {
                        domain_members.extend(members);
                    }
                    &mut domain_sources
                }
            };
            for value in values.iter().map(String::as_str).collect::<HashSet<_>>() {
                map.entry(value).or_default().push(*source);
            }
        }
        for link in active {
            let has_domains = domain_members.contains(&link);
            let mut after = None;
            loop {
                budget.check_deadline()?;
                let cap = CONTACT_BATCH.min(budget.remaining(L::MailboxContacts) as usize + 1);
                let rows = reader
                    .mailbox_contacts(
                        link,
                        after.as_deref(),
                        cap,
                        budget.remaining(L::ContactBytes),
                    )
                    .await?;
                let count = rows.len();
                for row in rows {
                    budget.charge(L::MailboxContacts, 1)?;
                    budget.charge(L::ContactBytes, row.bytes)?;
                    let address = row.address.ok_or_else(|| over(L::ContactBytes))?;
                    let domain = row.domain.ok_or_else(|| over(L::ContactBytes))?;
                    after = row.key;
                    // Only this mailbox's domain selectors require suffix work.
                    // Both strategies charge it even when an address matches.
                    if !domain.is_empty() && has_domains {
                        budget.charge(L::SuffixChecks, domain.split('.').count() as u64)?;
                    }
                    let mut hit = addresses
                        .get(&address)
                        .is_some_and(|members| members.contains(&link))
                        || permits(&address_sources, &live, &address, link, budget)?;
                    if !hit && !domain.is_empty() && has_domains {
                        let mut suffix = domain.as_str();
                        loop {
                            if domains
                                .get(suffix)
                                .is_some_and(|members| members.contains(&link))
                                || permits(&domain_sources, &live, suffix, link, budget)?
                            {
                                hit = true;
                                break;
                            }
                            match suffix.split_once('.') {
                                Some((_, rest)) => suffix = rest,
                                None => break,
                            }
                        }
                    }
                    if hit {
                        matches.insert((link, row.id));
                    }
                }
                if count < cap {
                    break;
                }
                if after.is_none() {
                    return Err(over(L::ContactBytes));
                }
            }
        }
    }
    budget.check_deadline()?;
    tracing::Span::current().record("contacts", matches.len());
    Ok(EmailRuleDiscovery {
        contacts: matches.into_iter().collect(),
        work: budget.work().clone(),
        small_input,
    })
}

fn permits(
    sources: &HashMap<&str, Vec<RuleSource>>,
    live: &BTreeMap<RuleSource, (Members, Vec<String>)>,
    value: &str,
    link: Uuid,
    budget: &mut EmailRuleDiscoveryBudget,
) -> Result<bool, CrmError> {
    for source in sources.get(value).into_iter().flatten() {
        budget.charge(EmailRuleWorkLimit::MembershipChecks, 1)?;
        if live
            .get(source)
            .is_some_and(|(members, _)| members.contains(&link))
        {
            return Ok(true);
        }
    }
    Ok(false)
}
