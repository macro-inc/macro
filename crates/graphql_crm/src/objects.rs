//! GraphQL objects for pipeline rows that reference a CRM record.

use std::sync::Arc;

use async_graphql::{Enum, ID, Object};
use crm::domain::pipelines::{
    AccessiblePipeline, PipelineEntry, PipelineRecordType, PipelineSharing,
};
use databases::domain::models::ColumnDetail;
use entity_access::domain::models::AccessLevel;
use graphql_common::GraphqlPropertyEntityType;
use graphql_properties::{GraphqlPropertyDataType, GraphqlPropertyOption, GraphqlPropertyValue};
use models_properties::service::property_value::PropertyValue;

/// Which CRM record a pipeline's rows reference.
#[derive(Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlCrmPipelineRecordType {
    /// Companies.
    Company,
    /// Contacts.
    Contact,
}

impl From<PipelineRecordType> for GraphqlCrmPipelineRecordType {
    fn from(record_type: PipelineRecordType) -> Self {
        match record_type {
            PipelineRecordType::Company => Self::Company,
            PipelineRecordType::Contact => Self::Contact,
        }
    }
}

/// Whether a pipeline is shared with its team.
#[derive(Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlCrmPipelineSharing {
    /// Only people granted access individually.
    Private,
    /// The whole team may edit.
    Team,
}

impl From<PipelineSharing> for GraphqlCrmPipelineSharing {
    fn from(sharing: PipelineSharing) -> Self {
        match sharing {
            PipelineSharing::Private => Self::Private,
            PipelineSharing::Team => Self::Team,
        }
    }
}

/// A pipeline row that references a company or contact.
pub struct GraphqlCrmPipelineEntry(PipelineEntry);

impl GraphqlCrmPipelineEntry {
    /// Wrap a domain entry.
    pub fn new(entry: PipelineEntry) -> Self {
        Self(entry)
    }
}

/// A pipeline row that references a company or contact.
#[Object(name = "GraphqlCrmPipelineEntry")]
impl GraphqlCrmPipelineEntry {
    /// The row's identifier.
    async fn id(&self) -> ID {
        ID(self.0.row_id.into_uuid().to_string())
    }

    /// The pipeline holding the row.
    async fn pipeline(&self) -> GraphqlCrmPipeline {
        GraphqlCrmPipeline(self.0.pipeline.clone())
    }

    /// The row's cells in column order, for every column but the reference
    /// to the record itself. An empty cell has no value.
    async fn cells(&self) -> Vec<GraphqlCrmPipelineCell> {
        let primary = self.0.pipeline.pipeline.primary_column_id;
        (0..self.0.columns.len())
            .filter(|&index| self.0.columns[index].column.id != primary)
            .map(|index| GraphqlCrmPipelineCell {
                value: self.0.cells.get(&self.0.columns[index].column.id).cloned(),
                column: GraphqlCrmPipelineColumn {
                    columns: self.0.columns.clone(),
                    index,
                },
            })
            .collect()
    }
}

/// A CRM pipeline the viewer can see.
pub struct GraphqlCrmPipeline(Arc<AccessiblePipeline>);

/// A CRM pipeline the viewer can see.
#[Object(name = "GraphqlCrmPipeline")]
impl GraphqlCrmPipeline {
    /// The pipeline's identifier.
    async fn id(&self) -> ID {
        ID(self.0.pipeline.id.to_string())
    }

    /// The pipeline's name.
    async fn name(&self) -> &str {
        &self.0.pipeline.name
    }

    /// Which CRM record its rows reference.
    async fn record_type(&self) -> GraphqlCrmPipelineRecordType {
        self.0.pipeline.record_type.into()
    }

    /// Whether the pipeline is shared with its team.
    async fn sharing(&self) -> GraphqlCrmPipelineSharing {
        self.0.pipeline.sharing.into()
    }

    /// The table that pipeline operations name.
    async fn table_id(&self) -> ID {
        ID(self.0.pipeline.table_id.into_uuid().to_string())
    }

    /// Whether the viewer may edit the pipeline's rows.
    async fn can_edit(&self) -> bool {
        matches!(self.0.grant, AccessLevel::Edit | AccessLevel::Owner)
    }
}

/// One cell of a pipeline row.
pub struct GraphqlCrmPipelineCell {
    column: GraphqlCrmPipelineColumn,
    value: Option<PropertyValue>,
}

/// One cell of a pipeline row.
#[Object(name = "GraphqlCrmPipelineCell")]
impl GraphqlCrmPipelineCell {
    /// The cell's column.
    async fn column(&self) -> &GraphqlCrmPipelineColumn {
        &self.column
    }

    /// The cell's value, absent when the cell is empty.
    async fn value(&self) -> Option<GraphqlPropertyValue> {
        self.value.as_ref().map(GraphqlPropertyValue::new)
    }
}

/// A pipeline column, with what its cells' values mean.
pub struct GraphqlCrmPipelineColumn {
    columns: Arc<[ColumnDetail]>,
    index: usize,
}

impl GraphqlCrmPipelineColumn {
    fn detail(&self) -> &ColumnDetail {
        &self.columns[self.index]
    }
}

/// A pipeline column, with what its cells' values mean.
#[Object(name = "GraphqlCrmPipelineColumn")]
impl GraphqlCrmPipelineColumn {
    /// The column's identifier.
    async fn id(&self) -> ID {
        ID(self.detail().column.id.into_uuid().to_string())
    }

    /// The property definition the column binds.
    async fn property_definition_id(&self) -> ID {
        ID(self.detail().definition.definition.id.to_string())
    }

    /// The column's name.
    async fn name(&self) -> &str {
        self.detail().name()
    }

    /// The type of value the column holds.
    async fn data_type(&self) -> GraphqlPropertyDataType {
        GraphqlPropertyDataType::new(self.detail().definition.definition.data_type)
    }

    /// Whether a cell can hold more than one value.
    async fn is_multi_select(&self) -> bool {
        self.detail().definition.definition.is_multi_select
    }

    /// The required entity type for a reference column, when constrained.
    async fn specific_entity_type(&self) -> Option<GraphqlPropertyEntityType> {
        self.detail()
            .definition
            .definition
            .specific_entity_type
            .map(GraphqlPropertyEntityType::new)
    }

    /// The options a select column's cells choose from, in display order.
    async fn options(&self) -> Vec<GraphqlPropertyOption> {
        self.detail()
            .definition
            .property_options
            .iter()
            .cloned()
            .map(GraphqlPropertyOption::from)
            .collect()
    }
}
