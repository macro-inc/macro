use super::*;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};

fn access(user: &str, document: &str, level: AccessLevel) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user.to_owned().try_into().unwrap()),
        Entity {
            entity_id: document.into(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .unwrap()
}

#[test]
fn annotation_owner_cannot_delete_someone_elses_discussion() {
    let user = "macro|author@example.com";
    let target = AnnotationTarget {
        id: Uuid::from_u128(1),
        document_id: "legacy-document".into(),
        owner: user.into(),
        thread_id: Some(Uuid::from_u128(2)),
        thread_owner: Some("macro|other@example.com".into()),
    };
    assert!(matches!(
        authorize(
            access(user, "legacy-document", AccessLevel::Comment),
            target.clone(),
            true
        ),
        Err(MessageError::Forbidden)
    ));
    assert!(
        authorize(
            access(user, "legacy-document", AccessLevel::Comment),
            target.clone(),
            false
        )
        .is_ok()
    );
    assert!(
        authorize(
            access(user, "legacy-document", AccessLevel::Owner),
            target.clone(),
            true
        )
        .is_ok()
    );
    assert!(matches!(
        authorize(
            access(user, "other-document", AccessLevel::Owner),
            target,
            true
        ),
        Err(MessageError::Forbidden)
    ));
}
