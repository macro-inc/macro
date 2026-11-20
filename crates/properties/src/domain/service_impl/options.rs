use super::*;
use crate::tag_color::TagColor;

impl<R, P, N, B> PropertiesServiceImpl<R, P, N, B>
where
    R: PropertiesRepo,
    P: PermissionService,
    N: NotificationService,
    B: MacroEventBroker,
    anyhow::Error: From<R::Err>,
{
    pub(super) async fn prepare_property_option(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team: Option<&TeamReceipt>,
        property_definition_id: Uuid,
        request: &AddPropertyOptionRequest,
    ) -> Result<(i32, PropertyOptionValue, Option<String>), PropertiesErr> {
        let definition = self
            .owned_modifiable_definition(
                property_definition_id,
                user_id,
                team_id_from_receipt(team),
            )
            .await?;

        request
            .validate()
            .map_err(|e| PropertiesErr::Validation(e.to_string()))?;
        request
            .validate_compatibility(&definition.data_type)
            .map_err(|e| PropertiesErr::Validation(e.to_string()))?;

        let (display_order, option_value, color) = match request {
            AddPropertyOptionRequest::SelectString { option } => (
                option.display_order,
                PropertyOptionValue::String(option.value.clone()),
                option.color.clone(),
            ),
            AddPropertyOptionRequest::SelectNumber { option } => (
                option.display_order,
                PropertyOptionValue::Number(option.value),
                None,
            ),
        };

        // A tag added without a color takes the palette color for its
        // position, as the tag picker does.
        let effective_color = match (&definition.data_type, &color) {
            (DataType::Tag, None) => Some(
                TagColor::for_position(display_order.unsigned_abs() as usize)
                    .hex()
                    .to_owned(),
            ),
            _ => color.clone(),
        };
        validate_option_color(
            &definition.data_type,
            color.as_deref(),
            effective_color.as_deref(),
        )?;
        let color = effective_color;

        Ok((display_order, option_value, color))
    }
}
