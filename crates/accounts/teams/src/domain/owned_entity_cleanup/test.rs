use super::*;

#[tokio::test]
async fn unwired_cleanup_refuses_every_call() {
    let team_id = Uuid::from_u128(1);
    let entity = OwnedEntityRef {
        id: Uuid::from_u128(2),
        entity_type: RegisteredEntityType::Document,
        owner: TeamDeletionOwner::Team(team_id),
    };

    assert_eq!(
        UnwiredOwnedEntityCleanup.team_bots(team_id).await,
        Err(OwnedEntityCleanupUnwired)
    );
    assert_eq!(
        UnwiredOwnedEntityCleanup.owned_by(&entity.owner).await,
        Err(OwnedEntityCleanupUnwired)
    );
    assert_eq!(
        UnwiredOwnedEntityCleanup.purge(&entity).await,
        Err(OwnedEntityCleanupUnwired)
    );
}
