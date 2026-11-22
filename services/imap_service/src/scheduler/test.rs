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
