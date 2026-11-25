use std::collections::HashMap;

use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::plan::{
    FiledPerson, RecordValue, ValueVisibility, plan_values, request_fingerprint,
    rewrite_sharing_rules, same_address_block,
};
use super::*;
use crate::domain::email_rules::{
    EMAIL_RULE_SCHEMA_VERSION, EmailInclusionRule, EmailRuleSet, MAX_EMAIL_INCLUSION_RULES,
};

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn targets(survivor: u128, sources: &[u128]) -> MergeTargets {
    MergeTargets::new(
        MergeRecordType::Company,
        id(survivor),
        sources.iter().copied().map(id),
    )
    .unwrap()
}

fn value(record: u128, property: u128, visibility: ValueVisibility, value: f64) -> RecordValue {
    RecordValue {
        record_id: id(record),
        property_id: id(property),
        property_name: format!("Property {property}"),
        visibility,
        value: PropertyValue::Num(value),
    }
}

#[test]
fn targets_refuse_an_empty_merge_a_self_merge_and_too_many_sources() {
    assert!(matches!(
        MergeTargets::new(MergeRecordType::Company, id(1), []),
        Err(MergeError::Invalid(_))
    ));
    assert!(matches!(
        MergeTargets::new(MergeRecordType::Company, id(1), [id(1), id(2)]),
        Err(MergeError::Invalid(_))
    ));
    assert!(matches!(
        MergeTargets::new(MergeRecordType::Company, id(1), (2..=12).map(id)),
        Err(MergeError::Invalid(_))
    ));

    let targets = MergeTargets::new(MergeRecordType::Company, id(9), [id(3), id(2), id(3)]).unwrap();
    assert_eq!(targets.sources(), &[id(2), id(3)]);
    assert_eq!(targets.all_sorted(), vec![id(2), id(3), id(9)]);
}

#[test]
fn the_survivors_value_wins_and_only_team_visible_differences_are_shown() {
    let plan = plan_values(
        &targets(1, &[2, 3]),
        &[
            value(1, 10, ValueVisibility::Team, 5.0),
            value(2, 10, ValueVisibility::Team, 7.0),
            value(3, 10, ValueVisibility::Team, 5.0),
            value(2, 11, ValueVisibility::Team, 1.0),
            value(1, 12, ValueVisibility::Private, 3.0),
            value(2, 12, ValueVisibility::Private, 4.0),
        ],
    );

    assert_eq!(plan.moved, vec![(id(2), id(11))]);
    assert_eq!(
        plan.dropped
            .iter()
            .map(|dropped| (dropped.record_id, dropped.property_id, dropped.visibility))
            .collect::<Vec<_>>(),
        vec![
            (id(2), id(10), ValueVisibility::Team),
            (id(2), id(12), ValueVisibility::Private),
        ]
    );
    assert_eq!(plan.conflicts.len(), 1);
    assert_eq!(plan.conflicts[0].property_id, id(10));
    assert_eq!(plan.conflicts[0].kept, PropertyValue::Num(5.0));
    assert_eq!(plan.conflicts[0].dropped.len(), 1);
    assert_eq!(plan.conflicts[0].dropped[0].record_id, id(2));
}

#[test]
fn without_a_survivor_value_the_first_source_by_id_gives_it() {
    let plan = plan_values(
        &targets(1, &[3, 2]),
        &[
            value(3, 10, ValueVisibility::Team, 9.0),
            value(2, 10, ValueVisibility::Team, 8.0),
        ],
    );
    assert_eq!(plan.moved, vec![(id(2), id(10))]);
    assert_eq!(plan.conflicts[0].kept, PropertyValue::Num(8.0));
    assert_eq!(plan.conflicts[0].dropped[0].record_id, id(3));
}

fn rules(include: Vec<EmailInclusionRule>) -> EmailRuleSet {
    EmailRuleSet {
        schema_version: EMAIL_RULE_SCHEMA_VERSION,
        include,
    }
}

fn company(n: u128) -> EmailInclusionRule {
    EmailInclusionRule::Company { company_id: id(n) }
}

