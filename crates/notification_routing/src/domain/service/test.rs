use feature_flags::outbound::fake::FakeFeatureFlags;

use super::*;
use crate::domain::models::StackKind;
use crate::domain::test_support::{FakeStacks, flags, stack, user};

fn service(
    stacks: FakeStacks,
    flags: FakeFeatureFlags,
) -> NotificationStackServiceImpl<FakeStacks, FakeFeatureFlags> {
    NotificationStackServiceImpl::new(stacks, flags)
}

fn mentions() -> StackRule {
    StackRule {
        kinds: vec![StackKind::Mention],
        ..Default::default()
    }
}

fn new_stack(name: &str, capture: Vec<StackRule>) -> NewStack {
    NewStack {
        name: name.to_string(),
        capture,
        release: vec![],
    }
}

#[tokio::test]
async fn a_new_stack_goes_after_the_owners_last_and_captures_into_noise() {
    let owner = user("owner@example.com");
    let service = service(FakeStacks::default(), flags(&[&owner], &[]));

    let first = service
        .create(&owner, new_stack("  Support channels ", vec![mentions()]))
        .await
        .unwrap();
    let second = service
        .create(&owner, new_stack("Bots", vec![mentions()]))
        .await
        .unwrap();

    assert_eq!(first.name, "Support channels");
    assert_eq!(first.lane, NotificationLane::Noise);
    assert!(first.enabled);
    assert_eq!((first.position, second.position), (0, 1));
    assert_eq!(service.list(&owner).await.unwrap(), vec![first, second]);
}

#[tokio::test]
async fn every_operation_is_refused_when_stacks_are_off_for_the_caller() {
    let owner = user("owner@example.com");
    let existing = stack(1, vec![mentions()], vec![]);
    let service = service(
        FakeStacks::default().with(&owner, existing.clone()),
        flags(&[], &[&owner]),
    );

    assert!(matches!(
        service.list(&owner).await,
        Err(StackError::Unavailable)
    ));
    assert!(matches!(
        service
            .create(&owner, new_stack("Bots", vec![mentions()]))
            .await,
        Err(StackError::Unavailable)
    ));
    assert!(matches!(
        service
            .update(&owner, existing.id, StackChanges::default())
            .await,
        Err(StackError::Unavailable)
    ));
    assert!(matches!(
        service.delete(&owner, existing.id).await,
        Err(StackError::Unavailable)
    ));
    assert!(matches!(
        service.reorder(&owner, vec![existing.id]).await,
        Err(StackError::Unavailable)
    ));
}

#[tokio::test]
async fn a_flag_that_cannot_be_read_is_an_error_not_a_refusal() {
    let owner = user("owner@example.com");
    let service = service(FakeStacks::default(), flags(&[], &[]));

    assert!(matches!(
        service.list(&owner).await,
        Err(StackError::Internal(_))
    ));
}

#[tokio::test]
async fn a_stack_that_would_capture_everything_or_nothing_is_refused() {
    let owner = user("owner@example.com");
    let service = service(FakeStacks::default(), flags(&[&owner], &[]));
    let refused = |stack: NewStack| {
        let service = &service;
        let owner = &owner;
        async move {
            match service.create(owner, stack).await {
                Err(StackError::Invalid(invalid)) => invalid,
                other => panic!("expected a refusal, got {other:?}"),
            }
        }
    };

    assert_eq!(
        refused(new_stack("   ", vec![mentions()])).await,
        InvalidStack::NameMissing
    );
    assert_eq!(
        refused(new_stack("Support", vec![])).await,
        InvalidStack::NoCaptureRule
    );
    // A rule with no condition would match every notification the owner gets.
    assert_eq!(
        refused(new_stack("Support", vec![StackRule::default()])).await,
        InvalidStack::RuleWithoutCondition
    );
    assert_eq!(
        refused(NewStack {
            release: vec![StackRule::default()],
            ..new_stack("Support", vec![mentions()])
        })
        .await,
        InvalidStack::RuleWithoutCondition
    );
    // Empty text is contained in every channel name.
    assert_eq!(
        refused(new_stack(
            "Support",
            vec![StackRule {
                sources: vec![StackSource::ChannelNameContains {
                    text: "  ".to_string()
                }],
                ..Default::default()
            }]
        ))
        .await,
        InvalidStack::SourceEmpty
    );
    assert_eq!(
        refused(new_stack("Support", vec![mentions(); MAX_RULES + 1])).await,
        InvalidStack::TooManyRules
    );
}

