use std::sync::{Arc, Mutex};

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, schema::generate_validated_input_schema,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use uuid::Uuid;

use super::{FavoritableEntityType, FavoritesToolContext, SetFavorite};
use crate::domain::{
    models::{Favorite, FavoritesError, FavoritesMutationActor, SetFavoriteResult},
    ports::FavoritesMutationService,
};

const USER: &str = "macro|favoriter@example.com";

#[derive(Default)]
struct RecordingFavorites {
    calls: Mutex<Vec<(FavoritesMutationActor, Entity<'static>, bool)>>,
    unauthorized: bool,
}

impl FavoritesMutationService for RecordingFavorites {
    async fn set_favorite(
        &self,
        actor: FavoritesMutationActor,
        entity: Entity<'static>,
        favorite: bool,
    ) -> Result<SetFavoriteResult, FavoritesError> {
        if self.unauthorized {
            return Err(FavoritesError::Unauthorized);
        }
        self.calls
            .lock()
            .unwrap()
            .push((actor, entity.clone(), favorite));
        Ok(SetFavoriteResult {
            favorite: favorite.then(|| Favorite {
                entity_type: entity.entity_type,
                entity_id: entity.entity_id.to_string(),
                sort_order: 1.0,
                created_at: chrono::Utc::now(),
                file_type: None,
                document_sub_type: None,
                channel_type: None,
                channel_id: None,
            }),
            entity,
        })
    }

    async fn reorder_favorites(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _ordered: Vec<Entity<'static>>,
    ) -> Result<Vec<Favorite>, FavoritesError> {
        unimplemented!("the favorites toolset never reorders")
    }
}

fn request() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from(USER.to_owned()).unwrap())
}

#[test]
fn set_favorite_schema_is_valid() {
    let validated = generate_validated_input_schema::<SetFavorite>().expect("valid schema");
    assert_eq!(validated.name, "SetFavorite");
}

#[tokio::test]
async fn set_favorite_favorites_the_item_for_the_user() {
    let service = Arc::new(RecordingFavorites::default());
    let entity_id = Uuid::now_v7();

    let response = SetFavorite {
        entity_type: FavoritableEntityType::Email,
        entity_id,
        favorite: true,
    }
    .call(
        ServiceContext(FavoritesToolContext::new(service.clone())),
        request(),
    )
    .await
    .expect("viewers can favorite");

    assert!(response.favorite);
    let calls = service.calls.lock().unwrap();
    let [(actor, entity, favorite)] = calls.as_slice() else {
        panic!("expected one call, got {}", calls.len());
    };
    assert_eq!(actor.user_id.as_ref(), USER);
    assert_eq!(entity.entity_type, EntityType::EmailThread);
    assert_eq!(entity.entity_id, entity_id.to_string());
    assert!(*favorite);
}

#[tokio::test]
async fn set_favorite_false_unfavorites() {
    let service = Arc::new(RecordingFavorites::default());

    let response = SetFavorite {
        entity_type: FavoritableEntityType::Document,
        entity_id: Uuid::now_v7(),
        favorite: false,
    }
    .call(
        ServiceContext(FavoritesToolContext::new(service.clone())),
        request(),
    )
    .await
    .expect("unfavoriting succeeds");

    assert!(!response.favorite);
    assert!(!service.calls.lock().unwrap()[0].2);
}

#[tokio::test]
async fn set_favorite_explains_missing_access() {
    let service = Arc::new(RecordingFavorites {
        unauthorized: true,
        ..RecordingFavorites::default()
    });

    let error = SetFavorite {
        entity_type: FavoritableEntityType::Project,
        entity_id: Uuid::now_v7(),
        favorite: true,
    }
    .call(
        ServiceContext(FavoritesToolContext::new(service)),
        request(),
    )
    .await
    .expect_err("no access");

    assert!(error.description.contains("view access"));
}
