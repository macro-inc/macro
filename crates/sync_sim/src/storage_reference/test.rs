use super::*;
use crate::{
    ClientName, CrashMode, ProfileName, SimStorage, StorageProfile, storage::PendingWrite,
};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

struct SimAdapter {
    store: SimStorage,
    now: u64,
    rng: ChaCha8Rng,
}
impl StorageContract for SimAdapter {
    fn image(&self) -> StoreImage {
        self.store.image().clone()
    }
    fn action(&mut self, action: &ContractAction) -> Result<ContractReply, StorageFailure> {
        let profile = ProfileName("isolated-storage-contract".into());
        match action {
            ContractAction::Execute(op, wall) => {
                let (token, at) = self.store.issue(
                    PendingWrite {
                        client: ClientName("contract".into()),
                        session: SessionId(uuid_value::Uuid::from_u128(3)),
                        id: StorageOpId(1),
                        op: op.clone(),
                    },
                    self.now,
                    &mut self.rng,
                );
                self.now = at;
                match self
                    .store
                    .complete(token, &profile, at, *wall)
                    .expect("issued completion")
                    .event
                {
                    StorageEvent::Loaded { result, .. } => result.map(ContractReply::Loaded),
                    StorageEvent::Done { result, .. } => result.map(|()| ContractReply::Done),
                    StorageEvent::Adopted { result, .. } => result.map(ContractReply::Adopted),
                }
            }
            ContractAction::Acquire(doc, owner) => {
                self.store.leases.insert((doc.clone(), *owner));
                Ok(ContractReply::Done)
            }
            ContractAction::Release(doc, owner) => {
                self.store.leases.remove(&(doc.clone(), *owner));
                Ok(ContractReply::Done)
            }
            ContractAction::ProcessDeath => {
                self.store
                    .crash(&CrashMode::ProcessDeath, &profile, self.now);
                Ok(ContractReply::Done)
            }
            ContractAction::Evict(doc) => {
                Ok(ContractReply::Evicted(self.store.evict_snapshot(doc)))
            }
        }
    }
}
#[test]
fn real_sim_storage_matches_independent_transaction_model() {
    for case in storage_cases() {
        let mut store = SimStorage::with_retention(StorageProfile::fast(), case.retention);
        store.durable = case.initial.clone();
        let mut adapter = SimAdapter {
            store,
            now: 0,
            rng: ChaCha8Rng::seed_from_u64(1),
        };
        check_storage_case(&case, &mut adapter).unwrap();
    }
}
#[test]
fn comparison_rejects_an_adapter_that_wipes_after_process_death() {
    struct Wiping(IndexedDbModel);
    impl StorageContract for Wiping {
        fn image(&self) -> StoreImage {
            self.0.image()
        }
        fn action(&mut self, action: &ContractAction) -> Result<ContractReply, StorageFailure> {
            let reply = self.0.action(action)?;
            if matches!(action, ContractAction::ProcessDeath) {
                self.0 = IndexedDbModel::new(StoreImage::default(), Millis(1_000));
            }
            Ok(reply)
        }
    }
    let case = storage_cases().remove(0);
    let mut adapter = Wiping(IndexedDbModel::new(case.initial.clone(), case.retention));
    assert!(check_storage_case(&case, &mut adapter).is_err());
}
