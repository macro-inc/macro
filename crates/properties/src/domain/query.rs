//! Read authorization for property-dependent candidate queries.

use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{CandidateQuery, GroupByField};
use models_properties::DataType;

use super::{
    error::PropertiesErr,
    service::{PropertiesService, TeamReceipt},
};

/// A viewer-bound query whose selected property definitions are readable.
///
/// DATE sorting and range grouping also prove that their definitions are scalar
/// DATE properties. This request-local capability is intentionally not
/// deserializable. Mint a new capability for every continuation request.
#[derive(Debug, Clone)]
pub struct AuthorizedPropertyQuery {
    viewer: MacroUserIdStr<'static>,
    query: CandidateQuery,
}

impl AuthorizedPropertyQuery {
    /// Viewer whose definition visibility was checked.
    pub fn viewer(&self) -> &MacroUserIdStr<'static> {
        &self.viewer
    }

    /// Immutable query configuration covered by this authorization.
    pub fn query(&self) -> &CandidateQuery {
        &self.query
    }
}

pub(super) async fn authorize<S: PropertiesService>(
    service: &S,
    viewer: MacroUserIdStr<'static>,
    team: Option<&TeamReceipt>,
    query: CandidateQuery,
) -> Result<AuthorizedPropertyQuery, PropertiesErr> {
    query
        .validate()
        .map_err(|error| PropertiesErr::Validation(error.to_string()))?;
    if team.is_some_and(|receipt| receipt.acting_user_id() != Some(&viewer)) {
        return Err(PropertiesErr::PermissionDenied);
    }
    let mut definitions = Vec::with_capacity(2);
    if let Some(id) = query.date_property_id {
        definitions.push((id, true));
    }
    if let Some(GroupByField::Property {
        property_definition_id,
        bucketing,
        ..
    }) = query.grouping.as_ref().map(|grouping| &grouping.field)
    {
        if let Some((_, requires_date)) = definitions
            .iter_mut()
            .find(|(id, _)| id == property_definition_id)
        {
            *requires_date |= bucketing.is_some();
        } else {
            definitions.push((*property_definition_id, bucketing.is_some()));
        }
    }
    for (id, requires_date) in definitions {
        // Check visibility before type so private definition metadata stays private.
        let definition = service.get_property_definition(id, &viewer, team).await?;
        if requires_date && (definition.data_type != DataType::Date || definition.is_multi_select) {
            return Err(PropertiesErr::Validation(
                "Date queries require a scalar DATE property".into(),
            ));
        }
    }
    Ok(AuthorizedPropertyQuery { viewer, query })
}

#[cfg(test)]
mod test;
