use super::*;

#[test]
fn scheduler_paces_new_accounts_without_evicting_retained_owners() {
    let capacity = imap_engine::domain::models::AccountCapacity::DEFAULT;
    assert_eq!(capacity.binding_limit(0).unwrap(), 25);
    assert_eq!(capacity.binding_limit(100).unwrap(), 125);
    assert_eq!(capacity.binding_limit(140).unwrap(), 150);
    assert_eq!(capacity.binding_limit(150).unwrap(), 150);
    assert_eq!(capacity.binding_limit(205).unwrap(), 205);
}

#[tokio::test]
async fn existing_first_account_does_not_starve_later_new_accounts() {
    let bindings: Vec<_> = (0..205)
        .map(|_| Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        })
        .collect();
    let first = bindings[0];
    let mut owners = HashMap::from([(
        first.link_id,
        RunningAccount {
            sync_generation: 1,
            grant_generation: 1,
            cancellation: CancellationToken::new(),
            task: tokio::spawn(std::future::pending()),
        },
    )]);
    let pending = pending_bindings(bindings.clone(), &owners);
    assert_eq!(
        pending
            .iter()
            .map(|binding| binding.link_id)
            .collect::<Vec<_>>(),
        bindings[1..26]
            .iter()
            .map(|binding| binding.link_id)
            .collect::<Vec<_>>()
    );
    owners.remove(&first.link_id).unwrap().task.abort();
}

#[tokio::test]
async fn a_replica_at_capacity_retains_owners_and_admits_no_new_actor() {
    let bindings = (0..205)
        .map(|_| Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        })
        .collect::<Vec<_>>();
    let owners = bindings[..150]
        .iter()
        .map(|binding| {
            (
                binding.link_id,
                RunningAccount {
                    sync_generation: 1,
                    grant_generation: 1,
                    cancellation: CancellationToken::new(),
                    task: tokio::spawn(std::future::pending()),
                },
            )
        })
        .collect::<HashMap<_, _>>();
    assert!(pending_bindings(bindings, &owners).is_empty());
    assert_eq!(owners.len(), 150);
    for owner in owners.into_values() {
        owner.task.abort();
    }
}

#[tokio::test]
async fn empty_rounds_preserve_first_enrollment_and_listening_starts_only_once() {
    let (start, mut ready) = oneshot::channel();
    let mut start = Some(start);
    start_listener_for_bindings(&[], &mut start);
    start_listener_for_bindings(&[], &mut start);
    assert!(matches!(
        ready.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ));
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    // A later thirty-second poll can still admit the first account without
    // receiving a notification or having an existing owner.
    let pending = pending_bindings(vec![binding], &HashMap::new());
    assert_eq!(pending.len(), 1);
    start_listener_for_bindings(&pending, &mut start);
    ready.await.unwrap();
    assert!(start.is_none());
    start_listener_for_bindings(&[], &mut start);
    start_listener_for_bindings(&[binding], &mut start);
    assert!(start.is_none());
}
