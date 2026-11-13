use super::*;
use crate::domain::ports::EntityAudienceLookup;

#[tokio::test]
async fn many_documents_share_one_grant_lookup_and_keep_their_spelling() {
    let users = vec![user_id("macro|alice@corp.test")];
    let repo = MockRepo::new().with_document_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo.clone());

    let audiences = service
        .get_entity_audiences(
            EntityType::Document,
            &[
                "0000000A-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000002",
                "0000000a-0000-0000-0000-000000000001",
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        audiences,
        vec![EntityAudience {
            entity_ids: vec![
                "0000000A-0000-0000-0000-000000000001".to_string(),
                "00000000-0000-0000-0000-000000000002".to_string(),
            ],
            users,
        }]
    );
    assert_eq!(repo.grant_audience_lookups.lock().await.len(), 1);
}

#[tokio::test]
async fn kinds_with_their_own_audience_and_single_entities_resolve_one_at_a_time() {
    let users = vec![user_id("macro|alice@corp.test")];
    let repo = MockRepo::new()
        .with_thread_users(users.clone())
        .with_document_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo.clone());

    let threads = service
        .get_entity_audiences(
            EntityType::EmailThread,
            &[
                "00000000-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000002",
            ],
        )
        .await
        .unwrap();
    let document = service
        .get_entity_audiences(
            EntityType::Document,
            &["00000000-0000-0000-0000-000000000003"],
        )
        .await
        .unwrap();

    assert_eq!(
        threads,
        vec![
            EntityAudience {
                entity_ids: vec!["00000000-0000-0000-0000-000000000001".to_string()],
                users: users.clone(),
            },
            EntityAudience {
                entity_ids: vec!["00000000-0000-0000-0000-000000000002".to_string()],
                users: users.clone(),
            },
        ]
    );
    assert_eq!(
        document,
        vec![EntityAudience {
            entity_ids: vec!["00000000-0000-0000-0000-000000000003".to_string()],
            users,
        }]
    );
    assert!(repo.grant_audience_lookups.lock().await.is_empty());
}
