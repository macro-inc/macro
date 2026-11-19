use super::*;
use crate::domain::{email_rules::EmailInclusionRule, model::CrmError};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[test]
fn raw_work_accumulates_across_sources_while_value_size_is_a_maximum()
-> Result<(), EmailRuleLimitExceeded> {
    let mut budget = EmailRuleDiscoveryBudget::new(Instant::now() + Duration::from_secs(10));
    budget.charge(EmailRuleWorkLimit::SourceAddresses, 20_000)?;
    budget.charge(EmailRuleWorkLimit::SourceValueBytes, 3_000)?;
    budget.charge(EmailRuleWorkLimit::SourceBytes, 3_000)?;
    budget.charge(EmailRuleWorkLimit::SourceAddresses, 30_000)?;
    budget.charge(EmailRuleWorkLimit::SourceValueBytes, 4_096)?;
    budget.charge(EmailRuleWorkLimit::SourceBytes, 4_096)?;

    assert_eq!(budget.work().source_value_bytes, 4_096);
    assert_eq!(budget.work().source_bytes, 7_096);
    let Err(error) = budget.charge(EmailRuleWorkLimit::SourceAddresses, 1) else {
        panic!("another source must not reset the shared address budget");
    };
    assert_eq!(error.limit, EmailRuleWorkLimit::SourceAddresses);
    assert_eq!(error.observed, 50_001);
    assert_eq!(budget.work().source_addresses, 50_001);
    Ok(())
}

#[test]
fn a_finished_request_cannot_start_another_discovery_stage() {
    let mut budget = EmailRuleDiscoveryBudget::new(Instant::now());
    let Err(error) = budget.charge(EmailRuleWorkLimit::RuleReferences, 1) else {
        panic!("discovery must not extend the caller's expired deadline");
    };
    assert_eq!(error.limit, EmailRuleWorkLimit::RequestDeadline);
    assert_eq!(budget.work().rule_references, 0);
}

#[derive(Default)]
struct Facts {
    contributors: Vec<RuleContributor>,
    rules: Vec<ContributorRule>,
    sources: Vec<RuleSourceFacts>,
    values: BTreeMap<RuleSource, Vec<RuleSourceValue>>,
    contacts: BTreeMap<Uuid, Vec<RuleMailboxContact>>,
    source_reads: BTreeMap<RuleSource, usize>,
    small_calls: usize,
    scan_calls: usize,
    direct_calls: usize,
    largest_direct_text_bytes: usize,
    small_overflow: bool,
}

