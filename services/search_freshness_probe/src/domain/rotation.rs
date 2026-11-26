//! Each entity type's cycle of changes, and the checks each change leaves for
//! search: the new token matches, the token it replaced does not, and a
//! deleted entity matches nothing.

use super::model::{
    Change, Check, CrowdedPrefix, EntityId, EntityType, Operation, Presence, SearchQuery, Token,
};
use super::ports::{
    Body, CreatedWrites, FixtureWrites, NoChange, PropertyWrites, Rotation, TextField, Title,
    TitleOrBody, WriteFailed,
};

#[cfg(test)]
mod test;

impl TextField for Title {
    fn operation(self) -> Operation {
        Operation::Rename
    }
}

impl TextField for Body {
    fn operation(self) -> Operation {
        Operation::Edit
    }
}

impl TextField for TitleOrBody {
    fn operation(self) -> Operation {
        match self {
            Self::Title => Operation::Rename,
            Self::Body => Operation::Edit,
        }
    }
}

fn text_check(entity_type: EntityType, token: &Token, id: EntityId, presence: Presence) -> Check {
    Check {
        query: SearchQuery::Text {
            entity_type,
            token: token.clone(),
        },
        entity_id: id,
        presence,
    }
}

fn failed<E: std::error::Error + Send + Sync + 'static>(
    operation: Operation,
) -> impl FnOnce(E) -> WriteFailed {
    move |error| WriteFailed {
        operation,
        error: Box::new(error),
    }
}

/// The entity a [`Created`] rotation made, and the token in each field.
struct Live<F> {
    id: EntityId,
    texts: Vec<(F, Token)>,
}

/// An entity the probe creates, changes one field at a time, deletes for
/// good, and creates again. At most one exists per process; shutdown deletes
/// it.
pub struct Created<A: CreatedWrites> {
    api: A,
    live: Option<Live<A::Field>>,
    /// Index of the next field to change; past the last, the entity is
    /// deleted next.
    next_field: usize,
}

impl<A: CreatedWrites> Created<A> {
    /// A rotation that starts by creating its entity.
    pub fn new(api: A) -> Self {
        Self {
            api,
            live: None,
            next_field: 0,
        }
    }

    async fn create(&mut self) -> Result<Change, NoChange> {
        let texts: Vec<_> = A::FIELDS
            .iter()
            .map(|field| (*field, Token::random()))
            .collect();
        let id = self
            .api
            .create(&texts)
            .await
            .map_err(failed(Operation::Create))?;

        let checks = texts
            .iter()
            .map(|(_, token)| text_check(A::ENTITY_TYPE, token, id, Presence::Present))
            .collect();
        self.live = Some(Live { id, texts });
        self.next_field = 0;
        Ok(Change {
            operation: Operation::Create,
            entity_id: id,
            checks,
        })
    }

    async fn delete(&mut self, id: EntityId) -> Result<Change, NoChange> {
        self.api
            .delete(id)
            .await
            .map_err(failed(Operation::Delete))?;

        let texts = self.live.take().map(|live| live.texts).unwrap_or_default();
        Ok(Change {
            operation: Operation::Delete,
            entity_id: id,
            checks: texts
                .iter()
                .map(|(_, token)| text_check(A::ENTITY_TYPE, token, id, Presence::Absent))
                .collect(),
        })
    }
}

impl<A: CreatedWrites> Rotation for Created<A> {
    fn entity_type(&self) -> EntityType {
        A::ENTITY_TYPE
    }

    async fn change(&mut self) -> Result<Change, NoChange> {
        let Some(live) = self.live.as_ref() else {
            return self.create().await;
        };
        let id = live.id;
        let Some((field, old)) = live.texts.get(self.next_field).cloned() else {
            // A delete that failed is tried again next round; one that took
            // effect before failing succeeds then, on an entity already gone.
            return self.delete(id).await;
        };

        let operation = field.operation();
        let new = Token::random();
        if let Err(error) = self.api.set(id, field, &new).await {
            // The entity may be gone or broken: delete it next round and
            // start over with a new one, rather than failing on it forever.
            self.next_field = live.texts.len();
            return Err(failed(operation)(error).into());
        }

        if let Some(live) = self.live.as_mut()
            && let Some(slot) = live.texts.get_mut(self.next_field)
        {
            slot.1 = new.clone();
        }
        self.next_field += 1;
        Ok(Change {
            operation,
            entity_id: id,
            checks: vec![
                text_check(A::ENTITY_TYPE, &new, id, Presence::Present),
                text_check(A::ENTITY_TYPE, &old, id, Presence::Absent),
            ],
        })
    }

