//! This module provides an [mockall::mock] concrete struct [MockFrecencyStorage] which can be used for testing
use frecency_core::{models::FrecencyPageRequest, ports::AggregateFrecencyStorage};
use macro_user_id::user_id::MacroUserIdStr;
use mockall::mock;
use model_entity::Entity;
use std::convert::Infallible;

mock! {
    pub FrecencyStorage {}
    impl AggregateFrecencyStorage for FrecencyStorage {
        type Err = Infallible;

        fn get_top_entities<'b>(&self, req: FrecencyPageRequest<'b>) -> impl Future<Output = Result<Vec<frecency_core::models::AggregateFrecency>, Infallible>> + Send;


        fn set_aggregate(&self, frecency: frecency_core::models::AggregateFrecency) -> impl Future<Output = Result<(), Infallible>> + Send;

        fn get_aggregate_for_user_entities<'a>(
            &self,
            user_id: MacroUserIdStr<'a>,
            entities: &'a [Entity<'a>],
        ) -> impl Future<Output = Result<Vec<frecency_core::models::AggregateFrecency>, Infallible>> + Send;
    }

}
