use std::collections::VecDeque;

use uuid::Uuid;

use super::*;

#[derive(Debug, thiserror::Error)]
#[error("the API refused the write")]
struct Refused;

fn id(n: u128) -> EntityId {
    EntityId(Uuid::from_u128(n))
}

/// What a fake API was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    Create(Vec<TitleOrBody>),
    Set(EntityId, TitleOrBody),
    Delete(EntityId),
    Close,
}

/// A document API that hands out ids 1, 2, ... and refuses the writes listed
/// in `refuse`, in order, each once.
#[derive(Default)]
struct FakeDocuments {
    calls: Vec<Call>,
    /// The texts of every create, in order.
    created: Vec<Vec<(TitleOrBody, Token)>>,
    next_id: u128,
    refuse: VecDeque<Call>,
}

impl FakeDocuments {
    fn refuses(&mut self, call: &Call) -> bool {
        if self.refuse.front() == Some(call) {
            self.refuse.pop_front();
            return true;
        }
        false
    }
}

impl CreatedWrites for FakeDocuments {
    type Field = TitleOrBody;
    type Err = Refused;

    const ENTITY_TYPE: EntityType = EntityType::Document;
    const FIELDS: &'static [TitleOrBody] = &[TitleOrBody::Body, TitleOrBody::Title];

    async fn create(&mut self, texts: &[(TitleOrBody, Token)]) -> Result<EntityId, Refused> {
        let call = Call::Create(texts.iter().map(|(field, _)| *field).collect());
        self.calls.push(call.clone());
        self.created.push(texts.to_vec());
        if self.refuses(&call) {
            return Err(Refused);
        }
        self.next_id += 1;
        Ok(id(self.next_id))
    }

    async fn set(&mut self, id: EntityId, field: TitleOrBody, _: &Token) -> Result<(), Refused> {
        let call = Call::Set(id, field);
        self.calls.push(call.clone());
        if self.refuses(&call) {
            return Err(Refused);
        }
        Ok(())
    }

    async fn delete(&mut self, id: EntityId) -> Result<(), Refused> {
        let call = Call::Delete(id);
        self.calls.push(call.clone());
        if self.refuses(&call) {
            return Err(Refused);
        }
        Ok(())
    }

    async fn close(&mut self) {
        self.calls.push(Call::Close);
    }
}

fn tokens(change: &Change, presence: Presence) -> Vec<Token> {
    change
        .checks
        .iter()
        .filter(|check| check.presence == presence)
        .filter_map(|check| match &check.query {
            SearchQuery::Text { token, .. } => Some(token.clone()),
            SearchQuery::Property { value, .. } => Some(value.clone()),
            SearchQuery::Prefix { .. } => None,
        })
        .collect()
}

#[tokio::test]
async fn a_document_is_created_edited_renamed_deleted_and_created_again() {
    let mut rotation = Created::new(FakeDocuments::default());
    let mut changes = Vec::new();
    for _ in 0..5 {
        changes.push(rotation.change().await.expect("every write succeeds"));
    }

    let operations: Vec<_> = changes.iter().map(|change| change.operation).collect();
    assert_eq!(
        operations,
        [
            Operation::Create,
            Operation::Edit,
            Operation::Rename,
            Operation::Delete,
            Operation::Create,
        ]
    );
    assert_eq!(
        rotation.api.calls,
        [
            Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title]),
            Call::Set(id(1), TitleOrBody::Body),
            Call::Set(id(1), TitleOrBody::Title),
            Call::Delete(id(1)),
            Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title]),
        ]
    );

    let [created, edited, renamed, deleted, recreated] = changes.as_slice() else {
        panic!("five changes");
    };
    let [body, title] = tokens(created, Presence::Present).try_into().expect("two");
    assert!(tokens(created, Presence::Absent).is_empty());

    // An edit wants the new body and not the one it replaced.
    let [new_body] = tokens(edited, Presence::Present).try_into().expect("one");
    assert_eq!(tokens(edited, Presence::Absent), [body]);

    let [new_title] = tokens(renamed, Presence::Present).try_into().expect("one");
    assert_eq!(tokens(renamed, Presence::Absent), [title]);

    // A delete wants every token it held gone.
    assert!(tokens(deleted, Presence::Present).is_empty());
    assert_eq!(tokens(deleted, Presence::Absent), [new_body, new_title]);
    assert!(deleted.checks.iter().all(|check| check.entity_id == id(1)));

    assert_eq!(recreated.entity_id, id(2));
}

