use std::sync::{Arc, Mutex};

use async_graphql::{Context, EmptyMutation, EmptySubscription, ID, Object, Request, Schema};
use chrono::Utc;
use crm::domain::pipelines::{
    AccessiblePipeline, Pipeline, PipelineEntry, PipelineRecordType, PipelineSharing,
};
use databases::domain::models::{Column, ColumnDetail, ColumnId, DatabaseId, RowId, TableId};
use entity_access::domain::models::AccessLevel;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::position::key_between;
use models_properties::{
    DataType,
    service::{
        property_definition::PropertyDefinition,
        property_definition_with_options::PropertyDefinitionWithOptions,
        property_value::PropertyValue,
    },
    shared::property_owner::PropertyOwner,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    CrmGraphqlContext, CrmRecord, GraphqlCrmPipelineEntry, context::CrmPipelineApi,
    load_pipeline_entries, pipeline_entries_loader,
};

/// Answers every requested record with one entry and records each call.
struct FakePipelines {
    entry: PipelineEntry,
    calls: Mutex<Vec<(PipelineRecordType, Vec<Uuid>)>>,
}

impl CrmPipelineApi for FakePipelines {
    fn entries<'a>(
        &'a self,
        _viewer: &'a MacroUserIdStr<'static>,
        record_type: PipelineRecordType,
        records: &'a [Uuid],
    ) -> std::pin::Pin<
        Box<
            dyn Future<Output = Result<Vec<PipelineEntry>, crm::domain::pipelines::PipelineError>>
                + Send
                + 'a,
        >,
    > {
        self.calls
            .lock()
            .unwrap()
            .push((record_type, records.to_vec()));
        let entries = records
            .iter()
            .map(|record_id| PipelineEntry {
                record_id: *record_id,
                ..self.entry.clone()
            })
            .collect();
        Box::pin(async move { Ok(entries) })
    }
}

fn column(table: TableId, name: &str, data_type: DataType) -> ColumnDetail {
    let definition = Uuid::now_v7();
    ColumnDetail {
        column: Column {
            id: ColumnId::new(),
            table_id: table,
            property_definition_id: definition,
            position: key_between(None, None).unwrap(),
            config: None,
            display_name: None,
            infer_type: false,
            protections: vec![],
            nullable: true,
        },
        sql_name: format!("\"{name}\""),
        definition: PropertyDefinitionWithOptions {
            definition: PropertyDefinition {
                id: definition,
                owner: PropertyOwner::System,
                display_name: name.into(),
                data_type,
                is_multi_select: false,
                specific_entity_type: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                is_system: false,
                is_metadata: false,
            },
            property_options: vec![],
        },
        writable: true,
        shared_outside_database: false,
    }
}

struct Query;

#[Object]
impl Query {
    async fn company(
        &self,
        ctx: &Context<'_>,
        id: ID,
    ) -> async_graphql::Result<Vec<GraphqlCrmPipelineEntry>> {
        load_pipeline_entries(ctx, CrmRecord::Company(id.parse()?)).await
    }

    async fn contact(
        &self,
        ctx: &Context<'_>,
        id: ID,
    ) -> async_graphql::Result<Vec<GraphqlCrmPipelineEntry>> {
        load_pipeline_entries(ctx, CrmRecord::Contact(id.parse()?)).await
    }
}

#[tokio::test]
async fn one_read_per_record_type_answers_every_record_without_its_own_column() {
    let table = TableId::new();
    let primary = column(table, "Company", DataType::Entity);
    let revenue = column(table, "Revenue", DataType::Number);
    let stage = column(table, "Stage", DataType::SelectString);
    let revenue_id = revenue.column.id;
    let row = RowId::new();
    let pipeline = Pipeline {
        id: Uuid::now_v7(),
        team_id: Uuid::now_v7(),
        name: "Deals".into(),
        user_id: "macro|owner@macro.com".into(),
        record_type: PipelineRecordType::Company,
        database_id: DatabaseId::new(),
        table_id: table,
        primary_column_id: primary.column.id,
        sharing: PipelineSharing::Team,
        created_at: Utc::now(),
        trashed_at: None,
    };
    let fake = Arc::new(FakePipelines {
        entry: PipelineEntry {
            row_id: row,
            record_id: Uuid::nil(),
            pipeline: Arc::new(AccessiblePipeline {
                pipeline,
                grant: AccessLevel::View,
            }),
            columns: vec![primary, revenue, stage].into(),
            cells: [(revenue_id, PropertyValue::Num(9600.0))].into(),
        },
        calls: Mutex::default(),
    });
    let viewer = MacroUserIdStr::parse_from_str("macro|viewer@macro.com")
        .unwrap()
        .into_owned();
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription).finish();
    let [first, second, contact] = [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()];
    let fields = "id pipeline { name canEdit } cells { column { name } value { ... on GraphqlNumberPropertyValue { value } } }";
    let response = schema
        .execute(
            Request::new(format!(
                r#"{{ first: company(id: "{first}") {{ {fields} }}
                    second: company(id: "{second}") {{ {fields} }}
                    contact: contact(id: "{contact}") {{ id }} }}"#
            ))
            .data(pipeline_entries_loader(
                CrmGraphqlContext(fake.clone()),
                viewer,
            )),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let expected = json!([{
        "id": row.into_uuid().to_string(),
        "pipeline": { "name": "Deals", "canEdit": false },
        "cells": [
            { "column": { "name": "Revenue" }, "value": { "value": 9600.0 } },
            { "column": { "name": "Stage" }, "value": null },
        ],
    }]);
    assert_eq!(data["first"], expected);
    assert_eq!(data["second"], expected);
    assert_eq!(data["contact"].as_array().unwrap().len(), 1);

    let mut calls = fake.calls.lock().unwrap().clone();
    calls.sort_by_key(|(record_type, _)| *record_type == PipelineRecordType::Contact);
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, PipelineRecordType::Company);
    let mut companies = calls[0].1.clone();
    companies.sort();
    let mut requested = vec![first, second];
    requested.sort();
    assert_eq!(companies, requested);
    assert_eq!(calls[1], (PipelineRecordType::Contact, vec![contact]));
}
