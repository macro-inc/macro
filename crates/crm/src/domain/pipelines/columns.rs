//! The columns a new pipeline starts with.

use databases::domain::{
    models::{ColumnId, ColumnProtection},
    provisioning::ProvisionedColumn,
};
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, EntityType as PropertyEntityType};

use super::PipelineRecordType;

/// The columns a pipeline tracking `record_type` starts with.
pub(super) fn tracked_columns(
    primary_column_id: ColumnId,
    record_type: PipelineRecordType,
    labels: Vec<String>,
) -> Vec<ProvisionedColumn> {
    vec![
        ProvisionedColumn {
            id: primary_column_id,
            name: match record_type {
                PipelineRecordType::Company => "Company",
                PipelineRecordType::Contact => "Contact",
            }
            .into(),
            data_type: DataType::Entity,
            entity_type: Some(record_type.property_type()),
            options: vec![],
            nullable: false,
            protections: vec![ColumnProtection::Delete, ColumnProtection::ChangeType],
        },
        ProvisionedColumn {
            id: ColumnId::generate(),
            nullable: true,
            protections: vec![],
            name: "Stage".into(),
            data_type: DataType::SelectString,
            entity_type: None,
            options: labels
                .into_iter()
                .map(|label| {
                    (
                        macro_uuid::generate_uuid_v7(),
                        PropertyOptionValue::String(label),
                    )
                })
                .collect(),
        },
        ProvisionedColumn {
            id: ColumnId::generate(),
            nullable: true,
            protections: vec![],
            name: "Owner".into(),
            data_type: DataType::Entity,
            entity_type: Some(PropertyEntityType::User),
            options: vec![],
        },
        ProvisionedColumn {
            id: ColumnId::generate(),
            nullable: true,
            protections: vec![],
            name: "Revenue".into(),
            data_type: DataType::Number,
            entity_type: None,
            options: vec![],
        },
    ]
}

/// A generic pipeline starts like a new database: one Name column, optional in
/// every row and as open to change as any other.
pub(super) fn generic_columns(primary_column_id: ColumnId) -> Vec<ProvisionedColumn> {
    vec![ProvisionedColumn {
        id: primary_column_id,
        name: "Name".into(),
        data_type: DataType::String,
        entity_type: None,
        options: vec![],
        nullable: true,
        protections: vec![],
    }]
}