impl EmailRuleDiscoveryReader for Facts {
    async fn inputs(
        &mut self,
        request: &EmailRuleDiscoveryRequest,
        contributor_limit: usize,
        rule_limit: usize,
    ) -> Result<RuleInputs, CrmError> {
        let contributors: Vec<_> = self
            .contributors
            .iter()
            .take(contributor_limit)
            .cloned()
            .collect();
        let stored: Vec<_> = contributors
            .iter()
            .filter(|c| {
                request
                    .proposed
                    .as_ref()
                    .is_none_or(|p| p.user_id != c.user_id)
            })
            .map(|c| c.link_id)
            .collect();
        let rules = self
            .rules
            .iter()
            .filter(|r| stored.contains(&r.link_id))
            .take(rule_limit)
            .cloned()
            .collect();
        Ok(RuleInputs {
            contributors,
            rules,
        })
    }
    async fn source_facts(
        &mut self,
        _: Uuid,
        sources: &[RuleSource],
    ) -> Result<Vec<RuleSourceFacts>, CrmError> {
        Ok(self
            .sources
            .iter()
            .filter(|f| sources.contains(&f.source))
            .cloned()
            .collect())
    }
    async fn source_values(
        &mut self,
        _: Uuid,
        source: RuleSource,
        after: Option<&str>,
        limit: usize,
        _: u64,
    ) -> Result<Vec<RuleSourceValue>, CrmError> {
        *self.source_reads.entry(source).or_default() += 1;
        Ok(self
            .values
            .get(&source)
            .into_iter()
            .flatten()
            .filter(|v| after.is_none_or(|a| v.key.as_deref().is_some_and(|k| k > a)))
            .take(limit)
            .cloned()
            .collect())
    }
    async fn direct_contacts(
        &mut self,
        pairs: &[(Uuid, &str)],
        limit: usize,
    ) -> Result<Vec<RuleDirectContact>, CrmError> {
        self.direct_calls += 1;
        self.largest_direct_text_bytes = self
            .largest_direct_text_bytes
            .max(pairs.iter().map(|(_, address)| address.len()).sum());
        Ok(pairs
            .iter()
            .flat_map(|(link, address)| {
                self.contacts
                    .get(link)
                    .into_iter()
                    .flatten()
                    .filter(move |c| c.address.as_deref() == Some(*address))
                    .map(|c| RuleDirectContact {
                        link_id: *link,
                        id: c.id,
                        bytes: c.bytes,
                    })
            })
            .take(limit)
            .collect())
    }
    async fn mailbox_contacts(
        &mut self,
        link: Uuid,
        after: Option<&str>,
        limit: usize,
        _: u64,
    ) -> Result<Vec<RuleMailboxContact>, CrmError> {
        self.scan_calls += 1;
        Ok(self
            .contacts
            .get(&link)
            .into_iter()
            .flatten()
            .filter(|v| after.is_none_or(|a| v.key.as_deref().is_some_and(|k| k > a)))
            .take(limit)
            .cloned()
            .collect())
    }
    async fn small_matches(
        &mut self,
        link: Uuid,
        addresses: &[String],
        domains: &[String],
        limit: usize,
        _: u64,
        suffix_checks: u64,
    ) -> Result<RuleSmallMatches, CrmError> {
        self.small_calls += 1;
        let mut result = RuleSmallMatches {
            rows: 0,
            bytes: 0,
            suffix_checks: 0,
            ids: Vec::new(),
        };
        for c in self.contacts.get(&link).into_iter().flatten().take(limit) {
            result.rows += 1;
            result.bytes += c.bytes;
            let domain = c.domain.as_deref().unwrap_or_default();
            if !domains.is_empty() && !domain.is_empty() {
                result.suffix_checks += domain.split('.').count() as u64;
            }
            if result.suffix_checks > suffix_checks {
                continue;
            }
            if c.address.as_ref().is_some_and(|a| addresses.contains(a))
                || domains.iter().any(|d| {
                    !domain.is_empty() && (domain == d || domain.ends_with(&format!(".{d}")))
                })
            {
                result.ids.push(c.id);
            }
        }
        if self.small_overflow {
            result.rows = EmailRuleWorkLimit::MailboxContacts.maximum() + 1;
        }
        Ok(result)
    }
}
fn contributor(n: u128, hidden: bool) -> RuleContributor {
    RuleContributor {
        link_id: Uuid::from_u128(n),
        user_id: format!("member-{n}"),
        sees_hidden: hidden,
        revision: Some(1),
    }
}
fn contact(id: u128, address: &str) -> RuleMailboxContact {
    RuleMailboxContact {
        id: Uuid::from_u128(id),
        key: Some(address.into()),
        address: Some(address.to_lowercase()),
        domain: Some(address.split('@').nth(1).unwrap_or_default().to_lowercase()),
        bytes: address.len() as u64,
    }
}
fn request() -> EmailRuleDiscoveryRequest {
    EmailRuleDiscoveryRequest {
        team_id: Uuid::from_u128(100),
        links: None,
        proposed: None,
    }
}
async fn run(facts: &mut Facts) -> Result<EmailRuleDiscovery, CrmError> {
    discover(facts, request(), Instant::now() + Duration::from_secs(10)).await
}

