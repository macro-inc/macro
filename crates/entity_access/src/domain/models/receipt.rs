use std::marker::PhantomData;

use macro_user_id::user_id::MacroUserIdStr;

use super::{
    AccessError, AccessLevel, BotIdStr, BotReceiptAuth, BotReceiptScope, Entity, EntityAccessAuth,
    EntityPermission, EntityType, RequiredPermission,
};

/// Represents that a given user has a given permission for the provided id.
///
/// The type parameter `T` encodes the minimum permission that was verified
/// when this receipt was created.
///
/// A receipt whose auth is [`EntityAccessAuth::Unauthenticated`] never holds
/// more than View, whatever grant produced it.
#[derive(Debug, Clone)]
pub struct EntityAccessReceipt<T: RequiredPermission> {
    // Private to this module: every receipt is built by a constructor below,
    // and the only one that accepts `Unauthenticated` applies `ceiling`.
    auth: EntityAccessAuth,
    entity: Entity,
    entity_permission: EntityPermission,
    _marker: PhantomData<T>,
}

/// The strongest permission `auth` may carry, given the permission its grant
/// resolved to. `None` means the caller cannot hold this kind of permission.
///
/// Idempotent, so re-tagging an existing receipt never needs a second rule.
fn ceiling(auth: &EntityAccessAuth, permission: EntityPermission) -> Option<EntityPermission> {
    match auth {
        EntityAccessAuth::Unauthenticated => match permission {
            EntityPermission::AccessLevel { access_level } => Some(EntityPermission::AccessLevel {
                access_level: access_level.min(AccessLevel::View),
            }),
            EntityPermission::ChannelViewOnly | EntityPermission::ChannelRole { .. } => {
                Some(EntityPermission::ChannelViewOnly)
            }
            // A team role is membership; a caller with no account is never a member.
            EntityPermission::TeamRole { .. } => None,
        },
        EntityAccessAuth::Authenticated(_)
        | EntityAccessAuth::Bot(_)
        | EntityAccessAuth::Internal => Some(permission),
    }
}

impl<T: RequiredPermission> EntityAccessReceipt<T> {
    /// Re-tag this receipt for another permission requirement after
    /// revalidating the already-resolved permission.
    ///
    /// This safely supports passing a stronger receipt to a read-only domain
    /// method without repeating the underlying access lookup.
    pub fn try_into_requirement<U: RequiredPermission>(
        self,
    ) -> Result<EntityAccessReceipt<U>, AccessError> {
        EntityAccessReceipt::<U>::try_new(self.auth, self.entity, self.entity_permission)
    }

    /// Creates an access receipt for `auth` after capping `entity_permission`
    /// to what `auth` may hold and validating the result against `T`.
    ///
    /// A caller with no account is capped at View: a Comment, Edit, or Owner
    /// grant yields a View receipt, and a requirement above View is refused.
    pub fn try_new(
        auth: EntityAccessAuth,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let entity_permission =
            ceiling(&auth, entity_permission).ok_or(AccessError::Unauthorized)?;
        if !entity_permission.satisfies::<T>() {
            return Err(AccessError::Unauthorized);
        }

        Ok(EntityAccessReceipt {
            auth,
            entity,
            entity_permission,
            _marker: PhantomData,
        })
    }

    /// Creates an access receipt for a caller who may or may not be signed in.
    ///
    /// `None` is a caller with no account, capped at View as in [`Self::try_new`].
    pub fn try_new_for_user(
        user_id: Option<MacroUserIdStr<'static>>,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let auth = user_id
            .map(EntityAccessAuth::Authenticated)
            .unwrap_or(EntityAccessAuth::Unauthenticated);
        Self::try_new(auth, entity, entity_permission)
    }