#[tokio::test]
async fn a_failed_write_is_tried_again_next_round() {
    let mut rotation = Created::new(FakeDocuments {
        refuse: VecDeque::from([Call::Set(id(1), TitleOrBody::Body), Call::Delete(id(1))]),
        ..FakeDocuments::default()
    });

    let mut results = Vec::new();
    for _ in 0..6 {
        results.push(
            rotation
                .change()
                .await
                .map(|change| change.operation)
                .map_err(|skipped| match skipped {
                    NoChange::Failed(failed) => failed.operation,
                    NoChange::FixtureMissing(operation) => operation,
                }),
        );
    }

    // A failed edit starts the entity over; a failed delete is tried again.
    assert_eq!(
        results,
        [
            Ok(Operation::Create),
            Err(Operation::Edit),
            Err(Operation::Delete),
            Ok(Operation::Delete),
            Ok(Operation::Create),
            Ok(Operation::Edit),
        ]
    );
}

#[tokio::test]
async fn shutdown_deletes_the_entity_this_process_made_and_closes_the_api() {
    let mut rotation = Created::new(FakeDocuments::default());
    rotation.change().await.expect("created");

    rotation.clean_up().await;

    assert_eq!(rotation.api.calls[1..], [Call::Delete(id(1)), Call::Close]);
}

#[tokio::test]
async fn shutdown_after_a_delete_only_closes_the_api() {
    let mut rotation = Created::new(FakeDocuments::default());
    for _ in 0..4 {
        rotation.change().await.expect("every write succeeds");
    }

    rotation.clean_up().await;

    assert_eq!(rotation.api.calls.last(), Some(&Call::Close));
    assert_eq!(
        rotation
            .api
            .calls
            .iter()
            .filter(|call| matches!(call, Call::Delete(_)))
            .count(),
        1
    );
}

/// A fixture API holding `fixture`, which counts its lookups.
struct FakeSessions {
    fixture: Option<EntityId>,
    finds: u32,
    renames: Vec<EntityId>,
    refuse_rename: bool,
}

impl FixtureWrites for FakeSessions {
    type Err = Refused;

    const ENTITY_TYPE: EntityType = EntityType::AgentSession;

    async fn find(&mut self) -> Result<Option<EntityId>, Refused> {
        self.finds += 1;
        Ok(self.fixture)
    }

    async fn rename(&mut self, id: EntityId, _: &Token) -> Result<(), Refused> {
        self.renames.push(id);
        if std::mem::take(&mut self.refuse_rename) {
            return Err(Refused);
        }
        Ok(())
    }
}

#[tokio::test]
async fn a_missing_fixture_skips_the_rename_until_one_exists() {
    let mut rotation = Fixture::new(FakeSessions {
        fixture: None,
        finds: 0,
        renames: Vec::new(),
        refuse_rename: false,
    });

    let skipped = rotation.change().await.expect_err("no fixture");
    assert!(matches!(
        skipped,
        NoChange::FixtureMissing(Operation::Rename)
    ));

    rotation.api.fixture = Some(id(9));
    let first = rotation.change().await.expect("renamed");
    let second = rotation.change().await.expect("renamed");

    assert_eq!(rotation.api.finds, 2);
    assert_eq!(rotation.api.renames, [id(9), id(9)]);
    // The title before the first rename is unknown, so only later renames
    // want the old title gone.
    assert!(tokens(&first, Presence::Absent).is_empty());
    assert_eq!(
        tokens(&second, Presence::Absent),
        tokens(&first, Presence::Present)
    );
}

