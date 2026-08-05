//! Applies properties recovered from an external document to a Macro document.
//!
//! This adapter translates import-domain values into the Properties service's
//! definitions, options, and stored values. Imported enrichment is best-effort:
//! an invalid or conflicting property is logged and skipped without invalidating
//! the document that was already created.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::{
    AddPropertyOptionRequest, AddStringOptionRequest, CreatePropertyDefinitionRequest,
    CreatePropertyScope, PropertyDataType, SetPropertyValue,
};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::{DataType, EntityType};
use properties::domain::model::TagScope;
use properties::{EditReceipt, PropertiesService};
use uuid::Uuid;

use crate::domain::ports::{
    ImportedDocumentProperties, ImportedDocumentProperty, ImportedDocumentPropertyValue,
};

#[cfg(test)]
mod test;

/// Applies imported document properties through Macro's Properties service.
pub struct DocumentPropertiesApplicator<P> {
    properties: Arc<P>,
}

impl<P> Clone for DocumentPropertiesApplicator<P> {
    fn clone(&self) -> Self {
        Self {
            properties: self.properties.clone(),
        }
    }
}

impl<P: PropertiesService> DocumentPropertiesApplicator<P> {
    /// Create an applicator backed by the shared Properties service.
    pub fn new(properties: Arc<P>) -> Self {
        Self { properties }
    }

    /// Apply imported tags and ordinary properties to an editable document.
    pub async fn apply(
        &self,
        user: &MacroUserIdStr<'static>,
        access: &EditReceipt,
        document_id: &str,
        imported: &ImportedDocumentProperties,
    ) {
        self.apply_tags(user, access, document_id, &imported.tags)
            .await;
        self.apply_values(user, access, document_id, &imported.values)
            .await;
    }

    async fn apply_tags(
        &self,
        user: &MacroUserIdStr<'static>,
        access: &EditReceipt,
        document_id: &str,
        labels: &[String],
    ) {
        if labels.is_empty() {
            return;
        }

        let tag_set = match self
            .properties
            .ensure_tag_set(user, None, TagScope::User)
            .await
        {
            Ok(tag_set) => tag_set,
            Err(error) => {
                tracing::warn!(document_id, error = ?error, "failed to prepare imported document tags");
                return;
            }
        };
        let Some(definition) = tag_set.definition else {
            tracing::warn!(document_id, "imported document tag set has no definition");
            return;
        };
        let mut options = tag_set.options;

        for (index, label) in labels.iter().enumerate() {
            let option_id = self
                .find_or_create_string_option(
                    user,
                    document_id,
                    &definition,
                    &mut options,
                    label,
                    Some(imported_tag_color(index)),
                )
                .await;
            let Some(option_id) = option_id else {
                continue;
            };

            if let Err(error) = self
                .properties
                .add_entity_property_option(access, definition.id, option_id)
                .await
            {
                tracing::warn!(
                    document_id,
                    label,
                    error = ?error,
                    "failed to attach imported document tag"
                );
            }
        }
    }

    async fn apply_values(
        &self,
        user: &MacroUserIdStr<'static>,
        access: &EditReceipt,
        document_id: &str,
        imported: &[ImportedDocumentProperty],
    ) {
        if imported.is_empty() {
            return;
        }

        let mut definitions = match self
            .properties
            .list_property_definitions(None, Some(user), true, Some(EntityType::Document))
            .await
        {
            Ok(definitions) => definitions,
            Err(error) => {
                tracing::warn!(document_id, error = ?error, "failed to list imported document properties");
                return;
            }
        };
        let system_definitions = match self
            .properties
            .list_property_definitions(None, None, true, None)
            .await
        {
            Ok(definitions) => definitions,
            Err(error) => {
                tracing::warn!(document_id, error = ?error, "failed to list system properties for import");
                return;
            }
        };

        for property in imported {
            let descriptor = ImportedPropertyDescriptor::of(&property.value);
            let definition = find_or_create_definition(
                self.properties.as_ref(),
                user,
                document_id,
                property,
                &descriptor,
                &mut definitions,
                &system_definitions,
            )
            .await;
            let Some(definition) = definition else {
                continue;
            };

            let value = self
                .property_value(
                    user,
                    document_id,
                    property,
                    &definition,
                    descriptor.is_multi_select,
                )
                .await;
            let Some(value) = value else {
                continue;
            };

            if let Err(error) = self
                .properties
                .set_entity_property(access, definition.id, Some(value))
                .await
            {
                tracing::warn!(
                    document_id,
                    property = %property.name,
                    error = ?error,
                    "failed to set imported document property"
                );
            }
        }
    }