#[tokio::test]
async fn channel_name_text_is_stored_trimmed() {
    let owner = user("owner@example.com");
    let service = service(FakeStacks::default(), flags(&[&owner], &[]));

    let created = service
        .create(
            &owner,
            new_stack(
                "Support",
                vec![StackRule {
                    sources: vec![StackSource::ChannelNameContains {
                        text: " Macro Support ".to_string(),
                    }],
                    ..Default::default()
                }],
            ),
        )
        .await
        .unwrap();

    assert_eq!(
        created.capture[0].sources,
        vec![StackSource::ChannelNameContains {
            text: "Macro Support".to_string()
        }]
    );
}

#[tokio::test]
async fn an_owner_at_the_limit_cannot_add_another_stack() {
    let owner = user("owner@example.com");
    let mut stacks = FakeStacks::default();
    for id in 0..MAX_STACKS as u128 {
        stacks = stacks.with(&owner, stack(id, vec![mentions()], vec![]));
    }
    let service = service(stacks, flags(&[&owner], &[]));

    let refused = service
        .create(&owner, new_stack("One more", vec![mentions()]))
        .await;

    assert!(matches!(
        refused,
        Err(StackError::Invalid(InvalidStack::TooManyStacks))
    ));
}

#[tokio::test]
async fn an_edit_changes_only_what_it_names_and_is_validated() {
    let owner = user("owner@example.com");
    let existing = stack(1, vec![mentions()], vec![]);
    let service = service(
        FakeStacks::default().with(&owner, existing.clone()),
        flags(&[&owner], &[]),
    );

    let disabled = service
        .update(
            &owner,
            existing.id,
            StackChanges {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(!disabled.enabled);
    assert_eq!(disabled.capture, existing.capture);
    assert_eq!(disabled.revision, existing.revision + 1);

    let emptied = service
        .update(
            &owner,
            existing.id,
            StackChanges {
                capture: Some(vec![]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        emptied,
        Err(StackError::Invalid(InvalidStack::NoCaptureRule))
    ));
}

#[tokio::test]
async fn someone_elses_stack_is_not_found() {
    let owner = user("owner@example.com");
    let other = user("other@example.com");
    let theirs = stack(1, vec![mentions()], vec![]);
    let service = service(
        FakeStacks::default().with(&other, theirs.clone()),
        flags(&[&owner, &other], &[]),
    );

    assert!(matches!(
        service
            .update(&owner, theirs.id, StackChanges::default())
            .await,
        Err(StackError::NotFound)
    ));
    assert!(matches!(
        service.delete(&owner, theirs.id).await,
        Err(StackError::NotFound)
    ));
    assert_eq!(service.list(&other).await.unwrap(), vec![theirs]);
}

#[tokio::test]
async fn a_new_order_must_name_each_stack_once() {
    let owner = user("owner@example.com");
    let first = stack(1, vec![mentions()], vec![]);
    let second = NotificationStack {
        position: 1,
        ..stack(2, vec![mentions()], vec![])
    };
    let service = service(
        FakeStacks::default()
            .with(&owner, first.clone())
            .with(&owner, second.clone()),
        flags(&[&owner], &[]),
    );

    let reordered = service
        .reorder(&owner, vec![second.id, first.id])
        .await
        .unwrap();
    assert_eq!(
        reordered.iter().map(|stack| stack.id).collect::<Vec<_>>(),
        vec![second.id, first.id]
    );

    for incomplete in [vec![first.id], vec![first.id, first.id], vec![]] {
        assert!(matches!(
            service.reorder(&owner, incomplete).await,
            Err(StackError::Invalid(InvalidStack::OrderMismatch))
        ));
    }
}
