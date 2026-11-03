use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use databases::domain::models::{ColumnId, DatabaseId, OptionId, RowId, TableId, TableVersion};
use entity_access::domain::models::AccessLevel;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::DateRange;

use super::*;
use crate::domain::{
    pipeline_workflows::{
        AddedEntries, EntryTarget, EntryUpdate, FoundEntries, PipelineEntryView, PipelineRecord,
        RecordEntries, RemovedEntries, UpdatedEntries,
    },
    pipelines::{AccessiblePipeline, Pipeline},
};

fn viewer() -> Viewer {
    Viewer {
        user_id: MacroUserIdStr::parse_from_str("macro|me@example.com")
            .unwrap()
            .into_owned(),
        acting_bot: None,
    }
}

fn field(name: &str, kind: FieldKind) -> PipelineField {
    PipelineField {
        id: ColumnId::new(),
        name: name.into(),
        kind,
        multiple: false,
        options: Vec::new(),
        required: false,
        writable: true,
    }
}

fn overview(record_type: PipelineRecordType) -> PipelineOverview {
    PipelineOverview {
        pipeline: AccessiblePipeline {
            pipeline: Pipeline {
                commercial_fields: Default::default(),
                id: Uuid::now_v7(),
                team_id: Uuid::now_v7(),
                user_id: "macro|me@example.com".into(),
                name: "Deals".into(),
                record_type,
                database_id: DatabaseId::new(),
                table_id: TableId::new(),
                primary_column_id: ColumnId::new(),
                sharing: PipelineSharing::Team,
                created_at: Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
                trashed_at: None,
            },
            grant: AccessLevel::Owner,
        },
        fields: vec![
            field("Company", FieldKind::Record(record_type)),
            PipelineField {
                options: vec![(OptionId::new(), "Lead".into())],
                ..field("Stage", FieldKind::Select)
            },
            field("Owner", FieldKind::Person),
            field("Revenue", FieldKind::Number),
            field(
                "Proposal",
                FieldKind::Entity(models_databases::EntityKind::Document),
            ),
        ],
        version: TableVersion(1),
    }
}

fn entry(id: Uuid) -> PipelineEntryView {
    PipelineEntryView {
        currencies: Default::default(),
        entry_id: RowId::new(),
        record: PipelineRecord {
            id,
            name: None,
            detail: None,
        },
        fields: Vec::new(),
    }
}

/// Pipelines in memory: one pipeline, entries for `present`, and a value
/// `refused` that makes any batch holding it invalid.
struct Workflows {
    overview: PipelineOverview,
    present: Vec<Uuid>,
    refused: Option<&'static str>,
    exported: Vec<PipelineEntryView>,
    created: Mutex<Vec<NewPipeline>>,
    edits: Mutex<Vec<PipelineEdit>>,
    added: Mutex<Vec<EntryAddition>>,
}

impl Workflows {
    fn new(overview: PipelineOverview) -> Self {
        Self {
            overview,
            present: Vec::new(),
            refused: None,
            exported: Vec::new(),
            created: Mutex::default(),
            edits: Mutex::default(),
            added: Mutex::default(),
        }
    }
}

impl PipelineWorkflowService for Workflows {
    async fn pipelines(&self, _: &Viewer) -> Result<Vec<PipelineOverview>, WorkflowError> {
        Ok(vec![self.overview.clone()])
    }

    async fn find(
        &self,
        _: &Viewer,
        _: Uuid,
        _: EntryQuery,
    ) -> Result<FoundEntries, WorkflowError> {
        Ok(FoundEntries {
            pipeline: self.overview.clone(),
            entries: self.exported.clone(),
            matched: self.exported.len(),
            complete: true,
            counts: Vec::new(),
            totals: Vec::new(),
        })
    }

    async fn search_entries(
        &self,
        _: &Viewer,
        _: &str,
        _: usize,
    ) -> Result<Vec<RecordEntries>, WorkflowError> {
        unimplemented!("imports never search")
    }

