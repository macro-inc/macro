use chrono::{DateTime, Utc};
use model_owner::{Owner, OwnerType};
use shared_entity_registry::{EntityRegistryResult, RegisteredEntityType};
use uuid::Uuid;

use super::EntityRegistryServiceImpl;
use crate::domain::models::{EntityRecord, EntityTypeCount};
use crate::domain::ports::{EntityRegistryRepository, EntityRegistryService};

fn user_owner() -> Owner {
    Owner::parse(OwnerType::User, "macro|hutch@macro.com").unwrap()
}

fn ts() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

fn sample_record(id: u128) -> EntityRecord {
    EntityRecord {
        id: Uuid::from_u128(id),
        entity_type: RegisteredEntityType::Chat,
        owner: user_owner(),
        created_at: ts(),
        updated_at: ts(),
        deleted_at: None,
    }
}

#[derive(Clone, Default)]
struct FakeRepo {
    get: Option<EntityRecord>,
    get_many: Vec<EntityRecord>,
    list: Vec<EntityRecord>,
    count: EntityTypeCount,
}

impl EntityRegistryRepository for FakeRepo {
    async fn get(&self, _id: Uuid) -> EntityRegistryResult<Option<EntityRecord>> {
        Ok(self.get.clone())
    }

    async fn get_many(&self, _ids: &[Uuid]) -> EntityRegistryResult<Vec<EntityRecord>> {
        Ok(self.get_many.clone())
    }

    async fn list_owned_by(
        &self,
        _owner: &Owner,
        _entity_type: Option<RegisteredEntityType>,
    ) -> EntityRegistryResult<Vec<EntityRecord>> {
        Ok(self.list.clone())
    }

    async fn count_by_type(
        &self,
        _entity_type: RegisteredEntityType,
    ) -> EntityRegistryResult<EntityTypeCount> {
        Ok(self.count)
    }
}

#[tokio::test]
async fn get_returns_the_repository_row() {
    let record = sample_record(1);
    let service = EntityRegistryServiceImpl::new(FakeRepo {
        get: Some(record.clone()),
        ..FakeRepo::default()
    });
    assert_eq!(service.get(record.id).await.unwrap(), Some(record));
}

#[tokio::test]
async fn get_many_list_and_count_return_repository_values() {
    let record = sample_record(1);
    let count = EntityTypeCount {
        live: 2,
        deleted: 1,
    };
    let service = EntityRegistryServiceImpl::new(FakeRepo {
        get_many: vec![record.clone()],
        list: vec![record.clone()],
        count,
        ..FakeRepo::default()
    });

    assert_eq!(
        service.get_many(&[record.id]).await.unwrap(),
        vec![record.clone()]
    );
    assert_eq!(
        service
            .list_owned_by(&user_owner(), Some(RegisteredEntityType::Chat))
            .await
            .unwrap(),
        vec![record]
    );
    assert_eq!(
        service
            .count_by_type(RegisteredEntityType::Chat)
            .await
            .unwrap(),
        count
    );
}
