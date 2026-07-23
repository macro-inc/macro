use super::*;
use async_graphql::dataloader::Loader;

struct FailingFavoriteReader;

impl EntityFavoriteEdgeReader for FailingFavoriteReader {
    async fn get_entity_favorites(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _keys: Vec<EntityFavoriteKey>,
    ) -> Result<HashMap<EntityFavoriteKey, bool>, rootcause::Report> {
        Err(rootcause::report!("favorites unavailable"))
    }
}

#[tokio::test]
async fn favorite_loader_fails_soft_when_reader_is_unavailable() {
    let key = EntityFavoriteKey {
        entity_type: EntityType::Document,
        entity_id: "document-1".to_owned(),
    };
    let loader = EntityFavoriteLoader::new(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        FailingFavoriteReader,
    );

    let result = loader.load(std::slice::from_ref(&key)).await.unwrap();

    assert_eq!(result.get(&key), Some(&false));
}
