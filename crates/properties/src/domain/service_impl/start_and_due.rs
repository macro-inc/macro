//! An entity's Start Date never lands after its Due Date.

use macro_event_broker::MacroEventBroker;
use models_properties::EntityType;
use models_properties::service::property_change_source::PropertyChangeSource;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::DateValue;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::domain::error::PropertiesErr;
use crate::domain::model::{EditReceipt, PropertyAccessReceiptExt};
use crate::domain::ports::{NotificationService, PermissionService, PropertiesRepo};
use crate::domain::service_impl::PropertiesServiceImpl;

impl<R, P, N, B> PropertiesServiceImpl<R, P, N, B>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
    anyhow::Error: From<R::Err> + From<P::Err> + From<N::Err>,
{
    /// The value to store for `property_definition_id`, after keeping the
    /// entity's start on or before its due date.
    ///
    /// The date picker cannot put the start after the due date; every other
    /// writer (agents, the SDK, quick input, a routine, the board's deadline
    /// move) comes through here. Neither write is refused and the due date is
    /// never moved for the start: a start set after the due date is stored as
    /// the due date, and a due date set before the start pulls the start back
    /// to it. That start is written before the due date, so a failed due date
    /// write still leaves a start no later than the stored due date.
    pub(crate) async fn keep_start_on_or_before_due(
        &self,
        access: &EditReceipt,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
        source: Option<&PropertyChangeSource>,
    ) -> Result<Option<PropertyValue>, PropertiesErr> {
        let Some(PropertyValue::Date(date)) = value else {
            return Ok(value);
        };
        let entity_id = access.entity_id();

        if property_definition_id == SystemPropertyKey::START_DATE_UUID {
            let due = self
                .repository
                .get_entity_property_value(entity_id, entity_type, SystemPropertyKey::DUE_DATE_UUID)
                .await
                .map_err(anyhow::Error::from)?;
            return Ok(match due {
                Some(PropertyValue::Date(due)) if starts_after(date, due) => {
                    Some(PropertyValue::Date(due))
                }
                _ => value,
            });
        }

        if property_definition_id != SystemPropertyKey::DUE_DATE_UUID {
            return Ok(value);
        }

        let start = self
            .repository
            .get_entity_property_value(entity_id, entity_type, SystemPropertyKey::START_DATE_UUID)
            .await
            .map_err(anyhow::Error::from)?;
        let Some(PropertyValue::Date(start)) = start else {
            return Ok(value);
        };
        if !starts_after(start, date) {
            return Ok(value);
        }

        let snapshot = self
            .repository
            .upsert_entity_property(
                entity_id,
                entity_type,
                SystemPropertyKey::START_DATE_UUID,
                value.clone(),
            )
            .await
            .map_err(anyhow::Error::from)?;
        self.publish_property_event(Self::entity_property_updated_event(
            &snapshot.property,
            &value,
            &snapshot.previous_value,
            access,
            source,
            None,
        ));
        Ok(value)
    }
}

/// Whether `start` comes after `due`, by their stored instants. A whole day
/// is held at a time within it (midnight or the end of the day where it was
/// picked), so a start and due date on the same day can compare either way,
/// and moving the start to the due date then keeps it on that day.
fn starts_after(start: DateValue, due: DateValue) -> bool {
    start.at() > due.at()
}
