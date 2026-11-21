use super::*;

#[tokio::test]
async fn existing_first_account_does_not_starve_later_new_accounts() {
    let bindings: Vec<_> = (0..3)
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
        vec![bindings[1].link_id, bindings[2].link_id]
    );
    owners.remove(&first.link_id).unwrap().task.abort();
}
