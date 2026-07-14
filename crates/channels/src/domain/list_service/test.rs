use super::*;
use frecency::domain::models::{AggregateFrecency, FrecencyPageRequest};

struct PanicFrecencyStorage;

impl AggregateFrecencyStorage for PanicFrecencyStorage {
    type Err = anyhow::Error;

    async fn get_top_entities(
        &self,
        _req: FrecencyPageRequest<'_>,
    ) -> Result<Vec<AggregateFrecency>, Self::Err> {
        panic!("top frecency lookup should not run")
    }

    async fn set_aggregate(&self, _frecency: AggregateFrecency) -> Result<(), Self::Err> {
        panic!("frecency write should not run")
    }

    async fn get_aggregate_for_user_entities<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
        _entities: &'a [model_entity::Entity<'a>],
    ) -> Result<Vec<AggregateFrecency>, Self::Err> {
        panic!("frecency by-id lookup should not run")
    }
}

#[tokio::test]
async fn skips_frecency_lookup_when_not_requested() {
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let scores = get_channel_frecency(&PanicFrecencyStorage, false, user_id, &[])
        .await
        .unwrap();

    assert!(scores.is_empty());
}