    async fn clean_up(&mut self) {
        if let Some(live) = self.live.take()
            && let Err(error) = self.api.delete(live.id).await
        {
            tracing::warn!(
                error = ?error,
                entity_type = A::ENTITY_TYPE.as_str(),
                entity_id = %live.id,
                "the probe could not delete its entity at shutdown"
            );
        }
        self.api.close().await;
    }
}

/// An entity seeded once for the probe user, because the probe cannot create
/// one every minute, renamed every round.
pub struct Fixture<A: FixtureWrites> {
    api: A,
    id: Option<EntityId>,
    /// The title the probe last gave it; unknown until its first rename.
    title: Option<Token>,
}

impl<A: FixtureWrites> Fixture<A> {
    /// A rotation that looks for its fixture until it finds one.
    pub fn new(api: A) -> Self {
        Self {
            api,
            id: None,
            title: None,
        }
    }
}

impl<A: FixtureWrites> Rotation for Fixture<A> {
    fn entity_type(&self) -> EntityType {
        A::ENTITY_TYPE
    }

    async fn change(&mut self) -> Result<Change, NoChange> {
        let id = match self.id {
            Some(id) => id,
            None => self
                .api
                .find()
                .await
                .map_err(failed(Operation::Rename))?
                .ok_or(NoChange::FixtureMissing(Operation::Rename))?,
        };

        let new = Token::random();
        if let Err(error) = self.api.rename(id, &new).await {
            // The fixture may have been archived or deleted: look it up again
            // next round.
            self.id = None;
            self.title = None;
            return Err(failed(Operation::Rename)(error).into());
        }
        self.id = Some(id);

        let mut checks = vec![text_check(A::ENTITY_TYPE, &new, id, Presence::Present)];
        if let Some(old) = self.title.replace(new) {
            checks.push(text_check(A::ENTITY_TYPE, &old, id, Presence::Absent));
        }
        Ok(Change {
            operation: Operation::Rename,
            entity_id: id,
            checks,
        })
    }

    async fn clean_up(&mut self) {}
}

/// The document a [`PropertyValue`] rotation sets its property on.
struct Holder {
    id: EntityId,
    name: Token,
}

/// A text property value on a document of the probe's own, set to a new
/// token every round. Shutdown deletes the document; the definition stays,
/// found by name next time.
pub struct PropertyValue<A: PropertyWrites> {
    api: A,
    definition: Option<EntityId>,
    holder: Option<Holder>,
    value: Option<Token>,
    /// Documents this process replaced but could not delete yet.
    stale: Vec<EntityId>,
}

impl<A: PropertyWrites> PropertyValue<A> {
    /// A rotation that prepares its definition and document on the first
    /// round.
    pub fn new(api: A) -> Self {
        Self {
            api,
            definition: None,
            holder: None,
            value: None,
            stale: Vec::new(),
        }
    }

    /// Deletes the replaced documents, keeping the ones that fail for later.
    async fn delete_stale(&mut self) {
        let mut kept = Vec::new();
        for document in std::mem::take(&mut self.stale) {
            if let Err(error) = self.api.delete_document(document).await {
                tracing::warn!(error = ?error, entity_id = %document, "the probe could not delete a property document it replaced");
                kept.push(document);
            }
        }
        self.stale = kept;
    }

    fn check(definition: EntityId, holder: &Holder, value: &Token, presence: Presence) -> Check {
        Check {
            query: SearchQuery::Property {
                property_id: definition,
                name: holder.name.clone(),
                value: value.clone(),
            },
            entity_id: holder.id,
            presence,
        }
    }
}

impl<A: PropertyWrites> Rotation for PropertyValue<A> {
    fn entity_type(&self) -> EntityType {
        EntityType::Property
    }