    /// Creates an access receipt for an authenticated user after validating the provided permission.
    pub fn try_new_authenticated_user(
        user_id: MacroUserIdStr<'static>,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Self::try_new(
            EntityAccessAuth::Authenticated(user_id),
            entity,
            entity_permission,
        )
    }

    /// Creates an access receipt for an authenticated bot after validating the provided permission.
    pub fn try_new_bot(
        bot_id: BotIdStr<'static>,
        scope: BotReceiptScope,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Self::try_new(
            EntityAccessAuth::Bot(BotReceiptAuth::new(bot_id, scope)),
            entity,
            entity_permission,
        )
    }

    /// A trusted internal service with no acting user, holding
    /// `entity_permission` without a requirement check.
    ///
    /// Call routes stamp `ChannelRole { Owner }` on receipts tagged with
    /// access-level requirements, which a checked constructor would refuse.
    pub(crate) fn trusted_internal(entity: Entity, entity_permission: EntityPermission) -> Self {
        EntityAccessReceipt {
            auth: EntityAccessAuth::Internal,
            entity,
            entity_permission,
            _marker: PhantomData,
        }
    }

    /// Get the authenticated user or return an authorization error.
    pub fn get_authenticated_user(&self) -> Result<&MacroUserIdStr<'static>, AccessError> {
        match &self.auth {
            EntityAccessAuth::Authenticated(user) => Ok(user),
            EntityAccessAuth::Bot(_)
            | EntityAccessAuth::Unauthenticated
            | EntityAccessAuth::Internal => Err(AccessError::Unauthorized),
        }
    }

    /// Get the authenticated bot's canonical storage principal or return an authorization error.
    pub fn get_authenticated_bot(&self) -> Result<&BotIdStr<'static>, AccessError> {
        Ok(self.get_authenticated_bot_auth()?.bot_id_str())
    }

    /// Get the authenticated bot and receipt scope or return an authorization error.
    pub fn get_authenticated_bot_auth(&self) -> Result<&BotReceiptAuth, AccessError> {
        match &self.auth {
            EntityAccessAuth::Bot(bot_auth) => Ok(bot_auth),
            EntityAccessAuth::Authenticated(_)
            | EntityAccessAuth::Unauthenticated
            | EntityAccessAuth::Internal => Err(AccessError::Unauthorized),
        }
    }

    /// Returns the direct user or verified acting user represented by this receipt.
    pub fn acting_user_id(&self) -> Option<&MacroUserIdStr<'static>> {
        match &self.auth {
            EntityAccessAuth::Authenticated(user_id) => Some(user_id),
            EntityAccessAuth::Bot(bot_auth) => bot_auth.scope().acting_user_id(),
            EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
        }
    }

    /// Getter for auth
    pub fn auth(&self) -> &EntityAccessAuth {
        &self.auth
    }

    /// Getter for entity
    pub fn entity(&self) -> &Entity {
        &self.entity
    }

    /// Getter for entity permission
    pub fn entity_permission(&self) -> &EntityPermission {
        &self.entity_permission
    }

    /// Dangerously generates a EntityAccessReceipt for an internal user
    /// **NOTE** This should only be used in specific circumstances and not as a way
    /// to circumvent AI tool permissioning
    /// This **DOES NOT** assert the existence of the item
    pub fn dangerously_assert_internal_user(
        entity_id: &str,
        entity_type: EntityType,
    ) -> EntityAccessReceipt<T> {
        Self::trusted_internal(
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
    }

    /// Dangerously generates an `EntityAccessReceipt` for an authenticated user
    /// without performing the underlying access check.
    ///
    /// **NOTE** This is intended for tests. It **DOES NOT** assert the
    /// existence of the item or that the user actually has the required
    /// permission.
    pub fn dangerously_assert_authenticated_user(
        user_id: MacroUserIdStr<'static>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> EntityAccessReceipt<T> {
        EntityAccessReceipt {
            auth: EntityAccessAuth::Authenticated(user_id),
            entity: Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            entity_permission: EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
            _marker: PhantomData,
        }
    }

    /// Dangerously generates an `EntityAccessReceipt` for an authenticated bot
    /// without performing the underlying access check.
    ///
    /// **NOTE** This is intended for tests. It **DOES NOT** assert the
    /// existence of the item or that the bot actually has the required
    /// permission.
    pub fn dangerously_assert_bot(
        bot_id: BotIdStr<'static>,
        scope: BotReceiptScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> EntityAccessReceipt<T> {
        EntityAccessReceipt {
            auth: EntityAccessAuth::Bot(BotReceiptAuth::new(bot_id, scope)),
            entity: Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            entity_permission: EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
            _marker: PhantomData,
        }
    }
}