#[tokio::test]
async fn a_failed_rename_looks_the_fixture_up_again() {
    let mut rotation = Fixture::new(FakeSessions {
        fixture: Some(id(9)),
        finds: 0,
        renames: Vec::new(),
        refuse_rename: true,
    });

    rotation.change().await.expect_err("refused");
    let renamed = rotation.change().await.expect("renamed");

    assert_eq!(rotation.api.finds, 2);
    // The title after a failed rename is unknown, so no old title is checked.
    assert!(tokens(&renamed, Presence::Absent).is_empty());
}

/// A property API with one definition, refusing the first document create
/// when `refuse_create` is set and the first value when `refuse_set` is.
#[derive(Default)]
struct FakeProperties {
    refuse_create: bool,
    refuse_set: bool,
    refuse_delete: bool,
    definitions: u32,
    documents: Vec<EntityId>,
    sets: Vec<(EntityId, EntityId)>,
    deleted: Vec<EntityId>,
}

impl PropertyWrites for FakeProperties {
    type Err = Refused;

    async fn definition(&mut self) -> Result<EntityId, Refused> {
        self.definitions += 1;
        Ok(id(100))
    }

    async fn create_document(&mut self, _: &Token) -> Result<EntityId, Refused> {
        if std::mem::take(&mut self.refuse_create) {
            return Err(Refused);
        }
        let document = id(200 + self.documents.len() as u128);
        self.documents.push(document);
        Ok(document)
    }

    async fn set(
        &mut self,
        document: EntityId,
        definition: EntityId,
        _: &Token,
    ) -> Result<(), Refused> {
        self.sets.push((document, definition));
        if std::mem::take(&mut self.refuse_set) {
            return Err(Refused);
        }
        Ok(())
    }

    async fn delete_document(&mut self, document: EntityId) -> Result<(), Refused> {
        if std::mem::take(&mut self.refuse_delete) {
            return Err(Refused);
        }
        self.deleted.push(document);
        Ok(())
    }

    async fn close(&mut self) {}
}

#[tokio::test]
async fn a_property_value_is_replaced_every_round_on_one_document() {
    let mut rotation = PropertyValue::new(FakeProperties {
        refuse_create: true,
        ..FakeProperties::default()
    });

    let failed = rotation
        .change()
        .await
        .expect_err("the document create is refused");
    assert!(matches!(
        failed,
        NoChange::Failed(WriteFailed {
            operation: Operation::Edit,
            ..
        })
    ));

    let first = rotation.change().await.expect("set");
    let second = rotation.change().await.expect("set");
    rotation.clean_up().await;

    assert_eq!(rotation.api.documents, [id(200)]);
    assert_eq!(rotation.api.sets, [(id(200), id(100)); 2]);
    assert_eq!(rotation.api.deleted, [id(200)]);
    assert!(tokens(&first, Presence::Absent).is_empty());
    assert_eq!(
        tokens(&second, Presence::Absent),
        tokens(&first, Presence::Present)
    );

    let SearchQuery::Property {
        property_id, name, ..
    } = &second.checks[0].query
    else {
        panic!("a property search");
    };
    let SearchQuery::Property {
        name: first_name, ..
    } = &first.checks[0].query
    else {
        panic!("a property search");
    };
    assert_eq!(*property_id, id(100));
    assert_eq!(name, first_name);
}

#[tokio::test]
async fn a_failed_value_replaces_the_document_and_definition_next_round() {
    let mut rotation = PropertyValue::new(FakeProperties {
        refuse_set: true,
        ..FakeProperties::default()
    });

    rotation.change().await.expect_err("the value is refused");
    let next = rotation.change().await.expect("set on a new document");

    assert_eq!(rotation.api.documents, [id(200), id(201)]);
    assert_eq!(rotation.api.deleted, [id(200)]);
    assert_eq!(rotation.api.definitions, 2);
    assert_eq!(next.entity_id, id(201));
    assert!(tokens(&next, Presence::Absent).is_empty());
}