    async fn record_entries(
        &self,
        _: &Viewer,
        records: &[Uuid],
    ) -> Result<Vec<RecordEntries>, WorkflowError> {
        Ok(vec![RecordEntries {
            pipeline: self.overview.pipeline.clone(),
            entries: self
                .present
                .iter()
                .filter(|id| records.contains(id))
                .map(|id| entry(*id))
                .collect(),
        }])
    }

    async fn add(
        &self,
        _: &Viewer,
        _: Uuid,
        additions: Vec<EntryAddition>,
        allow_duplicates: bool,
    ) -> Result<AddedEntries, WorkflowError> {
        assert!(allow_duplicates, "imports keep every row of a new record");
        let refused = self.refused.is_some_and(|value| {
            additions.iter().any(|addition| {
                addition
                    .set
                    .iter()
                    .any(|(_, input)| *input == FieldInput::One(value.into()))
            })
        });
        if refused {
            return Err(WorkflowError::Invalid("\"Revenue\" takes a number.".into()));
        }
        let added = additions
            .iter()
            .map(|addition| match addition.record {
                RecordTarget::Id(id) => entry(id),
                RecordTarget::Email(_) => unreachable!("imports add records by id"),
            })
            .collect();
        self.added.lock().unwrap().extend(additions);
        Ok(AddedEntries {
            added,
            already_present: Vec::new(),
            version: None,
        })
    }

    async fn update(
        &self,
        _: &Viewer,
        _: Uuid,
        _: Vec<EntryUpdate>,
        _: Option<TableVersion>,
    ) -> Result<UpdatedEntries, WorkflowError> {
        unimplemented!("imports never update")
    }

    async fn remove(
        &self,
        _: &Viewer,
        _: Uuid,
        _: Vec<EntryTarget>,
    ) -> Result<RemovedEntries, WorkflowError> {
        unimplemented!("imports never remove")
    }

    async fn create(
        &self,
        _: &Viewer,
        input: NewPipeline,
    ) -> Result<PipelineOverview, WorkflowError> {
        let mut overview = self.overview.clone();
        overview.pipeline.pipeline.name = input.name.clone();
        self.created.lock().unwrap().push(input);
        Ok(overview)
    }

    async fn edit(
        &self,
        _: &Viewer,
        _: Uuid,
        edit: PipelineEdit,
    ) -> Result<PipelineOverview, WorkflowError> {
        self.edits.lock().unwrap().push(edit);
        Ok(self.overview.clone())
    }
}

/// A team CRM in memory: companies by domain, contacts by email.
#[derive(Default)]
struct Records {
    domains: HashMap<String, Uuid>,
    contacts: HashMap<String, Uuid>,
    ambiguous_contacts: HashSet<String>,
    unavailable_contacts: HashSet<String>,
    companies_created: Mutex<Vec<String>>,
    contacts_created: Mutex<Vec<(Uuid, String)>>,
}

impl TransferRecords for Records {
    async fn company_domains(&self, _: &Viewer) -> Result<HashMap<String, Uuid>, TransferError> {
        Ok(self.domains.clone())
    }

    async fn create_company(
        &self,
        _: &Viewer,
        _: &str,
        domain: &str,
    ) -> Result<Created, TransferError> {
        if domain == "gmail.com" {
            return Ok(Created::Refused(
                "gmail.com is a personal email domain".into(),
            ));
        }
        let mut created = self.companies_created.lock().unwrap();
        if created.iter().any(|known| known == domain) {
            return Ok(Created::Exists);
        }
        created.push(domain.to_owned());
        Ok(Created::New(Uuid::new_v5(
            &Uuid::NAMESPACE_DNS,
            domain.as_bytes(),
        )))
    }

