use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<ChannelCategoryLayout>>);

impl ChannelCategoryRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn get_layout(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> Result<ChannelCategoryLayout, Self::Err> {
        Ok(self.0.lock().unwrap().clone())
    }

    async fn replace_layout(
        &self,
        _user_id: MacroUserIdStr<'_>,
        layout: ChannelCategoryLayout,
    ) -> Result<ReplaceLayoutOutcome, Self::Err> {
        let mut current = self.0.lock().unwrap();
        if layout.revision != current.revision {
            return Ok(ReplaceLayoutOutcome::Conflict);
        }
        let mut saved = layout;
        saved.revision += 1;
        *current = saved.clone();
        Ok(ReplaceLayoutOutcome::Replaced(saved))
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|category@test.com".to_owned()).unwrap()
}

#[tokio::test]
async fn stale_layout_revision_is_rejected_without_overwriting_newer_state() {
    let repo = FakeRepo::default();
    let service = ChannelCategoryServiceImpl::new(repo.clone());
    let first = service
        .replace_layout(
            user(),
            ChannelCategoryLayout {
                revision: 0,
                categories: vec![],
                placements: vec![],
            },
        )
        .await
        .unwrap();
    assert_eq!(first.revision, 1);

    let stale = service
        .replace_layout(
            user(),
            ChannelCategoryLayout {
                revision: 0,
                categories: vec![],
                placements: vec![],
            },
        )
        .await;
    assert!(matches!(stale, Err(ChannelCategoryError::Conflict)));
    assert_eq!(service.get_layout(user()).await.unwrap().revision, 1);
}

#[test]
fn names_are_trimmed_and_blank_names_are_rejected() {
    assert_eq!(
        ChannelCategoryName::parse("  Customer work  ")
            .unwrap()
            .as_str(),
        "Customer work"
    );
    assert!(ChannelCategoryName::parse("   ").is_err());
}

#[tokio::test]
async fn layout_persists_categories_uncategorized_and_order() {
    let repo = FakeRepo::default();
    let service = ChannelCategoryServiceImpl::new(repo.clone());
    let category_id = Uuid::new_v4();
    let categorized = Uuid::new_v4();
    let uncategorized = Uuid::new_v4();
    let expected = ChannelCategoryLayout {
        revision: 0,
        categories: vec![ChannelCategory {
            id: category_id,
            name: " Work ".into(),
        }],
        placements: vec![
            ChannelPlacement {
                channel_id: uncategorized,
                category_id: None,
            },
            ChannelPlacement {
                channel_id: categorized,
                category_id: Some(category_id),
            },
        ],
    };

    let saved = service.replace_layout(user(), expected).await.unwrap();
    assert_eq!(saved.categories[0].name, "Work");
    assert_eq!(saved.placements[0].channel_id, categorized);
    assert_eq!(saved.placements[1].channel_id, uncategorized);
    assert_eq!(service.get_layout(user()).await.unwrap(), saved);
}

#[tokio::test]
async fn duplicate_and_unknown_ids_are_rejected_before_writing() {
    let repo = FakeRepo::default();
    let service = ChannelCategoryServiceImpl::new(repo.clone());
    let category_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let result = service
        .replace_layout(
            user(),
            ChannelCategoryLayout {
                revision: 0,
                categories: vec![ChannelCategory {
                    id: category_id,
                    name: "Work".into(),
                }],
                placements: vec![
                    ChannelPlacement {
                        channel_id,
                        category_id: Some(Uuid::new_v4()),
                    },
                    ChannelPlacement {
                        channel_id,
                        category_id: Some(category_id),
                    },
                ],
            },
        )
        .await;
    assert!(matches!(result, Err(ChannelCategoryError::Invalid(_))));
    assert_eq!(*repo.0.lock().unwrap(), ChannelCategoryLayout::default());
}