#[tokio::test]
async fn shared_live_source_is_read_once_without_granting_a_hidden_source_to_other_members()
-> anyhow::Result<()> {
    let source = RuleSource::Contact(Uuid::from_u128(200));
    let mut facts = Facts::default();
    facts.contributors = (1..=9).map(|id| contributor(id, id == 1)).collect();
    facts.rules = (1..=9)
        .map(|id| ContributorRule {
            link_id: Uuid::from_u128(id),
            rule: EmailInclusionRule::Contact {
                contact_id: Uuid::from_u128(200),
            },
        })
        .collect();
    facts.sources.push(RuleSourceFacts {
        source,
        in_team: true,
        hidden: true,
    });
    facts.values.insert(
        source,
        vec![RuleSourceValue {
            key: Some("peer@example.com".into()),
            value: Some("peer@example.com".into()),
            bytes: 16,
            in_team: true,
        }],
    );
    for id in 1..=9 {
        facts.contacts.insert(
            Uuid::from_u128(id),
            vec![
                contact(id + 1000, "peer@example.com"),
                contact(id + 2000, "PEER@example.com"),
            ],
        );
    }
    let result = run(&mut facts).await?;
    assert_eq!(
        result.contacts,
        vec![
            (Uuid::from_u128(1), Uuid::from_u128(1001)),
            (Uuid::from_u128(1), Uuid::from_u128(2001))
        ]
    );
    assert_eq!(facts.source_reads.get(&source), Some(&1));
    assert_eq!(result.work.source_addresses, 1);
    // When the record is hidden/deleted for everyone, old expanded values are
    // not cached across calls and no mailbox history is read.
    facts.sources.clear();
    let next = run(&mut facts).await?;
    assert!(next.contacts.is_empty());
    assert_eq!(next.work.mailbox_contacts, 0);
    Ok(())
}

#[tokio::test]
async fn domain_suffixes_and_empty_domains_agree_on_both_input_paths() -> anyhow::Result<()> {
    for contributors in [1, 9] {
        let mut facts = Facts::default();
        facts.contributors = (1..=contributors)
            .map(|id| contributor(id, false))
            .collect();
        facts.rules = vec![ContributorRule {
            link_id: Uuid::from_u128(1),
            rule: EmailInclusionRule::Domain {
                domain: "client.example".into(),
            },
        }];
        facts.contacts.insert(
            Uuid::from_u128(1),
            vec![
                contact(10, "a@sub.client.example"),
                contact(11, "a@otherclient.example"),
                contact(12, "a@"),
                contact(13, "a@client.example"),
            ],
        );
        let result = run(&mut facts).await?;
        assert_eq!(
            result.contacts,
            vec![
                (Uuid::from_u128(1), Uuid::from_u128(10)),
                (Uuid::from_u128(1), Uuid::from_u128(13))
            ]
        );
        assert_eq!(result.small_input, contributors == 1);
        assert_eq!(facts.small_calls, usize::from(contributors == 1));
        assert_eq!(facts.scan_calls, usize::from(contributors == 9));
    }
    Ok(())
}

#[tokio::test]
async fn an_oversized_exact_cross_product_changes_strategy_without_rejecting_or_truncating()
-> anyhow::Result<()> {
    let source = RuleSource::Contact(Uuid::from_u128(200));
    let mut facts = Facts::default();
    facts.contributors = (1..=9).map(|id| contributor(id, false)).collect();
    facts.rules = (1..=9)
        .map(|id| ContributorRule {
            link_id: Uuid::from_u128(id),
            rule: EmailInclusionRule::Contact {
                contact_id: Uuid::from_u128(200),
            },
        })
        .collect();
    facts.sources.push(RuleSourceFacts {
        source,
        in_team: true,
        hidden: false,
    });
    facts.values.insert(
        source,
        (0..6_000)
            .map(|i| {
                let value = format!("{i:05}@example.com");
                RuleSourceValue {
                    key: Some(value.clone()),
                    value: Some(value.clone()),
                    bytes: value.len() as u64,
                    in_team: true,
                }
            })
            .collect(),
    );
    for id in 1..=9 {
        facts.contacts.insert(
            Uuid::from_u128(id),
            vec![contact(id + 100, "05999@example.com")],
        );
    }
    let result = run(&mut facts).await?;
    assert_eq!(result.contacts.len(), 9);
    assert_eq!(facts.direct_calls, 0);
    assert_eq!(facts.scan_calls, 9);
    assert_eq!(facts.source_reads[&source], 3);
    assert_eq!(result.work.source_addresses, 6_000);
    assert_eq!(result.work.direct_pairs, 0);
    // A narrowed page stays complete when it selects the small path.
    facts.contributors.truncate(1);
    let small = run(&mut facts).await?;
    assert_eq!(
        small.contacts,
        vec![(Uuid::from_u128(1), Uuid::from_u128(101))]
    );
    assert!(small.small_input);
    Ok(())
}