    async fn property_value(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: &str,
        property: &ImportedDocumentProperty,
        definition: &PropertyDefinition,
        is_multi_select: bool,
    ) -> Option<SetPropertyValue> {
        match &property.value {
            ImportedDocumentPropertyValue::Boolean { value } => {
                Some(SetPropertyValue::Boolean { value: *value })
            }
            ImportedDocumentPropertyValue::Date { value } => match dateparser::parse(value) {
                Ok(value) => Some(SetPropertyValue::Date { value }),
                Err(error) => {
                    tracing::warn!(
                        document_id,
                        property = %property.name,
                        error = ?error,
                        "failed to parse imported date property"
                    );
                    None
                }
            },
            ImportedDocumentPropertyValue::Number { value } => {
                Some(SetPropertyValue::Number { value: *value })
            }
            ImportedDocumentPropertyValue::String { value } => Some(SetPropertyValue::String {
                value: value.clone(),
            }),
            ImportedDocumentPropertyValue::Link { urls, .. } if is_multi_select => {
                Some(SetPropertyValue::MultiLink { urls: urls.clone() })
            }
            ImportedDocumentPropertyValue::Link { urls, .. } => urls
                .first()
                .cloned()
                .map(|url| SetPropertyValue::Link { url }),
            ImportedDocumentPropertyValue::Select { values, .. } => {
                self.select_value(
                    user,
                    document_id,
                    property,
                    definition,
                    values,
                    is_multi_select,
                )
                .await
            }
        }
    }

    async fn select_value(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: &str,
        property: &ImportedDocumentProperty,
        definition: &PropertyDefinition,
        values: &[String],
        is_multi_select: bool,
    ) -> Option<SetPropertyValue> {
        let mut options = match self
            .properties
            .get_property_options(definition.id, user, None)
            .await
        {
            Ok(options) => options,
            Err(error) => {
                tracing::warn!(
                    document_id,
                    property = %property.name,
                    error = ?error,
                    "failed to list imported property options"
                );
                return None;
            }
        };

        let mut option_ids = Vec::new();
        for value in values {
            if let Some(option_id) = self
                .find_or_create_string_option(
                    user,
                    document_id,
                    definition,
                    &mut options,
                    value,
                    None,
                )
                .await
            {
                option_ids.push(option_id);
            }
        }
        option_ids.sort_unstable();
        option_ids.dedup();

        if is_multi_select {
            Some(SetPropertyValue::MultiSelectOption { option_ids })
        } else {
            option_ids
                .first()
                .copied()
                .map(|option_id| SetPropertyValue::SelectOption { option_id })
        }
    }

    async fn find_or_create_string_option(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: &str,
        definition: &PropertyDefinition,
        options: &mut Vec<PropertyOption>,
        label: &str,
        color: Option<&str>,
    ) -> Option<Uuid> {
        if let Some(option) = find_string_option(options, label) {
            return Some(option.id);
        }

        if definition.is_system {
            tracing::warn!(
                document_id,
                property_definition_id = %definition.id,
                property = %definition.display_name,
                label,
                "skipping imported value absent from system property options"
            );
            return None;
        }

        let request = AddPropertyOptionRequest::SelectString {
            option: AddStringOptionRequest {
                display_order: options.len() as i32,
                value: label.to_string(),
                color: color.map(str::to_string),
            },
        };
        match self
            .properties
            .add_property_option(user, None, definition.id, &request)
            .await
        {
            Ok(option) => {
                let id = option.id;
                options.push(option);
                Some(id)
            }
            Err(error) => {
                // A concurrent import may have created the option first.
                let recovered = self
                    .properties
                    .get_property_options(definition.id, user, None)
                    .await
                    .ok()
                    .and_then(|fresh| find_string_option(&fresh, label).cloned());
                if let Some(option) = recovered {
                    let id = option.id;
                    options.push(option);
                    Some(id)
                } else {
                    tracing::warn!(
                        document_id,
                        label,
                        error = ?error,
                        "failed to create imported property option"
                    );
                    None
                }
            }
        }
    }
}