    async fn contact(&self, _: &Viewer, email: &str) -> Result<Option<Uuid>, TransferError> {
        if self.ambiguous_contacts.contains(email) {
            return Err(CrmError::InvalidRequest(
                "Multiple contacts use this email. Select a contact by ID instead.".into(),
            )
            .into());
        }
        if self.unavailable_contacts.contains(email) {
            return Err(CrmError::StorageLayerError(anyhow::anyhow!("lookup unavailable")).into());
        }
        Ok(self.contacts.get(email).copied())
    }

    async fn create_contact(
        &self,
        _: &Viewer,
        company: Uuid,
        _: &str,
        email: &str,
    ) -> Result<Created, TransferError> {
        self.contacts_created
            .lock()
            .unwrap()
            .push((company, email.to_owned()));
        Ok(Created::New(Uuid::new_v5(
            &Uuid::NAMESPACE_OID,
            email.as_bytes(),
        )))
    }
}

/// Files in memory: `file` to read, and what was saved.
#[derive(Default)]
struct Files {
    file: Option<CsvFile>,
    saved: Mutex<Vec<(String, String)>>,
}

impl CsvFiles for Files {
    async fn read(&self, _: &Viewer, _: Uuid) -> Result<CsvFile, TransferError> {
        self.file
            .clone()
            .ok_or_else(|| TransferError::File("no such file".into()))
    }

    async fn save(&self, _: &Viewer, name: &str, text: String) -> Result<Uuid, TransferError> {
        self.saved.lock().unwrap().push((name.to_owned(), text));
        Ok(Uuid::nil())
    }
}

fn id_of(domain: &str) -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_DNS, domain.as_bytes())
}

#[tokio::test]
async fn a_companies_export_restores_stage_and_owner_on_a_new_private_pipeline() {
    let acme = Uuid::now_v7();
    let service = CrmTransferServiceImpl::new(
        Arc::new(Workflows::new(overview(PipelineRecordType::Company))),
        Records {
            domains: HashMap::from([("acme.com".to_owned(), acme)]),
            ..Records::default()
        },
        Files {
            file: Some(CsvFile {
                name: "Macro Customers Oct 16 2026".into(),
                text: "Company,Domains,Stage,Owner,Revenue,Last interaction\n\
                       Acme,acme.com,Lead,,,2026-10-16\n\
                       Beta,beta.io,Churned,jane@macro.com,,2026-10-15\n\
                       Gamma,gamma.dev,,,,2026-10-14\n\
                       Gmail,gmail.com,Lead,,,2026-10-13\n"
                    .into(),
            }),
            ..Files::default()
        },
    );
    let outcome = service
        .import_companies(&viewer(), CsvInput::File(Uuid::nil()), None)
        .await
        .unwrap();
    assert_eq!((outcome.created, outcome.existing), (2, 1));
    assert_eq!(outcome.failed.len(), 1);
    assert_eq!(outcome.failed[0].key, "gmail.com");

    let created = service.workflows.created.lock().unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].name, "Macro Customers Oct 16 2026");
    assert_eq!(created[0].sharing, PipelineSharing::Private);

    let pipeline = outcome.pipeline.unwrap();
    assert_eq!(pipeline.added, 2);
    assert_eq!(pipeline.filled_fields, ["Stage", "Owner"]);
    assert_eq!(pipeline.unresolved.len(), 1);
    assert_eq!(
        pipeline.added_options,
        [("Stage".to_owned(), vec!["Churned".to_owned()])]
    );
    let added = service.workflows.added.lock().unwrap();
    assert_eq!(added[0].record, RecordTarget::Id(acme));
    assert_eq!(
        added[0].set,
        [("Stage".to_owned(), FieldInput::One("Lead".into()))]
    );
    assert_eq!(added[1].record, RecordTarget::Id(id_of("beta.io")));
    assert_eq!(
        added[1].set,
        [
            ("Stage".to_owned(), FieldInput::One("Churned".into())),
            ("Owner".to_owned(), FieldInput::One("jane@macro.com".into())),
        ]
    );
}

