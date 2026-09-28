use super::*;
use async_graphql::dataloader::Loader;
use model_entity::EntityType;

struct FailingFavoriteReader;

impl EntityFavoriteEdgeReader for FailingFavoriteReader {
    async fn get_entity_favorites(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, bool>, rootcause::Report> {
        Err(rootcause::report!("favorites unavailable"))
    }
}

#[tokio::test]
async fn favorite_loader_fails_soft_when_reader_is_unavailable() {
    let entity = EntityType::Document.with_entity_string("document-1".to_owned());
    let key = OwnedEntity::from(entity);
    let loader = EntityFavoriteLoader::new(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        FailingFavoriteReader,
    );

    let result = loader.load(std::slice::from_ref(&key)).await.unwrap();

    assert_eq!(result.get(&key), Some(&false));
}
