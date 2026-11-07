use super::*;
use crate::service::property_definition::PropertyDefinition;
use crate::service::property_option::PropertyOption;
use crate::shared::DataType;
use chrono::Utc;

fn tag_set(
    definition_id: Uuid,
    owner: PropertyOwner,
    labels: &[(Uuid, &str)],
) -> PropertyDefinitionWithOptions {
    let now = Utc::now();
    PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: definition_id,
            owner,
            display_name: "Tags".to_string(),
            data_type: DataType::Tag,
            is_multi_select: true,
            specific_entity_type: None,
            created_at: now,
            updated_at: now,
            is_system: false,
            is_metadata: false,
        },
        property_options: labels
            .iter()
            .map(|(id, label)| PropertyOption {
                id: *id,
                property_definition_id: definition_id,
                display_order: 0,
                value: PropertyOptionValue::String(label.to_string()),
                color: None,
                created_at: now,
                updated_at: now,
            })
            .collect(),
    }
}

fn user_owner() -> PropertyOwner {
    PropertyOwner::User {
        user_id: "user1".to_string(),
    }
}

fn team_owner() -> PropertyOwner {
    PropertyOwner::Team {
        team_id: Uuid::from_u128(99),
    }
}

fn filter(label: &str, scope: Option<TagScope>) -> TagFilter {
    TagFilter {
        label: label.to_string(),
        scope,
    }
}

#[test]
fn resolves_labels_case_insensitively() {
    let option_id = Uuid::from_u128(1);
    let sets = CallerTagSets::new(vec![tag_set(
        Uuid::from_u128(10),
        user_owner(),
        &[(option_id, "Bug-Report")],
    )]);

    let resolved = sets.resolve_filters(&[filter("bug-report", None)]).unwrap();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].option_id, option_id);
    assert_eq!(resolved[0].scope, TagScope::Personal);
}

#[test]
fn scope_narrows_a_label_present_in_both_sets() {
    let personal_option = Uuid::from_u128(1);
    let team_option = Uuid::from_u128(2);
    let sets = CallerTagSets::new(vec![
        tag_set(
            Uuid::from_u128(10),
            user_owner(),
            &[(personal_option, "urgent")],
        ),
        tag_set(
            Uuid::from_u128(11),
            team_owner(),
            &[(team_option, "urgent")],
        ),
    ]);

    // Without a scope both options match (OR of the two sets).
    let resolved = sets.resolve_filters(&[filter("urgent", None)]).unwrap();
    assert_eq!(resolved.len(), 2);

    let resolved = sets
        .resolve_filters(&[filter("urgent", Some(TagScope::Team))])
        .unwrap();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].option_id, team_option);
}

#[test]
fn unknown_label_errors_with_available_labels() {
    let sets = CallerTagSets::new(vec![tag_set(
        Uuid::from_u128(10),
        user_owner(),
        &[
            (Uuid::from_u128(1), "mobile"),
            (Uuid::from_u128(2), "backend"),
        ],
    )]);

    let err = sets
        .resolve_filters(&[filter("nonexistent", None)])
        .unwrap_err();
    assert_eq!(err.label, "nonexistent");
    assert_eq!(err.available, vec!["backend", "mobile"]);
    assert!(err.to_string().contains("backend, mobile"));
}

#[test]
fn unique_resolve_rejects_a_label_present_in_both_sets() {
    let personal_option = Uuid::from_u128(1);
    let team_option = Uuid::from_u128(2);
    let sets = CallerTagSets::new(vec![
        tag_set(
            Uuid::from_u128(10),
            user_owner(),
            &[(personal_option, "urgent")],
        ),
        tag_set(
            Uuid::from_u128(11),
            team_owner(),
            &[(team_option, "urgent")],
        ),
    ]);

    let err = sets
        .resolve_filters_unique(&[filter("urgent", None)])
        .unwrap_err();
    let TagFilterError::Ambiguous(err) = err else {
        panic!("expected ambiguous error, got {err:?}");
    };
    assert_eq!(err.label, "urgent");
    assert_eq!(err.matches.len(), 2);
    let message = err.to_string();
    assert!(message.contains("ambiguous"), "{message}");
    assert!(message.contains("scope"), "{message}");

    // A scope disambiguates, and unknown labels still fail as unknown.
    let resolved = sets
        .resolve_filters_unique(&[filter("urgent", Some(TagScope::Team))])
        .unwrap();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].option_id, team_option);

    let err = sets
        .resolve_filters_unique(&[filter("nonexistent", None)])
        .unwrap_err();
    assert!(matches!(err, TagFilterError::Unknown(_)));
}

#[test]
fn duplicate_filters_dedupe_options() {
    let option_id = Uuid::from_u128(1);
    let sets = CallerTagSets::new(vec![tag_set(
        Uuid::from_u128(10),
        user_owner(),
        &[(option_id, "mobile")],
    )]);

    let resolved = sets
        .resolve_filters(&[filter("mobile", None), filter("MOBILE", None)])
        .unwrap();
    assert_eq!(resolved.len(), 1);
}

#[test]
fn system_owned_definitions_are_skipped() {
    let sets = CallerTagSets::new(vec![tag_set(
        Uuid::from_u128(10),
        PropertyOwner::System,
        &[(Uuid::from_u128(1), "hidden")],
    )]);
    assert!(sets.is_empty());
}

#[test]
fn applied_tag_map_carries_label_and_scope() {
    let option_id = Uuid::from_u128(1);
    let sets = CallerTagSets::new(vec![tag_set(
        Uuid::from_u128(10),
        team_owner(),
        &[(option_id, "urgent")],
    )]);

    let map = sets.applied_tag_by_option_id();
    assert_eq!(
        map.get(&option_id),
        Some(&AppliedTag {
            label: "urgent".to_string(),
            scope: TagScope::Team,
        })
    );
}
