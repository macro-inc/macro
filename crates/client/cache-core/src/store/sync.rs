//! In-memory streamed-sync state used by engine tests.

use super::{InMemoryStorage, Storage, SyncStorage};
use crate::predicate::ProjectionMutation;
use crate::sync::SyncLaneRow;
use crate::value::{EntityKey, Record};

impl SyncStorage for InMemoryStorage {
    async fn load_sync_lanes(&self) -> Result<Vec<SyncLaneRow>, Self::Error> {
        Ok(self
            .sync_lanes
            .iter()
            .map(|(id, state)| SyncLaneRow {
                id: id.clone(),
                state: state.clone(),
            })
            .collect())
    }

    async fn save_sync_lane(
        &mut self,
        row: SyncLaneRow,
        members: Vec<EntityKey<'static>>,
    ) -> Result<(), Self::Error> {
        for key in members {
            self.sync_members.insert((row.id.clone(), key));
        }
        self.sync_lanes.insert(row.id, row.state);
        Ok(())
    }

    async fn write_sync_page(
        &mut self,
        records: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
        lane: SyncLaneRow,
        members: Vec<EntityKey<'static>>,
    ) -> Result<(), Self::Error> {
        self.put_batch_with_projections(records, projections)
            .await?;
        self.save_sync_lane(lane, members).await
    }

    async fn load_sync_members(
        &self,
        lanes: &[String],
    ) -> Result<Vec<EntityKey<'static>>, Self::Error> {
        let mut keys = self
            .sync_members
            .iter()
            .filter(|(lane, _)| lanes.contains(lane))
            .map(|(_, key)| key.clone())
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        Ok(keys)
    }

    async fn remove_sync_members(
        &mut self,
        lanes: &[String],
        keys: &[EntityKey<'static>],
    ) -> Result<(), Self::Error> {
        for lane in lanes {
            for key in keys {
                self.sync_members.remove(&(lane.clone(), key.clone()));
            }
        }
        Ok(())
    }
}