#[tokio::test]
async fn a_companies_csv_without_pipeline_values_makes_no_pipeline() {
    let service = CrmTransferServiceImpl::new(
        Arc::new(Workflows::new(overview(PipelineRecordType::Company))),
        Records::default(),
        Files::default(),
    );
    let outcome = service
        .import_companies(
            &viewer(),
            CsvInput::Text("name,website\nAcme,https://www.acme.com/\nNo domain,\n".into()),
            None,
        )
        .await
        .unwrap();
    assert_eq!((outcome.created, outcome.skipped_rows), (1, 1));
    assert!(outcome.pipeline.is_none());
    assert!(service.workflows.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_pipeline_import_skips_present_records_keeps_new_deals_and_isolates_bad_rows() {
    let acme = Uuid::now_v7();
    let mut workflows = Workflows::new(overview(PipelineRecordType::Company));
    workflows.present = vec![acme];
    workflows.refused = Some("lots");
    let pipeline = workflows.overview.pipeline.pipeline.id;
    let service = CrmTransferServiceImpl::new(
        Arc::new(workflows),
        Records {
            domains: HashMap::from([("acme.com".to_owned(), acme)]),
            ..Records::default()
        },
        Files::default(),
    );
    let outcome = service
        .import_to_pipeline(
            &viewer(),
            pipeline,
            CsvInput::Text(
                "Company,Domain,Stage,Revenue,Proposal,Notes\n\
                 Acme,acme.com,Lead,10,doc-1,\n\
                 Beta,beta.io,Lead,20,,first deal\n\
                 Beta,beta.io,Lead,30,,second deal\n\
                 Delta,delta.dev,Lead,lots,,\n"
                    .into(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.already_present, 1);
    assert_eq!(outcome.added, 2);
    assert_eq!(outcome.created_records, 2);
    assert_eq!(outcome.invalid.len(), 1);
    assert_eq!(outcome.invalid[0].key, "delta.dev");
    assert_eq!(outcome.filled_fields, ["Stage", "Revenue"]);
    assert_eq!(outcome.ignored_columns, ["Proposal", "Notes"]);
    assert!(outcome.added_options.is_empty());
}

#[tokio::test]
async fn a_rejected_currency_row_does_not_add_its_stage_option() {
    let mut workflows = Workflows::new(overview(PipelineRecordType::Company));
    let currency = PipelineField {
        options: vec![
            (OptionId::new(), "USD".into()),
            (OptionId::new(), "EUR".into()),
        ],
        ..field("Revenue currency", FieldKind::Select)
    };
    workflows
        .overview
        .pipeline
        .pipeline
        .commercial_fields
        .money
        .push(crate::domain::pipeline_commercial::MoneyColumn {
            amount: workflows.overview.fields[3].id,
            currency: currency.id,
        });
    workflows.overview.fields.push(currency);
    workflows.refused = Some("XYZ");
    let pipeline = workflows.overview.pipeline.pipeline.id;
    let service = CrmTransferServiceImpl::new(
        Arc::new(workflows),
        Records {
            domains: HashMap::from([
                ("valid.example".into(), Uuid::now_v7()),
                ("invalid.example".into(), Uuid::now_v7()),
            ]),
            ..Records::default()
        },
        Files::default(),
    );

    let outcome = service
        .import_to_pipeline(
            &viewer(),
            pipeline,
            CsvInput::Text(
                "Company,Domain,Stage,Revenue currency\n\
                 Valid,valid.example,Qualified,USD\n\
                 Invalid,invalid.example,Do not add,XYZ\n"
                    .into(),
            ),
        )
        .await
        .unwrap();

    assert_eq!(outcome.added, 1);
    assert_eq!(outcome.invalid.len(), 1);
    assert_eq!(outcome.invalid[0].key, "invalid.example");
    assert_eq!(
        outcome.added_options,
        [("Stage".into(), vec!["Qualified".into()])]
    );
    let edits = service.workflows.edits.lock().unwrap();
    assert_eq!(edits.len(), 1);
    assert_eq!(
        edits[0].add_options,
        [("Stage".into(), vec!["Qualified".into()])]
    );
}

#[tokio::test]
async fn new_contacts_at_one_new_domain_share_one_new_company() {
    let mut contacts = overview(PipelineRecordType::Contact);
    contacts.fields[0].name = "Contact".into();
    let pipeline = contacts.pipeline.pipeline.id;
    let known = Uuid::now_v7();
    let service = CrmTransferServiceImpl::new(
        Arc::new(Workflows::new(contacts)),
        Records {
            contacts: HashMap::from([("ana@acme.com".to_owned(), known)]),
            ..Records::default()
        },
        Files::default(),
    );
    let outcome = service
        .import_to_pipeline(
            &viewer(),
            pipeline,
            CsvInput::Text(
                "Contact,Email\nJane,jane@beta.io\nRaj,raj@beta.io\nAna,ana@acme.com\n".into(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.added, 3);
    assert!(outcome.unresolved.is_empty(), "{:?}", outcome.unresolved);
    assert_eq!(
        *service.records.companies_created.lock().unwrap(),
        ["beta.io"]
    );
    let mut created = service.records.contacts_created.lock().unwrap().clone();
    created.sort();
    assert_eq!(
        created,
        [
            (id_of("beta.io"), "jane@beta.io".to_owned()),
            (id_of("beta.io"), "raj@beta.io".to_owned()),
        ]
    );
}

#[tokio::test]
async fn ambiguous_contacts_are_unresolved_without_blocking_other_csv_rows() {
    let mut contacts = overview(PipelineRecordType::Contact);
    contacts.fields[0].name = "Contact".into();
    let pipeline = contacts.pipeline.pipeline.id;
    let known = Uuid::now_v7();
    let service = CrmTransferServiceImpl::new(
        Arc::new(Workflows::new(contacts)),
        Records {
            contacts: HashMap::from([("existing@example.com".into(), known)]),
            ambiguous_contacts: HashSet::from(["shared@ambiguous.example.com".into()]),
            ..Records::default()
        },
        Files::default(),
    );
    let outcome = service
        .import_to_pipeline(
            &viewer(),
            pipeline,
            CsvInput::Text(
                "Contact,Email\n\
                 Shared,shared@ambiguous.example.com\n\
                 Existing,existing@example.com\n\
                 New,new@new.example.com\n\
                 Shared again,shared@ambiguous.example.com\n"
                    .into(),
            ),
        )
        .await
        .unwrap();

    assert_eq!((outcome.added, outcome.created_records), (2, 1));
    assert_eq!(
        outcome.unresolved,
        [SkippedRecord {
            key: "shared@ambiguous.example.com".into(),
            reason: "Multiple contacts use this email. Select a contact by ID instead.".into(),
        }]
    );
    assert_eq!(
        *service.records.companies_created.lock().unwrap(),
        ["new.example.com"]
    );
    assert_eq!(
        *service.records.contacts_created.lock().unwrap(),
        [(id_of("new.example.com"), "new@new.example.com".into())]
    );
    let added = service.workflows.added.lock().unwrap();
    assert_eq!(added[0].record, RecordTarget::Id(known));
    assert_eq!(
        added[1].record,
        RecordTarget::Id(Uuid::new_v5(&Uuid::NAMESPACE_OID, b"new@new.example.com"))
    );
}

#[tokio::test]
async fn contact_lookup_storage_failure_stops_import_before_creating_records() {
    let mut contacts = overview(PipelineRecordType::Contact);
    contacts.fields[0].name = "Contact".into();
    let pipeline = contacts.pipeline.pipeline.id;
    let service = CrmTransferServiceImpl::new(
        Arc::new(Workflows::new(contacts)),
        Records {
            unavailable_contacts: HashSet::from(["unavailable@example.com".into()]),
            ..Records::default()
        },
        Files::default(),
    );
    let error = service
        .import_to_pipeline(
            &viewer(),
            pipeline,
            CsvInput::Text(
                "Contact,Email\nNew,new@new.example.com\nUnavailable,unavailable@example.com\n"
                    .into(),
            ),
        )
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        TransferError::Crm(CrmError::StorageLayerError(_))
    ));
    assert!(service.records.companies_created.lock().unwrap().is_empty());
    assert!(service.records.contacts_created.lock().unwrap().is_empty());
    assert!(service.workflows.added.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_export_writes_people_as_emails_and_reimports() {
    let mut workflows = Workflows::new(overview(PipelineRecordType::Company));
    let currency = PipelineField {
        options: vec![
            (OptionId::new(), "EUR".into()),
            (OptionId::new(), "USD".into()),
        ],
        ..field("Revenue currency", FieldKind::Select)
    };
    workflows
        .overview
        .pipeline
        .pipeline
        .commercial_fields
        .money
        .push(crate::domain::pipeline_commercial::MoneyColumn {
            amount: workflows.overview.fields[3].id,
            currency: currency.id,
        });
    workflows.overview.fields.push(currency);
    workflows
        .overview
        .fields
        .push(field("Contract period", FieldKind::DateRange));
    workflows.exported = vec![PipelineEntryView {
        currencies: Default::default(),
        entry_id: RowId::new(),
        record: PipelineRecord {
            id: Uuid::now_v7(),
            name: Some("=Acme".into()),
            detail: Some("acme.com".into()),
        },
        fields: vec![
            ("Stage".into(), FieldValue::Labels(vec!["Lead".into()])),
            (
                "Owner".into(),
                FieldValue::References(vec!["macro|jane@macro.com".into()]),
            ),
            ("Revenue".into(), FieldValue::Number(48000.1234)),
            (
                "Revenue currency".into(),
                FieldValue::Labels(vec!["EUR".into()]),
            ),
            (
                "Contract period".into(),
                FieldValue::DateRange(DateRange {
                    start: Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap(),
                    end: Utc.with_ymd_and_hms(2026, 11, 30, 0, 0, 0).unwrap(),
                }),
            ),
        ],
    }];
    let pipeline = workflows.overview.pipeline.pipeline.id;
    let service =
        CrmTransferServiceImpl::new(Arc::new(workflows), Records::default(), Files::default());
    let export = service.export_pipeline(&viewer(), pipeline).await.unwrap();
    assert_eq!((export.rows, export.complete), (1, true));
    let saved = service.files.saved.lock().unwrap().clone();
    assert_eq!(saved[0].0, "Deals");
    assert_eq!(
        saved[0].1,
        "Company,Domain,Stage,Owner,Revenue,Proposal,Revenue currency,Contract period\n'=Acme,acme.com,Lead,jane@macro.com,48000.1234,,EUR,2026-11-01T00:00:00Z/2026-11-30T00:00:00Z\n"
    );
    let table = parse_csv(&saved[0].1).unwrap();
    let rows = record_rows(&table, PipelineRecordType::Company).unwrap();
    assert_eq!(rows.rows[0].name, "=Acme");
    service
        .import_to_pipeline(&viewer(), pipeline, CsvInput::Text(saved[0].1.clone()))
        .await
        .unwrap();
    let added = service.workflows.added.lock().unwrap();
    assert!(
        added[0]
            .set
            .contains(&("Revenue".into(), FieldInput::One("48000.1234".into())))
    );
    assert!(
        added[0]
            .set
            .contains(&("Revenue currency".into(), FieldInput::One("EUR".into())))
    );
    assert!(added[0].set.contains(&(
        "Contract period".into(),
        FieldInput::One("2026-11-01T00:00:00Z/2026-11-30T00:00:00Z".into())
    )));
}