#[async_trait::async_trait]
trait ImportedPropertyDefinitions: Send + Sync {
    type Error: std::fmt::Debug + Send;

    async fn create_imported_definition(
        &self,
        user: &MacroUserIdStr<'_>,
        request: &CreatePropertyDefinitionRequest,
    ) -> Result<PropertyDefinition, Self::Error>;

    async fn list_imported_definitions(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<PropertyDefinition>, Self::Error>;
}

#[async_trait::async_trait]
impl<P: PropertiesService> ImportedPropertyDefinitions for P {
    type Error = properties::PropertiesErr;

    async fn create_imported_definition(
        &self,
        user: &MacroUserIdStr<'_>,
        request: &CreatePropertyDefinitionRequest,
    ) -> Result<PropertyDefinition, Self::Error> {
        PropertiesService::create_property_definition(self, user, None, request).await
    }

    async fn list_imported_definitions(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<PropertyDefinition>, Self::Error> {
        PropertiesService::list_property_definitions(
            self,
            None,
            Some(user),
            true,
            Some(EntityType::Document),
        )
        .await
    }
}

async fn find_or_create_definition<P: ImportedPropertyDefinitions>(
    properties: &P,
    user: &MacroUserIdStr<'static>,
    document_id: &str,
    property: &ImportedDocumentProperty,
    descriptor: &ImportedPropertyDescriptor,
    definitions: &mut Vec<PropertyDefinition>,
    system_definitions: &[PropertyDefinition],
) -> Option<PropertyDefinition> {
    match resolve_existing_definition(&property.name, descriptor, definitions, system_definitions) {
        ExistingDefinitionResolution::Reuse(definition) => Some(definition),
        ExistingDefinitionResolution::Create => {
            create_or_recover_definition(
                properties,
                user,
                document_id,
                &property.name,
                descriptor,
                definitions,
            )
            .await
        }
        ExistingDefinitionResolution::Conflict(conflict) => {
            log_definition_conflict(document_id, &property.name, conflict);
            None
        }
    }
}

#[derive(Debug)]
enum DefinitionConflict {
    IncompatibleExisting { is_system: bool },
    ReservedSystem { definition_id: Uuid },
}

#[derive(Debug)]
enum ExistingDefinitionResolution {
    Reuse(PropertyDefinition),
    Create,
    Conflict(DefinitionConflict),
}

fn resolve_existing_definition(
    property_name: &str,
    descriptor: &ImportedPropertyDescriptor,
    definitions: &[PropertyDefinition],
    system_definitions: &[PropertyDefinition],
) -> ExistingDefinitionResolution {
    if let Some(definition) = definitions
        .iter()
        .find(|definition| {
            definition.display_name.eq_ignore_ascii_case(property_name)
                && descriptor.matches(definition)
        })
        .cloned()
    {
        return ExistingDefinitionResolution::Reuse(definition);
    }

    if let Some(definition) = find_definition_by_name(definitions, property_name) {
        return ExistingDefinitionResolution::Conflict(DefinitionConflict::IncompatibleExisting {
            is_system: definition.is_system,
        });
    }

    if let Some(definition) = find_definition_by_name(system_definitions, property_name) {
        return ExistingDefinitionResolution::Conflict(DefinitionConflict::ReservedSystem {
            definition_id: definition.id,
        });
    }

    ExistingDefinitionResolution::Create
}

fn log_definition_conflict(document_id: &str, property_name: &str, conflict: DefinitionConflict) {
    match conflict {
        DefinitionConflict::IncompatibleExisting { is_system } => tracing::warn!(
            document_id,
            property = %property_name,
            is_system,
            "skipping imported property whose existing Macro definition has a different type"
        ),
        DefinitionConflict::ReservedSystem { definition_id } => tracing::warn!(
            document_id,
            property = %property_name,
            property_definition_id = %definition_id,
            "skipping imported property whose name is reserved by an inapplicable system property"
        ),
    }
}

async fn create_or_recover_definition<P: ImportedPropertyDefinitions>(
    properties: &P,
    user: &MacroUserIdStr<'static>,
    document_id: &str,
    property_name: &str,
    descriptor: &ImportedPropertyDescriptor,
    definitions: &mut Vec<PropertyDefinition>,
) -> Option<PropertyDefinition> {
    let request = CreatePropertyDefinitionRequest {
        scope: CreatePropertyScope::User,
        display_name: property_name.to_string(),
        data_type: descriptor.definition_type.clone(),
    };
    let definition = match properties.create_imported_definition(user, &request).await {
        Ok(definition) => definition,
        Err(error) => {
            // Concurrent imports may race to create the same definition.
            let recovered = properties
                .list_imported_definitions(user)
                .await
                .ok()
                .and_then(|definitions| {
                    definitions.into_iter().find(|definition| {
                        definition.display_name.eq_ignore_ascii_case(property_name)
                            && descriptor.matches(definition)
                    })
                });
            let Some(definition) = recovered else {
                tracing::warn!(
                    document_id,
                    property = %property_name,
                    error = ?error,
                    "failed to create imported document property"
                );
                return None;
            };
            definition
        }
    };
    definitions.push(definition.clone());
    Some(definition)
}

#[derive(Debug, Clone, PartialEq)]
struct ImportedPropertyDescriptor {
    /// API type used when a Macro definition must be created.
    definition_type: PropertyDataType,
    /// Stored type used to check compatibility with an existing definition.
    stored_type: DataType,
    /// Whether the existing definition and stored value accept multiple values.
    is_multi_select: bool,
}

impl ImportedPropertyDescriptor {
    fn of(value: &ImportedDocumentPropertyValue) -> Self {
        let definition_type = match value {
            ImportedDocumentPropertyValue::Boolean { .. } => PropertyDataType::Boolean,
            ImportedDocumentPropertyValue::Date { .. } => PropertyDataType::Date,
            ImportedDocumentPropertyValue::Number { .. } => PropertyDataType::Number,
            ImportedDocumentPropertyValue::String { .. } => PropertyDataType::String,
            ImportedDocumentPropertyValue::Select { multi, .. } => PropertyDataType::SelectString {
                options: Vec::new(),
                multi: *multi,
            },
            ImportedDocumentPropertyValue::Link { multi, .. } => {
                PropertyDataType::Link { multi: *multi }
            }
        };
        Self {
            stored_type: definition_type.to_data_type(),
            is_multi_select: definition_type.is_multi_select(),
            definition_type,
        }
    }

    fn matches(&self, definition: &PropertyDefinition) -> bool {
        definition.data_type == self.stored_type
            && definition.is_multi_select == self.is_multi_select
    }
}

fn find_string_option<'a>(
    options: &'a [PropertyOption],
    label: &str,
) -> Option<&'a PropertyOption> {
    options.iter().find(|option| {
        matches!(
            &option.value,
            PropertyOptionValue::String(value) if value.eq_ignore_ascii_case(label)
        )
    })
}

fn find_definition_by_name<'a>(
    definitions: &'a [PropertyDefinition],
    name: &str,
) -> Option<&'a PropertyDefinition> {
    definitions
        .iter()
        .find(|definition| definition.display_name.eq_ignore_ascii_case(name))
}

fn imported_tag_color(index: usize) -> &'static str {
    const COLORS: [&str; 12] = [
        "#0091FF", "#46A758", "#8E4EC6", "#F76B15", "#E93D82", "#12A594", "#FFB224", "#3E63DD",
        "#E5484D", "#F5D90A", "#889096", "#E54D2E",
    ];
    COLORS[index % COLORS.len()]
}
