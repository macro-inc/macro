use super::*;
use crm::domain::crm_transfer::{
    CrmTransferRecords, CrmTransferService, CrmTransferServiceImpl, CsvFile, CsvFiles, CsvInput,
    TransferError,
};

struct TextOnly;
impl CsvFiles for TextOnly {
    async fn read(&self, _: &Viewer, _: Uuid) -> Result<CsvFile, TransferError> {
        panic!("text import does not read a file")
    }
    async fn save(&self, _: &Viewer, _: &str, _: String) -> Result<Uuid, TransferError> {
        panic!("import does not save a file")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_add_and_csv_import_enforce_stage_rules_and_report_invalid_rows(pool: PgPool) {
    let Fixture {
        workflows, acme, ..
    } = fixture(&pool).await;
    let owner = viewer(OWNER);
    let overview = sales(&workflows, PipelineSharing::Private).await;
    let pipeline = overview.pipeline.pipeline.id;
    let stage = overview.field("Stage").unwrap();
    let stage_id = stage.options[0].0;
    let amount = overview.field("Revenue").unwrap().id;
    sqlx::query!("INSERT INTO crm_pipeline_stage_requirements (pipeline_id, stage_column_id, stage_id, required_column_id) VALUES ($1, $2, $3, $4)", pipeline, stage.id.into_uuid(), stage_id.into_uuid(), amount.into_uuid()).execute(&pool).await.unwrap();
    let error = workflows
        .add(
            &owner,
            pipeline,
            vec![EntryAddition {
                record: RecordTarget::Id(acme),
                set: vec![set("Stage", "Prospect")],
            }],
            true,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&error, WorkflowError::Invalid(message) if message.contains("Revenue") && message.contains("Prospect")),
        "{error:?}"
    );
    let access = Arc::new(Access::new(PgAccessRepository::new(pool.clone())));
    let crm = Arc::new(Crm::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    ));
    let importer = CrmTransferServiceImpl::new(
        Arc::new(workflows),
        CrmTransferRecords::new(crm, access),
        TextOnly,
    );
    let result = importer.import_to_pipeline(&owner, pipeline, CsvInput::Text("Company,Domain,Stage,Revenue\nAcme,acme.com,Prospect,\nGlobex,globex.com,Prospect,100\n".into())).await.unwrap();
    assert_eq!(result.added, 1);
    assert_eq!(result.invalid.len(), 1);
    assert_eq!(result.invalid[0].key, "acme.com");
    assert!(result.invalid[0].reason.contains("Revenue"));
}
