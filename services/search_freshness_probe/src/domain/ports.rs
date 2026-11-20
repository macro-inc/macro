//! What the probe needs from the outside: search, the entity writes, and
//! somewhere to record rounds.

use std::future::Future;

use super::model::{Change, EntityId, EntityType, Operation, Round, SearchQuery, Token};

/// Search as the probe user sees it.
pub trait Search: Send + Sync {
    /// Why a search failed.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The ids of the entities `query` returns.
    fn hits(
        &self,
        query: &SearchQuery,
    ) -> impl Future<Output = Result<Vec<EntityId>, Self::Err>> + Send;
}

/// A write that failed, and which one it was.
#[derive(Debug, thiserror::Error)]
#[error("the probe's {operation:?} write failed")]
pub struct WriteFailed {
    /// The change attempted.
    pub operation: Operation,
    /// Why it failed.
    #[source]
    pub error: Box<dyn std::error::Error + Send + Sync>,
}

/// Why a round made no change.
#[derive(Debug)]
pub enum NoChange {
    /// A write failed: the probe's own failure.
    Failed(WriteFailed),
    /// The probe user has no fixture for the type yet, so there is nothing to
    /// probe; not a failure.
    FixtureMissing(Operation),
}

impl From<WriteFailed> for NoChange {
    fn from(failed: WriteFailed) -> Self {
        Self::Failed(failed)
    }
}

/// One entity type's cycle of changes.
pub trait Rotation: Send {
    /// The type it changes.
    fn entity_type(&self) -> EntityType;

    /// Housekeeping before the round's timed write, such as deleting an
    /// earlier round's entity.
    fn prepare(&mut self) -> impl Future<Output = ()> + Send {
        async {}
    }

    /// Makes the next change in the cycle, and says what search must show
    /// once it is indexed.
    fn change(&mut self) -> impl Future<Output = Result<Change, NoChange>> + Send;

    /// Deletes what this process created, at shutdown. Fixtures stay.
    fn clean_up(&mut self) -> impl Future<Output = ()> + Send;
}

/// Where finished rounds go.
pub trait RoundSink: Send + Sync {
    /// Records one round.
    fn record(&self, round: Round);
}

/// A text an entity keeps in search, and the change that rewrites it.
pub trait TextField: Copy + Eq + std::fmt::Debug + Send + Sync + 'static {
    /// The operation a new value is.
    fn operation(self) -> Operation;
}

/// The title of an entity whose only indexed text is its title.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Title;

/// The text of an entity whose only indexed text is its body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Body;

/// One of the two texts of an entity that has both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleOrBody {
    /// Its name.
    Title,
    /// Its content.
    Body,
}

/// Writes to an entity type the probe creates and deletes itself.
pub trait CreatedWrites: Send {
    /// The texts it indexes.
    type Field: TextField;
    /// Why a write failed.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The type written.
    const ENTITY_TYPE: EntityType;
    /// Every indexed text, in the order the rotation changes them.
    const FIELDS: &'static [Self::Field];

    /// Creates an entity holding `texts`, one token per field.
    fn create(
        &mut self,
        texts: &[(Self::Field, Token)],
    ) -> impl Future<Output = Result<EntityId, Self::Err>> + Send;

    /// Replaces one field's token.
    fn set(
        &mut self,
        id: EntityId,
        field: Self::Field,
        token: &Token,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Removes the entity for good, not to the Trash, which the index keeps.
    /// An entity already gone counts as deleted.
    fn delete(&mut self, id: EntityId) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Releases what the writes needed besides the entity (a message's
    /// channel), at shutdown.
    fn close(&mut self) -> impl Future<Output = ()> + Send;
}

/// Writes to an entity seeded once for the probe user and named with
/// [`super::model::MARKER`].
pub trait FixtureWrites: Send {
    /// Why a write failed.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The type written.
    const ENTITY_TYPE: EntityType;

    /// The fixture, if the probe user has one.
    fn find(&mut self) -> impl Future<Output = Result<Option<EntityId>, Self::Err>> + Send;

    /// Gives it a new title.
    fn rename(
        &mut self,
        id: EntityId,
        title: &Token,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Writes for the property probe: a text property on a document of its own.
pub trait PropertyWrites: Send {
    /// Why a write failed.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The probe's text property definition, found by its name or created.
    fn definition(&mut self) -> impl Future<Output = Result<EntityId, Self::Err>> + Send;

    /// A document titled with `name` to hold the value.
    fn create_document(
        &mut self,
        name: &Token,
    ) -> impl Future<Output = Result<EntityId, Self::Err>> + Send;

    /// Sets the property's value on `document`.
    fn set(
        &mut self,
        document: EntityId,
        definition: EntityId,
        value: &Token,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Deletes the document for good; one already gone counts as deleted.
    fn delete_document(
        &mut self,
        document: EntityId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Releases what the writes needed besides the document, at shutdown.
    fn close(&mut self) -> impl Future<Output = ()> + Send;
}
