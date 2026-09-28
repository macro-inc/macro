//! Adapters over the access and properties owning services.

use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotReceiptScope, EditAccessLevel, Entity,
        EntityAccessAuth, EntityAccessReceipt, EntityPermission, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use models_properties::service::property_value::PropertyValue;
use properties::PropertiesService;
use std::{collections::HashMap, sync::Arc};
use system_properties::{StatusOption, SystemPropertiesService, SystemPropertyKey};

use crate::domain::{
    models::{InitiativeError, InitiativeId},
    reads::InitiativePropertySnapshot,
    resources::{InitiativeResources, ResourceFuture},
};

/// Composes initiative dependencies using domain ports from their owners.
pub struct ProjectResources<P, S, A> {
    properties: Arc<P>,
    system_properties: Arc<S>,
    access: Arc<A>,
}

impl<P, S, A> std::fmt::Debug for ProjectResources<P, S, A> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProjectResources")
    }
}

impl<P, S, A> ProjectResources<P, S, A> {
    /// Supply owning domain services from the application composition root.
    pub fn new(properties: Arc<P>, system_properties: Arc<S>, access: Arc<A>) -> Self {
        Self {
            properties,
            system_properties,
            access,
        }
    }
}

impl<P: PropertiesService, S: SystemPropertiesService, A: EntityAccessService> InitiativeResources
    for ProjectResources<P, S, A>
{
    fn initialize(&self, id: InitiativeId) -> ResourceFuture<'_, ()> {
        Box::pin(async move {
            self.system_properties
                .attach_initiative_properties(vec![id.to_string()])
                .await
                .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))
        })
    }
    fn purge(&self, receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        Box::pin(async move {
            self.properties
                .delete_entity_properties(&receipt)
                .await
                .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))
        })
    }
    fn view(
        &self,
        auth: EntityAccessAuth,
        entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>> {
        Box::pin(async move {
            let result = match &auth {
                EntityAccessAuth::Authenticated(user) => {
                    self.access
                        .generate_entity_access_receipt::<ViewAccessLevel>(
                            user,
                            None,
                            &entity.entity_id,
                            entity.entity_type,
                        )
                        .await
                }
                EntityAccessAuth::Bot(bot) => {
                    let scope = match bot.scope() {
                        BotReceiptScope::User { acting_user } => {
                            BotAccessScope::user(acting_user.clone())
                        }
                        BotReceiptScope::Team { team_id } => {
                            BotAccessScope::Team { team_id: *team_id }
                        }
                        BotReceiptScope::Channel { .. } => return Ok(None),
                    };
                    self.access
                        .generate_bot_entity_access_receipt::<ViewAccessLevel>(
                            bot.bot_id(),
                            scope,
                            &entity.entity_id,
                            entity.entity_type,
                        )
                        .await
                }
                EntityAccessAuth::Unauthenticated => match self
                    .access
                    .get_access_level(None, &entity.entity_id, entity.entity_type)
                    .await
                {
                    Ok(Some(level)) => EntityAccessReceipt::try_new(
                        auth,
                        entity,
                        EntityPermission::AccessLevel {
                            access_level: level,
                        },
                    ),
                    Ok(None) => return Ok(None),
                    Err(error) => Err(error),
                },
                // Explicitly internal receipts retain their internal scope; no user is impersonated.
                EntityAccessAuth::Internal => EntityAccessReceipt::try_new(
                    auth,
                    entity,
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                ),
            };
            match result {
                Ok(receipt) => Ok(Some(receipt)),
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_)
                    | AccessError::BadRequest(_),
                ) => Ok(None),
                Err(error) => Err(InitiativeError::Internal(rootcause::report!(error).into())),
            }
        })
    }
    fn properties(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>> {
        Box::pin(async move {
            let ids = vec![
                SystemPropertyKey::STATUS_UUID,
                SystemPropertyKey::PRIORITY_UUID,
                SystemPropertyKey::ASSIGNEES_UUID,
                SystemPropertyKey::DUE_DATE_UUID,
            ];
            let mut output = HashMap::new();
            for batch in receipts.chunks(100) {
                let values = self
                    .properties
                    .get_bulk_entity_properties(batch, ids.clone())
                    .await
                    .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?;
                for (key, properties) in values {
                    let mut snapshot = InitiativePropertySnapshot::default();
                    for property in properties {
                        match (
                            SystemPropertyKey::from_uuid(property.definition.id),
                            property.value,
                        ) {
                            (
                                Some(SystemPropertyKey::Status),
                                Some(PropertyValue::SelectOption(options)),
                            ) => {
                                snapshot.status = options.first().copied();
                                snapshot.completed =
                                    snapshot.status == Some(StatusOption::COMPLETED_UUID);
                            }
                            (
                                Some(SystemPropertyKey::Priority),
                                Some(PropertyValue::SelectOption(options)),
                            ) => snapshot.priority = options.first().copied(),
                            (
                                Some(SystemPropertyKey::Assignees),
                                Some(PropertyValue::EntityRef(refs)),
                            ) => {
                                snapshot.assignees =
                                    refs.into_iter().map(|entity| entity.entity_id).collect()
                            }
                            (Some(SystemPropertyKey::DueDate), Some(PropertyValue::Date(date))) => {
                                snapshot.due_date = Some(date)
                            }
                            _ => (),
                        }
                    }
                    output.insert(key.entity_id, snapshot);
                }
            }
            Ok(output)
        })
    }
}
