//! The merge's rules, independent of storage: which values stay, what a
//! teammate's sharing rule becomes, who blocks a merge, and the revision that
//! binds a commit to the review.

use std::collections::{BTreeMap, HashMap};

use models_properties::service::property_value::PropertyValue;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    DroppedValue, FieldConflict, MergeBlock, MergeError, MergePreview, MergeRecordType,
    MergeTargets, OtherCompanyPerson, SameAddressPerson, SharingRulesChoice,
};
use crate::domain::email_rules::{EmailInclusionRule, EmailRuleDefinitionError, EmailRuleSet};
use crate::domain::generic_email_domains::is_personal_email_domain;

/// Who can see a property's values on a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueVisibility {
    /// A team or system property: anyone who sees the record sees it.
    Team,
    /// A teammate's own property, which the merging admin may not see.
    Private,
}

/// One record's value for one property, as the merge finds it.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordValue {
    /// The record holding the value.
    pub record_id: Uuid,
    /// The property definition.
    pub property_id: Uuid,
    /// The property's name, for the review.
    pub property_name: String,
    /// Who can see the property.
    pub visibility: ValueVisibility,
    /// The stored value.
    pub value: PropertyValue,
}

/// A value the merge drops, for the merge log.
#[derive(Debug, Clone, PartialEq)]
pub struct DroppedRecordValue {
    /// The record merged away that held it.
    pub record_id: Uuid,
    /// The property definition.
    pub property_id: Uuid,
    /// Who could see it.
    pub visibility: ValueVisibility,
    /// The value.
    pub value: PropertyValue,
}

/// How the merge settles the records' own values.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ValuePlan {
    /// Values the record that stays takes from a record merged away, because
    /// it has none: `(from record, property)`.
    pub moved: Vec<(Uuid, Uuid)>,
    /// Values dropped because another value was kept.
    pub dropped: Vec<DroppedRecordValue>,
    /// The team-visible differences the review shows, in property order.
    pub conflicts: Vec<FieldConflict>,
}

/// The value of the record that stays wins. Where it has none, the first
/// record merged away (by id) that has one gives it; equal values collapse.
/// Every other differing value is dropped: it goes to the merge log, and to
/// the review only when the team can see the property.
pub fn plan_values(targets: &MergeTargets, values: &[RecordValue]) -> ValuePlan {
    let mut by_property: BTreeMap<Uuid, Vec<&RecordValue>> = BTreeMap::new();
    for value in values {
        if value.record_id == targets.survivor() || targets.sources().contains(&value.record_id) {
            by_property
                .entry(value.property_id)
                .or_default()
                .push(value);
        }
    }

    let mut plan = ValuePlan::default();
    for (property_id, mut held) in by_property {
        // The survivor first, then sources in id order.
        held.sort_by_key(|value| (value.record_id != targets.survivor(), value.record_id));
        let kept = held[0];
        if kept.record_id != targets.survivor() {
            plan.moved.push((kept.record_id, property_id));
        }

        let dropped: Vec<&RecordValue> = held[1..]
            .iter()
            .copied()
            .filter(|value| value.value != kept.value)
            .collect();
        if dropped.is_empty() {
            continue;
        }
        plan.dropped
            .extend(dropped.iter().map(|value| DroppedRecordValue {
                record_id: value.record_id,
                property_id,
                visibility: value.visibility,
                value: value.value.clone(),
            }));
        if kept.visibility == ValueVisibility::Team {
            plan.conflicts.push(FieldConflict {
                property_id,
                property_name: kept.property_name.clone(),
                kept: kept.value.clone(),
                dropped: dropped
                    .iter()
                    .map(|value| DroppedValue {
                        record_id: value.record_id,
                        value: value.value.clone(),
                    })
                    .collect(),
            });
        }
    }
    plan
}

/// A teammate's sharing rule set after the merge, or `None` when it names no
/// record merged away. Keeping turns each rule naming one into rules for its
/// domains (companies) or addresses (contacts) as they are now, which match
/// the same mail; stopping removes the rule. The result is canonical: sorted,
/// without duplicates.
pub fn rewrite_sharing_rules(
    rules: &EmailRuleSet,
    record_type: MergeRecordType,
    merged: &HashMap<Uuid, Vec<String>>,
    choice: SharingRulesChoice,
) -> Result<Option<EmailRuleSet>, MergeError> {
    let names_merged = |rule: &EmailInclusionRule| match (record_type, rule) {
        (MergeRecordType::Company, EmailInclusionRule::Company { company_id }) => {
            merged.get(company_id)
        }
        (MergeRecordType::Contact, EmailInclusionRule::Contact { contact_id }) => {
            merged.get(contact_id)
        }
        _ => None,
    };
    if !rules
        .include
        .iter()
        .any(|rule| names_merged(rule).is_some())
    {
        return Ok(None);
    }

    let mut include = Vec::with_capacity(rules.include.len());
    for rule in &rules.include {
        match names_merged(rule) {
            None => include.push(rule.clone()),
            Some(_) if choice == SharingRulesChoice::Stop => {}
            Some(identifiers) => {
                include.extend(identifiers.iter().map(|identifier| match record_type {
                    MergeRecordType::Company => EmailInclusionRule::Domain {
                        domain: identifier.clone(),
                    },
                    MergeRecordType::Contact => EmailInclusionRule::Address {
                        address: identifier.clone(),
                    },
                }))
            }
        }
    }
    include.sort();
    include.dedup();

    let rewritten = EmailRuleSet {
        schema_version: rules.schema_version,
        include,
    };
    match rewritten.validate_shape() {
        Ok(()) => Ok(Some(rewritten)),
        Err(EmailRuleDefinitionError::TooManyRules | EmailRuleDefinitionError::TooLarge) => {
            Err(MergeError::SharingRulesTooLarge)
        }
        Err(error) => Err(MergeError::Invalid(error.to_string())),
    }
}

