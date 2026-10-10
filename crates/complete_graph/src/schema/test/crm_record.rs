use ::crm::domain::{auth::CrmTeamReceipt, pipelines::*};
use databases::domain::{
    models::{AppliedOps, OpBatch, RowId, TableDetail},
    storage::{StorageRows, StorageRowsQuery},
};
use entity_access::domain::models::{
    EditAccessLevel, MemberTeamRole, OwnerAccessLevel, ViewAccessLevel,
};
use models_soup::crm_company::SoupCrmCompany;

use super::*;

/// Records the records it is asked about; every other use case is out of scope.
#[derive(Default)]
struct RecordingPipelines {
    asked: Mutex<Vec<(PipelineRecordType, Vec<Uuid>)>>,
}

impl PipelineService for RecordingPipelines {
    async fn create(
        &self,
        _: CrmTeamReceipt<MemberTeamRole>,
        _: CreatePipeline,
    ) -> Result<AccessiblePipeline, PipelineError> {
        unimplemented!()
    }
    async fn list(
        &self,
        _: CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Vec<AccessiblePipeline>, PipelineError> {
        unimplemented!()
    }
    async fn entries(
        &self,
        _: &MacroUserIdStr<'static>,
        record_type: PipelineRecordType,
        records: &[Uuid],
    ) -> Result<Vec<PipelineEntry>, PipelineError> {
        self.asked
            .lock()
            .unwrap()
            .push((record_type, records.to_vec()));
        Ok(Vec::new())
    }
    async fn get(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<AccessiblePipeline, PipelineError> {
        unimplemented!()
    }
    async fn table(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<TableDetail, PipelineError> {
        unimplemented!()
    }
    async fn rows(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: Option<RowId>,
    ) -> Result<StorageRows, PipelineError> {
        unimplemented!()
    }
    async fn query_rows(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: StorageRowsQuery,
    ) -> Result<StorageRows, PipelineError> {
        unimplemented!()
    }
    async fn apply_ops(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: OpBatch,
    ) -> Result<AppliedOps, PipelineError> {
        unimplemented!()
    }
    async fn rename(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: String,
    ) -> Result<(), PipelineError> {
        unimplemented!()
    }
    async fn share(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
        _: PipelineSharing,
    ) -> Result<(), PipelineError> {
        unimplemented!()
    }
    async fn set_trashed(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
        _: bool,
    ) -> Result<(), PipelineError> {
        unimplemented!()
    }
}

fn soup_crm_company(id: Uuid) -> SoupItem<()> {
    SoupItem::CrmCompany(SoupCrmCompany {
        id,
        team_id: Uuid::from_u128(7),
        name: Some("Acme".to_string()),
        description: Some("Builds anvils.".to_string()),
        email_sync: true,
        hidden: false,
        created_at: Default::default(),
        updated_at: Default::default(),
        viewed_at: None,
        domains: Vec::new(),
        extra: (),
    })
}

#[tokio::test]
async fn a_crm_company_loads_from_the_user_with_its_pipeline_entries() {
    let harness = harness();
    let id = Uuid::from_u128(42);
    harness
        .soup_service
        .set_raw_response(vec![soup_crm_company(id)]);
    let pipelines = Arc::new(RecordingPipelines::default());
    let viewer = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"{{ user {{ crmCompany(companyId: "{id}") {{
                            __typename id name description
                            pipelineEntries {{ id cells {{ column {{ name }} }} }}
                        }} }} }}"#
                    ),
                    authenticated_parts(),
                )
                .data(graphql_crm::pipeline_entries_loader(
                    graphql_crm::CrmGraphqlContext::new(pipelines.clone()),
                    viewer,
                )),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let company = &data["user"]["crmCompany"];
    assert_eq!(company["__typename"], "GraphqlSoupCrmCompany");
    assert_eq!(company["id"], id.to_string());
    assert_eq!(company["description"], "Builds anvils.");
    assert_eq!(company["pipelineEntries"], serde_json::json!([]));
    assert_eq!(
        *pipelines.asked.lock().unwrap(),
        vec![(PipelineRecordType::Company, vec![id])]
    );
}
