//! This module provides a utility trait for converting potentially borrowed lifetimes into static ones
use super::*;

/// Trait for creating a statically owned version of self
pub trait IntoOwned {
    /// the output owned type
    type Owned;
    /// convert self into an owned version
    fn into_owned(self) -> Self::Owned;
}

impl IntoOwned for Entity<'_> {
    type Owned = Entity<'static>;
    fn into_owned(self) -> Self::Owned {
        Entity {
            entity_type: self.entity_type,
            entity_id: Cow::Owned(self.entity_id.into_owned()),
        }
    }
}

impl IntoOwned for EntityConnection<'_> {
    type Owned = EntityConnection<'static>;

    fn into_owned(self) -> Self::Owned {
        EntityConnection {
            extra: self.extra.into_owned(),
            connection_id: Cow::Owned(self.connection_id.into_owned()),
        }
    }
}

impl IntoOwned for UserEntityConnection<'_> {
    type Owned = UserEntityConnection<'static>;

    fn into_owned(self) -> Self::Owned {
        UserEntityConnection {
            user_id: Cow::Owned(self.user_id.into_owned()),
            extra: self.extra.into_owned(),
        }
    }
}

impl IntoOwned for TrackingData<'_> {
    type Owned = TrackingData<'static>;

    fn into_owned(self) -> Self::Owned {
        TrackingData {
            entity: self.entity.into_owned(),
            action: self.action,
        }
    }
}

/// A variant of [Clone] which always performs cheap shallow bitwise copies
/// This has the same performance characteristics as [Copy]
pub trait ShallowClone<'b> {
    /// create a shallow clone
    fn shallow_clone(&'b self) -> Self;
}

impl<'b> ShallowClone<'b> for Entity<'b> {
    fn shallow_clone(&'b self) -> Self {
        Entity {
            entity_type: self.entity_type,
            entity_id: Cow::Borrowed(&self.entity_id),
        }
    }
}

impl<'b> ShallowClone<'b> for EntityConnection<'b> {
    fn shallow_clone(&'b self) -> Self {
        EntityConnection {
            extra: self.extra.shallow_clone(),
            connection_id: Cow::Borrowed(&self.connection_id),
        }
    }
}

impl<'b> ShallowClone<'b> for UserEntityConnection<'b> {
    fn shallow_clone(&'b self) -> Self {
        UserEntityConnection {
            user_id: Cow::Borrowed(&self.user_id),
            extra: self.extra.shallow_clone(),
        }
    }
}

impl<'b> ShallowClone<'b> for TrackingData<'b> {
    fn shallow_clone(&'b self) -> Self {
        TrackingData {
            entity: self.entity.shallow_clone(),
            action: self.action,
        }
    }
}