fn domain(name: &str) -> EmailInclusionRule {
    EmailInclusionRule::Domain {
        domain: name.into(),
    }
}

#[test]
fn keeping_a_rule_names_the_merged_companys_domains_and_never_the_survivor() {
    let merged = HashMap::from([(id(2), vec!["b.example.com".into(), "a.example.org".into()])]);
    let rewritten = rewrite_sharing_rules(
        &rules(vec![company(2), domain("a.example.org"), company(7)]),
        MergeRecordType::Company,
        &merged,
        SharingRulesChoice::Keep,
    )
    .unwrap()
    .unwrap();

    let mut expected = vec![domain("a.example.org"), domain("b.example.com"), company(7)];
    expected.sort();
    assert_eq!(rewritten.include, expected);
    assert!(!rewritten.include.contains(&company(1)));
}

#[test]
fn stopping_removes_the_rule_and_untouched_rule_sets_are_left_alone() {
    let merged = HashMap::from([(id(2), vec!["b.example.com".into()])]);
    let rewritten = rewrite_sharing_rules(
        &rules(vec![company(2), company(7)]),
        MergeRecordType::Company,
        &merged,
        SharingRulesChoice::Stop,
    )
    .unwrap()
    .unwrap();
    assert_eq!(rewritten.include, vec![company(7)]);

    assert_eq!(
        rewrite_sharing_rules(
            &rules(vec![company(7)]),
            MergeRecordType::Company,
            &merged,
            SharingRulesChoice::Keep,
        )
        .unwrap(),
        None
    );
}

#[test]
fn keeping_a_rule_over_the_limit_is_refused_and_stopping_still_works() {
    let mut include: Vec<_> = (0..MAX_EMAIL_INCLUSION_RULES - 1)
        .map(|n| domain(&format!("d{n}.example.com")))
        .collect();
    include.push(company(2));
    let merged = HashMap::from([(id(2), vec!["x.example.com".into(), "y.example.com".into()])]);

    assert!(matches!(
        rewrite_sharing_rules(&rules(include.clone()), MergeRecordType::Company, &merged, SharingRulesChoice::Keep),
        Err(MergeError::SharingRulesTooLarge)
    ));
    let stopped = rewrite_sharing_rules(&rules(include), MergeRecordType::Company, &merged, SharingRulesChoice::Stop)
        .unwrap()
        .unwrap();
    assert_eq!(stopped.include.len(), MAX_EMAIL_INCLUSION_RULES - 1);
}

#[test]
fn people_sharing_an_address_across_records_block_the_merge_archived_ones_too() {
    let person = |contact: u128, record: u128, archived: bool, addresses: &[&str]| FiledPerson {
        contact_id: id(contact),
        name: Some(format!("Person {contact}")),
        record_id: id(record),
        archived,
        addresses: addresses.iter().map(|address| address.to_string()).collect(),
    };

    assert_eq!(
        same_address_block(&[
            person(20, 1, false, &["pat@a.example.com"]),
            person(21, 1, false, &["pat@a.example.com"]),
            person(22, 2, false, &["sam@b.example.com"]),
        ]),
        None,
        "two people under one record were already there; the merge adds none"
    );

    let Some(MergeBlock::SameAddressPeople { people }) = same_address_block(&[
        person(20, 1, false, &["pat@a.example.com", "p@a.example.com"]),
        person(22, 2, true, &["pat@a.example.com"]),
    ]) else {
        panic!("expected a block");
    };
    assert_eq!(
        people
            .iter()
            .map(|person| (person.contact_id, person.archived))
            .collect::<Vec<_>>(),
        vec![(id(20), false), (id(22), true)]
    );
    assert!(people.iter().all(|person| person.address == "pat@a.example.com"));
}

#[test]
fn a_request_key_fingerprints_the_whole_command() {
    let a = targets(1, &[2]);
    let b = targets(1, &[3]);
    assert_eq!(
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep),
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep)
    );
    assert_ne!(
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep),
        request_fingerprint(&a, "r1", SharingRulesChoice::Stop)
    );
    assert_ne!(
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep),
        request_fingerprint(&b, "r1", SharingRulesChoice::Keep)
    );
}