#[tokio::test]
async fn a_replaced_document_that_would_not_delete_is_deleted_later() {
    let mut rotation = PropertyValue::new(FakeProperties {
        refuse_set: true,
        refuse_delete: true,
        ..FakeProperties::default()
    });

    rotation.change().await.expect_err("the value is refused");
    assert!(rotation.api.deleted.is_empty());
    rotation.change().await.expect("set on a new document");
    rotation.clean_up().await;

    // The first document is deleted before the next round's, and the second
    // at shutdown.
    assert_eq!(rotation.api.deleted, [id(200), id(201)]);
}

fn prefix() -> CrowdedPrefix {
    CrowdedPrefix::new("con").expect("a prefix")
}

/// One round of `rotation` as the probe runs it: housekeeping, then the
/// change.
async fn round<R: Rotation>(rotation: &mut R) -> Result<Change, NoChange> {
    rotation.prepare().await;
    rotation.change().await
}

#[tokio::test]
async fn a_late_prefix_word_is_a_new_document_each_round_found_by_the_prefix() {
    let mut rotation = LatePrefixWord::new(FakeDocuments::default(), prefix());

    let first = round(&mut rotation).await.expect("created");
    let second = round(&mut rotation).await.expect("created");
    rotation.clean_up().await;

    assert_eq!(first.operation, Operation::CrowdedPrefix);
    assert_eq!(
        first.checks,
        [Check {
            query: SearchQuery::Prefix {
                entity_type: EntityType::Document,
                prefix: prefix(),
                entity_id: id(1),
            },
            entity_id: id(1),
            presence: Presence::Present,
        }]
    );
    assert_eq!(second.entity_id, id(2));
    // The late word is the body, which the content search reads; the title
    // is a token of its own.
    let [(TitleOrBody::Body, body), (TitleOrBody::Title, title)] =
        rotation.api.created[0].as_slice()
    else {
        panic!("a body and a title");
    };
    assert!(body.as_str().starts_with("conzz"));
    assert_ne!(title, body);
    // Each round deletes the last round's document first, and shutdown the
    // current one.
    assert_eq!(
        rotation.api.calls,
        [
            Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title]),
            Call::Delete(id(1)),
            Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title]),
            Call::Delete(id(2)),
            Call::Close,
        ]
    );
}

#[tokio::test]
async fn a_round_that_could_not_delete_the_last_document_fails_instead_of_adding_one() {
    let mut rotation = LatePrefixWord::new(
        FakeDocuments {
            refuse: VecDeque::from([Call::Delete(id(1))]),
            ..FakeDocuments::default()
        },
        prefix(),
    );

    round(&mut rotation).await.expect("created");
    let blocked = round(&mut rotation)
        .await
        .expect_err("the last document is still there");
    let next = round(&mut rotation)
        .await
        .expect("created once it is deleted");

    assert!(matches!(
        blocked,
        NoChange::Failed(WriteFailed {
            operation: Operation::CrowdedPrefix,
            ..
        })
    ));
    assert_eq!(next.entity_id, id(2));
    assert_eq!(
        rotation.api.calls,
        [
            Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title]),
            Call::Delete(id(1)),
            Call::Delete(id(1)),
            Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title]),
        ]
    );
}

#[tokio::test]
async fn a_failed_late_prefix_create_is_its_own_operation() {
    let mut rotation = LatePrefixWord::new(
        FakeDocuments {
            refuse: VecDeque::from([Call::Create(vec![TitleOrBody::Body, TitleOrBody::Title])]),
            ..FakeDocuments::default()
        },
        prefix(),
    );

    let failed = round(&mut rotation).await.expect_err("refused");

    assert!(matches!(
        failed,
        NoChange::Failed(WriteFailed {
            operation: Operation::CrowdedPrefix,
            ..
        })
    ));
}
