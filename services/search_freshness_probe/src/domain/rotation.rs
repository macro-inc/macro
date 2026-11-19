//! Each entity type's cycle of changes, and the checks each change leaves for
//! search: the new token matches, the token it replaced does not, and a
//! deleted entity matches nothing.

use super::model::{Change, Check, EntityId, EntityType, Operation, Presence, SearchQuery, Token};
use super::ports::{
    Body, CreatedWrites, FixtureWrites, PropertyWrites, Rotation, TextField, Title, TitleOrBody,
    WriteFailed,
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

    async fn create(&mut self) -> Result<Change, WriteFailed> {
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

    async fn delete(&mut self, id: EntityId) -> Result<Change, WriteFailed> {
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

    async fn change(&mut self) -> Result<Change, WriteFailed> {
        let Some(live) = self.live.as_ref() else {
            return self.create().await;
        };
        let id = live.id;
        // A failed write leaves the entity's state unknown, so the same step
        // is tried again next round: a set with a fresh token, or a delete,
        // which succeeds on an entity already gone.
        let Some((field, old)) = live.texts.get(self.next_field).cloned() else {
            return self.delete(id).await;
        };

        let operation = field.operation();
        let new = Token::random();
        self.api
            .set(id, field, &new)
            .await
            .map_err(failed(operation))?;

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

/// The probe user has no fixture of the type.
#[derive(Debug, thiserror::Error)]
#[error("the probe user has no {0:?} fixture named with the probe's marker")]
pub struct NoFixture(EntityType);

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

    async fn change(&mut self) -> Result<Change, WriteFailed> {
        let id = match self.id {
            Some(id) => id,
            None => self
                .api
                .find()
                .await
                .map_err(failed(Operation::Rename))?
                .ok_or_else(|| failed(Operation::Rename)(NoFixture(A::ENTITY_TYPE)))?,
        };
        self.id = Some(id);

        let new = Token::random();
        self.api
            .rename(id, &new)
            .await
            .map_err(failed(Operation::Rename))?;

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
        }
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

    async fn change(&mut self) -> Result<Change, WriteFailed> {
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
        self.holder = Some(holder);
        written.map_err(failed(Operation::Edit))?;

        self.value = Some(new);
        Ok(Change {
            operation: Operation::Edit,
            entity_id,
            checks,
        })
    }

    async fn clean_up(&mut self) {
        if let Some(holder) = self.holder.take()
            && let Err(error) = self.api.delete_document(holder.id).await
        {
            tracing::warn!(
                error = ?error,
                entity_id = %holder.id,
                "the probe could not delete its property document at shutdown"
            );
        }
    }
}