/// A person filed under one of the merged records, with every address they
/// hold.
#[derive(Debug, Clone)]
pub struct FiledPerson {
    /// Contact id.
    pub contact_id: Uuid,
    /// Contact name, when it has one.
    pub name: Option<String>,
    /// The record it is filed under.
    pub record_id: Uuid,
    /// Whether the contact is archived.
    pub archived: bool,
    /// Every address it holds, lowercased.
    pub addresses: Vec<String>,
}

/// People under different records holding one address block the merge: it
/// would file two people with one address under the record that stays. People
/// are never merged as a side effect, so every one of them is listed, archived
/// ones too.
pub fn same_address_block(people: &[FiledPerson]) -> Option<MergeBlock> {
    let mut holders: BTreeMap<&str, Vec<&FiledPerson>> = BTreeMap::new();
    for person in people {
        for address in &person.addresses {
            holders.entry(address.as_str()).or_default().push(person);
        }
    }

    let mut blocking = Vec::new();
    for (address, held) in holders {
        let first = held[0].record_id;
        if held.iter().all(|person| person.record_id == first) {
            continue;
        }
        blocking.extend(held.into_iter().map(|person| SameAddressPerson {
            address: address.to_string(),
            contact_id: person.contact_id,
            name: person.name.clone(),
            record_id: person.record_id,
            archived: person.archived,
        }));
    }
    (!blocking.is_empty()).then_some(MergeBlock::SameAddressPeople { people: blocking })
}

/// A contact as a contact merge finds it, for the company rule.
#[derive(Debug, Clone)]
pub struct MergingContact {
    /// Contact id.
    pub contact_id: Uuid,
    /// Contact name, when it has one.
    pub name: Option<String>,
    /// The company it is filed under, with its name.
    pub company: Option<(Uuid, String)>,
    /// Every address it holds, lowercased.
    pub addresses: Vec<String>,
}

/// The contact that stays keeps its company, so a person merged away from
/// another company changes company. As a contact edit may, that needs
/// personal-provider addresses: anyone holding a work address, or none at
/// all, blocks the merge until their companies are merged.
pub fn different_companies_block(
    survivor: &MergingContact,
    sources: &[MergingContact],
) -> Option<MergeBlock> {
    let survivor_company = survivor.company.as_ref().map(|(id, _)| *id);
    let people: Vec<OtherCompanyPerson> = sources
        .iter()
        .filter_map(|source| {
            let (company_id, company_name) = source.company.as_ref()?;
            let personal_only = !source.addresses.is_empty()
                && source.addresses.iter().all(|address| {
                    address
                        .rsplit_once('@')
                        .is_some_and(|(_, domain)| is_personal_email_domain(domain))
                });
            (Some(*company_id) != survivor_company && !personal_only).then(|| OtherCompanyPerson {
                contact_id: source.contact_id,
                name: source.name.clone(),
                company_id: *company_id,
                company_name: company_name.clone(),
            })
        })
        .collect();
    (!people.is_empty()).then_some(MergeBlock::DifferentCompanies { people })
}

/// The preview's revision: a digest of everything the review shows, plus facts
/// it doesn't show that would change what the commit writes (such as which
/// revision of each teammate's sharing rules is active).
pub fn revision(preview: &MergePreview, unshown: &[String]) -> String {
    let mut shown = preview.clone();
    shown.revision = String::new();
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(&shown).unwrap_or_default());
    for fact in unshown {
        digest.update([0]);
        digest.update(fact.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

/// The fingerprint of a commit request, stored with the merge so a reused
/// request key can be told from an exact retry.
pub fn request_fingerprint(
    targets: &MergeTargets,
    revision: &str,
    choice: SharingRulesChoice,
) -> String {
    let mut digest = Sha256::new();
    digest.update(targets.record_type().as_str());
    digest.update(targets.survivor().as_bytes());
    for source in targets.sources() {
        digest.update(source.as_bytes());
    }
    digest.update(revision.as_bytes());
    digest.update(match choice {
        SharingRulesChoice::Keep => "keep",
        SharingRulesChoice::Stop => "stop",
    });
    format!("{:x}", digest.finalize())
}