#[tokio::test]
async fn a_small_path_limit_discards_matches_instead_of_returning_a_partial_page() {
    let mut facts = Facts::default();
    facts.contributors.push(contributor(1, false));
    facts.rules.push(ContributorRule {
        link_id: Uuid::from_u128(1),
        rule: EmailInclusionRule::Domain {
            domain: "example.com".into(),
        },
    });
    facts
        .contacts
        .insert(Uuid::from_u128(1), vec![contact(10, "a@example.com")]);
    facts.small_overflow = true;
    let error = run(&mut facts).await.unwrap_err();
    assert!(matches!(
        error,
        CrmError::EmailRuleLimitExceeded(EmailRuleLimitExceeded {
            limit: EmailRuleWorkLimit::MailboxContacts,
            ..
        })
    ));
}

#[tokio::test]
async fn proposed_rules_replace_the_owner_in_the_aggregate_instead_of_adding_to_old_rules()
-> anyhow::Result<()> {
    let mut facts = Facts::default();
    facts.contributors = vec![contributor(1, false), contributor(2, false)];
    facts.rules = vec![
        ContributorRule {
            link_id: Uuid::from_u128(1),
            rule: EmailInclusionRule::Address {
                address: "old@example.com".into(),
            },
        },
        ContributorRule {
            link_id: Uuid::from_u128(2),
            rule: EmailInclusionRule::Address {
                address: "other@example.com".into(),
            },
        },
    ];
    facts.contacts.insert(
        Uuid::from_u128(1),
        vec![
            contact(11, "old@example.com"),
            contact(12, "new@example.com"),
        ],
    );
    facts
        .contacts
        .insert(Uuid::from_u128(2), vec![contact(21, "other@example.com")]);
    let mut requested = request();
    requested.proposed = Some(ProposedEmailRules {
        user_id: "member-1".into(),
        link_id: Uuid::from_u128(1),
        rules: vec![EmailInclusionRule::Address {
            address: "new@example.com".into(),
        }],
    });
    let result = discover(
        &mut facts,
        requested,
        Instant::now() + Duration::from_secs(10),
    )
    .await?;
    assert_eq!(
        result.contacts.into_iter().collect::<BTreeSet<_>>(),
        [
            (Uuid::from_u128(1), Uuid::from_u128(12)),
            (Uuid::from_u128(2), Uuid::from_u128(21))
        ]
        .into()
    );
    assert_eq!(result.work.rule_references, 2);
    Ok(())
}

#[tokio::test]
async fn wide_live_values_do_not_multiply_into_one_large_lookup_argument() -> anyhow::Result<()> {
    let source = RuleSource::Contact(Uuid::from_u128(200));
    let mut facts = Facts::default();
    facts.contributors = (1..=3).map(|id| contributor(id, false)).collect();
    facts.rules = (1..=3)
        .map(|id| ContributorRule {
            link_id: Uuid::from_u128(id),
            rule: EmailInclusionRule::Contact {
                contact_id: Uuid::from_u128(200),
            },
        })
        .collect();
    facts.sources.push(RuleSourceFacts {
        source,
        in_team: true,
        hidden: false,
    });
    let mut values: Vec<_> = (0..400)
        .map(|i| format!("{i:04}{}@example.com", "x".repeat(3_000)))
        .collect();
    values.push("match@example.com".into());
    facts.values.insert(
        source,
        values
            .into_iter()
            .map(|value| RuleSourceValue {
                key: Some(value.clone()),
                bytes: value.len() as u64,
                value: Some(value),
                in_team: true,
            })
            .collect(),
    );
    for id in 1..=3 {
        facts.contacts.insert(
            Uuid::from_u128(id),
            vec![contact(id + 100, "match@example.com")],
        );
    }
    let result = run(&mut facts).await?;
    assert_eq!(
        result.contacts,
        (1..=3)
            .map(|id| (Uuid::from_u128(id), Uuid::from_u128(id + 100)))
            .collect::<Vec<_>>()
    );
    assert_eq!(result.work.source_addresses, 401);
    assert_eq!(result.work.direct_pairs, 1_203);
    assert_eq!(facts.source_reads[&source], 1);
    assert!(
        facts.direct_calls > 1,
        "one shared live expansion cannot become a single multiplied argument"
    );
    assert!(facts.largest_direct_text_bytes <= 1024 * 1024);
    Ok(())
}
