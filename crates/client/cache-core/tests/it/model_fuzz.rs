//! Generated histories against the reference oracle; failures shrink and persist.

#[path = "support/optimistic_model.rs"]
mod optimistic_model;

use cache_core::store::InMemoryStorage;
use pollster::block_on;
use proptest::prelude::*;

proptest! {
    #[test]
    fn optimistic_queries_match_the_reference_model(
        capacity in 1usize..9,
        actions in proptest::collection::vec(optimistic_model::action(), 1..81),
    ) {
        block_on(optimistic_model::run(InMemoryStorage::new(), Clone::clone, capacity, actions));
    }
}