    async fn change(&mut self) -> Result<Change, NoChange> {
        self.delete_stale().await;
        let definition = match self.definition {
            Some(definition) => definition,
            None => self
                .api
                .definition()
                .await
                .map_err(failed(Operation::Edit))?,
        };
        self.definition = Some(definition);

        let holder = match self.holder.take() {
            Some(holder) => holder,
            None => {
                let name = Token::random();
                let id = self
                    .api
                    .create_document(&name)
                    .await
                    .map_err(failed(Operation::Edit))?;
                self.value = None;
                Holder { id, name }
            }
        };

        let new = Token::random();
        let written = self.api.set(holder.id, definition, &new).await;
        let entity_id = holder.id;
        let mut checks = vec![Self::check(definition, &holder, &new, Presence::Present)];
        if let Some(old) = &self.value {
            checks.push(Self::check(definition, &holder, old, Presence::Absent));
        }
        if let Err(error) = written {
            // The document or the definition may be gone: replace both next
            // round, and delete this document so it does not linger.
            self.stale.push(holder.id);
            self.delete_stale().await;
            self.definition = None;
            self.value = None;
            return Err(failed(Operation::Edit)(error).into());
        }
        self.holder = Some(holder);

        self.value = Some(new);
        Ok(Change {
            operation: Operation::Edit,
            entity_id,
            checks,
        })
    }

    async fn clean_up(&mut self) {
        if let Some(holder) = self.holder.take() {
            self.stale.push(holder.id);
        }
        self.delete_stale().await;
        self.api.close().await;
    }
}

/// An earlier round's document is still there: a new one would pile up.
#[derive(Debug, thiserror::Error)]
#[error("{0} earlier crowded-prefix documents could not be deleted")]
pub struct NotDeleted(usize);

/// A document whose body is one word sorting late under a crowded prefix,
/// made new every round and searched for by the prefix alone. Search that
/// expands only the first few hundred words of a shard starting with the
/// prefix, before any permission check, never reaches it: the exact-token
/// rounds cannot see that, this one does. Each round first deletes the last
/// round's document, unmeasured, and fails rather than create another while
/// one is left.
pub struct LatePrefixWord<A: CreatedWrites<Field = TitleOrBody>> {
    api: A,
    prefix: CrowdedPrefix,
    /// The document this round made.
    current: Option<EntityId>,
    /// Documents of earlier rounds not deleted yet.
    stale: Vec<EntityId>,
}

impl<A: CreatedWrites<Field = TitleOrBody>> LatePrefixWord<A> {
    /// A rotation searching documents for `prefix`.
    pub fn new(api: A, prefix: CrowdedPrefix) -> Self {
        Self {
            api,
            prefix,
            current: None,
            stale: Vec::new(),
        }
    }

    /// Deletes the earlier rounds' documents, keeping the ones that fail.
    async fn delete_stale(&mut self) {
        self.stale.extend(self.current.take());
        let mut kept = Vec::new();
        for document in std::mem::take(&mut self.stale) {
            if let Err(error) = self.api.delete(document).await {
                tracing::warn!(error = ?error, entity_id = %document, "the probe could not delete a crowded-prefix document");
                kept.push(document);
            }
        }
        self.stale = kept;
    }
}

impl<A: CreatedWrites<Field = TitleOrBody>> Rotation for LatePrefixWord<A> {
    fn entity_type(&self) -> EntityType {
        A::ENTITY_TYPE
    }

    async fn prepare(&mut self) {
        self.delete_stale().await;
    }

    async fn change(&mut self) -> Result<Change, NoChange> {
        if !self.stale.is_empty() {
            return Err(failed(Operation::CrowdedPrefix)(NotDeleted(self.stale.len())).into());
        }

        let texts = [
            (TitleOrBody::Body, Token::after(&self.prefix)),
            (TitleOrBody::Title, Token::random()),
        ];
        let id = self
            .api
            .create(&texts)
            .await
            .map_err(failed(Operation::CrowdedPrefix))?;
        self.current = Some(id);

        Ok(Change {
            operation: Operation::CrowdedPrefix,
            entity_id: id,
            checks: vec![Check {
                query: SearchQuery::Prefix {
                    entity_type: A::ENTITY_TYPE,
                    prefix: self.prefix.clone(),
                    entity_id: id,
                },
                entity_id: id,
                presence: Presence::Present,
            }],
        })
    }

    async fn clean_up(&mut self) {
        self.delete_stale().await;
        self.api.close().await;
    }
}
