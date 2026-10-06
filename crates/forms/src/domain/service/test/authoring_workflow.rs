//! End-to-end workflow assertions at the domain boundary, before tool adapters.
use super::*;
use crate::domain::authoring::{Create, workflow::AuthoringWorkflow};
use crate::domain::authoring::{
    journal::{AuthoringJournal, Claim, Operation},
    ports::{AuthoringAccess, FormsAuthoringService},
    *,
};
use serde_json::json;
use std::collections::HashMap;

#[derive(Default)]
struct Records {
    operations: HashMap<(String, AuthoringRequestId), Operation>,
    baselines: HashMap<(String, AuthoringRevisionId), Snapshot>,
}
struct Journal {
    records: Mutex<Records>,
    world: Shared,
}
impl AuthoringJournal for Journal {
    async fn claim(
        &self,
        actor: &MacroUserIdStr<'_>,
        operation: Operation,
    ) -> Result<Claim, AuthoringError> {
        let mut records = self.records.lock().unwrap();
        let key = (actor.to_string(), operation.intent.request_id());
        if let Some(existing) = records.operations.get(&key) {
            if existing.intent != operation.intent {
                return Err(AuthoringError::new(
                    Code::IdempotencyConflict,
                    "requestId",
                    "Changed intent",
                ));
            }
            return Ok(Claim::Existing(existing.clone()));
        }
        records.operations.insert(key, operation.clone());
        Ok(Claim::New(operation))
    }
    async fn save(
        &self,
        actor: &MacroUserIdStr<'_>,
        operation: &Operation,
    ) -> Result<(), AuthoringError> {
        self.records.lock().unwrap().operations.insert(
            (actor.to_string(), operation.intent.request_id()),
            operation.clone(),
        );
        Ok(())
    }
    async fn operation(
        &self,
        actor: &MacroUserIdStr<'_>,
        id: AuthoringOperationId,
    ) -> Result<Option<Operation>, AuthoringError> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .operations
            .get(&(
                actor.to_string(),
                AuthoringRequestId::from_uuid(id.into_uuid()),
            ))
            .cloned())
    }
    async fn retain(
        &self,
        actor: &MacroUserIdStr<'_>,
        snapshot: &Snapshot,
    ) -> Result<AuthoringRevisionId, AuthoringError> {
        let id = AuthoringRevisionId::new();
        self.records
            .lock()
            .unwrap()
            .baselines
            .insert((actor.to_string(), id), snapshot.clone());
        Ok(id)
    }
    async fn baseline(
        &self,
        actor: &MacroUserIdStr<'_>,
        form: FormId,
        id: AuthoringRevisionId,
    ) -> Result<Option<Snapshot>, AuthoringError> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .baselines
            .get(&(actor.to_string(), id))
            .filter(|s| s.form.id == form)
            .cloned())
    }
    async fn grants(&self, _: FormId) -> Result<Vec<Grant>, AuthoringError> {
        Ok(vec![])
    }
    async fn settings(
        &self,
        expected: &Snapshot,
        update: &models_forms::UpdateForm,
        grants: &[GrantChange],
        _: bool,
    ) -> Result<(), AuthoringError> {
        assert!(
            grants.is_empty(),
            "these fixtures do not exercise channel persistence"
        );
        let mut world = self.world.lock().unwrap();
        let saved = world
            .forms
            .iter_mut()
            .find(|f| f.form.id == expected.form.id)
            .unwrap();
        if saved.form != expected.form {
            return Err(AuthoringError::new(
                Code::ConcurrentFieldChange,
                "form",
                "Changed metadata",
            ));
        }
        if let Some(value) = &update.description {
            saved.form.description = value.clone();
        }
        if let Some(value) = &update.confirmation_message {
            saved.form.confirmation_message = value.clone();
        }
        if let Some(value) = update.audience {
            saved.form.audience = value;
        }
        if let Some(value) = update.status {
            saved.form.status = value;
        }
        if let Some(value) = update.closes_at {
            saved.form.closes_at = value;
        }
        if let Some(value) = update.tally_visible {
            saved.form.tally_visible = value;
        }
        Ok(())
    }
}
struct Access(Shared);
impl AuthoringAccess for Access {
    async fn receipt<L: RequiredPermission>(
        &self,
        actor: &Viewer,
        entity: Entity,
    ) -> Result<EntityAccessReceipt<L>, AuthoringError> {
        let world = self.0.lock().unwrap();
        let owner = match entity.entity_type {
            EntityType::Form => world
                .forms
                .iter()
                .find(|f| f.form.id.to_string() == entity.entity_id)
                .map(|f| f.form.owner_id.as_str()),
            EntityType::Database => world
                .databases
                .iter()
                .find(|d| d.id.to_string() == entity.entity_id)
                .map(|d| d.owner.as_str()),
            _ => None,
        };
        let level = if owner == Some(actor.user_id.as_ref()) {
            Some(AccessLevel::Owner)
        } else {
            world
                .form_grants
                .get(actor.user_id.as_ref())
                .and_then(|grants| {
                    grants
                        .iter()
                        .find(|(id, _)| id.to_string() == entity.entity_id)
                        .map(|(_, level)| *level)
                })
        }
        .ok_or_else(|| AuthoringError::new(Code::Forbidden, "formId", "No grant"))?;
        EntityAccessReceipt::try_new_authenticated_user(
            actor.user_id.clone(),
            entity,
            EntityPermission::AccessLevel {
                access_level: level,
            },
        )
        .map_err(|_| AuthoringError::new(Code::Forbidden, "formId", "Insufficient grant"))
    }
}

#[tokio::test]
async fn complete_creation_stays_closed_and_retries_do_not_duplicate_the_database() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "requestId": "0199bfee-1000-7000-8000-000000000001", "name": "Startup intake", "source": {"kind":"new"},
        "draft": {"sections":[
            {"kind":"questions","key":"company","questions":[
                {"key":"revenue","column":{"kind":"new","name":"Revenue","type":{"type":"number"}},"required":true}
            ]},
            {"kind":"gate","key":"eligible","message":"Please try again later.","rules":{"conjunction":"and","conditions":[
                {"kind":"condition","question":{"key":"revenue"},"test":{"kind":"value","test":{"kind":"number","operator":"greaterThanOrEqual","value":100000}}}
            ]}}
        ]}
    })).unwrap();
    let created = workflow
        .create_form(viewer(OWNER), intent.clone())
        .await
        .expect("complete closed form");
    assert_eq!(
        created.state,
        MutationState::Completed,
        "{:?}",
        created.diagnostics
    );
    assert!(!created.saved.as_ref().unwrap().accepting_responses);
    assert_eq!(created.saved.as_ref().unwrap().layout.sections.len(), 2);
    let retried = workflow
        .create_form(viewer(OWNER), intent)
        .await
        .expect("same request returns saved identity");
    assert_eq!(retried.form_id, created.form_id);
    let state = world.lock().unwrap();
    assert_eq!(state.created_databases.len(), 1);
    assert_eq!(state.forms.len(), 1);
    assert_eq!(state.forms[0].form.status, FormStatus::Closed);
    assert_eq!(state.forms[0].form.audience, Audience::Members);
}

#[tokio::test]
async fn existing_table_requires_owner_before_provisioning() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "requestId":"0199bfee-1000-7000-8000-000000000002","name":"Unauthorized","source":{"kind":"table","databaseId":RSVP_DATABASE,"tableId":RSVP_TABLE},"draft":{"sections":[]}
    })).unwrap();
    let result = workflow
        .create_form(viewer(OWNER), intent)
        .await
        .unwrap_err();
    assert_eq!(result.code, crate::domain::authoring::Code::Forbidden);
    assert!(world.lock().unwrap().created_databases.is_empty());
}

#[tokio::test]
async fn authoring_preserves_human_edits_then_opens_the_reviewed_form_without_response_leakage() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "requestId":"0199bfee-1000-7000-8000-000000000003", "name":"Intake", "source":{"kind":"new"},
        "draft":{"sections":[{"kind":"questions","key":"intro","questions":[{"key":"name","column":{"kind":"new","name":"Company","type":{"type":"text"}}}]}]}
    })).unwrap();
    let created = workflow.create_form(viewer(OWNER), intent).await.unwrap();
    let saved = created.saved.unwrap();
    let id = saved.form.id;
    let question = created.keys.questions["name"];
    let mut human_layout = saved.layout.clone();
    let FormSection::Questions { questions, .. } = &mut human_layout.sections[0] else {
        panic!("questions");
    };
    questions[0].required = true;
    workflow
        .core
        .put_layout(form_receipt(id, OWNER, AccessLevel::Owner), human_layout)
        .await
        .unwrap();
    let edit = Edit {
        request_id: AuthoringRequestId::new(),
        form_id: id,
        base_revision: saved.revision,
        changes: vec![Change::SetQuestion {
            question_id: question,
            help_text: Some("Your registered company name".into()),
            required: None,
            widget: None,
        }],
        new_columns: vec![],
        description: None,
        confirmation_message: None,
    };
    let edited = workflow
        .edit_form(viewer(OWNER), edit.clone())
        .await
        .unwrap();
    assert_eq!(
        edited.state,
        MutationState::Completed,
        "{:?}",
        edited.diagnostics
    );
    let saved = edited.saved.as_ref().unwrap();
    let FormSection::Questions { questions, .. } = &saved.layout.sections[0] else {
        panic!("questions");
    };
    assert!(questions[0].required);
    assert_eq!(questions[0].help_text, "Your registered company name");
    assert_eq!(
        workflow
            .edit_form(viewer(OWNER), edit)
            .await
            .unwrap()
            .operation_id,
        edited.operation_id
    );
    let access = SetAccess {
        request_id: AuthoringRequestId::new(),
        form_id: id,
        base_revision: saved.revision,
        draft: AccessDraft {
            audience: Audience::Public,
            status: FormStatus::Open,
            closes_at: None,
            tally_visible: false,
            channel_grants: vec![],
        },
    };
    world
        .lock()
        .unwrap()
        .form_grants
        .insert(EDITOR.into(), vec![(id, AccessLevel::Edit)]);
    assert_eq!(
        workflow
            .set_form_access(viewer(EDITOR), access.clone())
            .await
            .unwrap_err()
            .code,
        Code::Forbidden
    );
    let opened = workflow
        .set_form_access(viewer(OWNER), access.clone())
        .await
        .unwrap();
    assert_eq!(
        opened.state,
        MutationState::Completed,
        "{:?}",
        opened.diagnostics
    );
    assert!(opened.saved.unwrap().accepting_responses);
    assert_eq!(
        workflow
            .set_form_access(viewer(OWNER), access)
            .await
            .unwrap()
            .operation_id,
        opened.operation_id
    );
    let respondent = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: id,
                view: ReadView::Respondent,
                include_summary: false,
                operation_id: None,
            },
        )
        .await
        .unwrap();
    let ReadResult::Respondent { detail, .. } = respondent else {
        panic!("respondent");
    };
    assert_eq!(detail.access, models_forms::FormAccess::View);
    assert_eq!(
        workflow
            .read_form(
                viewer(OWNER),
                Read {
                    form_id: id,
                    view: ReadView::Respondent,
                    include_summary: true,
                    operation_id: None
                }
            )
            .await
            .unwrap_err()
            .code,
        Code::Forbidden
    );
    assert_eq!(
        workflow
            .read_form(
                viewer(STRANGER),
                Read {
                    form_id: id,
                    view: ReadView::Authoring,
                    include_summary: false,
                    operation_id: None
                }
            )
            .await
            .unwrap_err()
            .code,
        Code::Forbidden
    );
    assert!(
        workflow
            .list_forms(viewer(STRANGER), List::default())
            .await
            .unwrap()
            .forms
            .is_empty()
    );
}

#[tokio::test]
async fn interrupted_creation_reports_partial_and_never_provisions_again_on_retry() {
    let world = world();
    world.lock().unwrap().fail_drafts = true;
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({"requestId":"0199bfee-1000-7000-8000-000000000004", "name":"Interrupted", "source":{"kind":"new"}, "draft":{"sections":[]}})).unwrap();
    let first = workflow
        .create_form(viewer(OWNER), intent.clone())
        .await
        .unwrap();
    assert_eq!(first.state, MutationState::PartiallyApplied);
    assert!(!first.diagnostics.is_empty());
    world.lock().unwrap().fail_drafts = false;
    let retried = workflow
        .create_form(viewer(OWNER), intent.clone())
        .await
        .unwrap();
    assert_eq!(retried.form_id, first.form_id);
    assert_eq!(retried.state, MutationState::PartiallyApplied);
    assert_eq!(world.lock().unwrap().created_databases.len(), 1);
    let changed = Create {
        name: "A different request".into(),
        ..intent
    };
    assert_eq!(
        workflow
            .create_form(viewer(OWNER), changed)
            .await
            .unwrap_err()
            .code,
        Code::IdempotencyConflict
    );
}

#[tokio::test]
async fn existing_table_creation_retries_before_schema_preflight_and_protects_managed_bindings() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().forms.clear();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let managed: Create = serde_json::from_value(json!({ "requestId":AuthoringRequestId::new(), "name":"Managed", "source":{"kind":"table","databaseId":RSVP_DATABASE,"tableId":RSVP_TABLE}, "draft":{"sections":[{"kind":"questions","key":"section","questions":[{"key":"submitted","column":{"kind":"existing","columnId":SUBMITTED}}]}]} })).unwrap();
    assert_eq!(
        workflow
            .create_form(viewer(OWNER), managed)
            .await
            .unwrap_err()
            .code,
        Code::RepeatedColumn
    );
    assert!(world.lock().unwrap().forms.is_empty());
    assert!(world.lock().unwrap().batches.is_empty());
    let create: Create = serde_json::from_value(json!({ "requestId":AuthoringRequestId::new(), "name":"Startup intake", "source":{"kind":"table","databaseId":RSVP_DATABASE,"tableId":RSVP_TABLE}, "draft":{"sections":[{"kind":"questions","key":"section","questions":[{"key":"revenue","column":{"kind":"new","name":"Annual revenue","type":{"type":"number"}}}]}]} })).unwrap();
    let first = workflow
        .create_form(viewer(OWNER), create.clone())
        .await
        .unwrap();
    assert_eq!(
        first.state,
        MutationState::Completed,
        "{:?}",
        first.diagnostics
    );
    let retry = workflow.create_form(viewer(OWNER), create).await.unwrap();
    assert_eq!(retry.form_id, first.form_id);
    assert_eq!(retry.keys, first.keys);
    assert_eq!(world.lock().unwrap().forms.len(), 1);
}

#[tokio::test]
async fn a_managed_name_is_rejected_before_new_database_creation() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let create: Create = serde_json::from_value(json!({ "requestId":AuthoringRequestId::new(), "name":"Invalid", "source":{"kind":"new"}, "draft":{"sections":[{"kind":"questions","key":"section","questions":[{"key":"submitted","column":{"kind":"new","name":"Submitted","type":{"type":"text"}}}]}]} })).unwrap();
    assert_eq!(
        workflow
            .create_form(viewer(OWNER), create)
            .await
            .unwrap_err()
            .code,
        Code::DuplicateDisplayLabel
    );
    assert!(world.lock().unwrap().created_databases.is_empty());
}

#[tokio::test]
async fn unrelated_schema_additions_do_not_block_targeted_help_edits() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
                operation_id: None,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring");
    };
    {
        let mut state = world.lock().unwrap();
        state.database_mut(RSVP_DATABASE).tables[0]
            .columns
            .push(FakeColumn {
                id: ColumnId::new(),
                name: "Internal sales notes".into(),
                kind: ColumnKind::Text,
                options: vec![],
            });
        state.database_mut(RSVP_DATABASE).tables[0].version += 1;
    }
    let result = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                request_id: AuthoringRequestId::new(),
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                changes: vec![Change::SetQuestion {
                    question_id: TEAM_QUESTION,
                    help_text: Some("Choose your team".into()),
                    required: None,
                    widget: None,
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        result.state,
        MutationState::Completed,
        "{:?}",
        result.diagnostics
    );
}

#[tokio::test]
async fn owners_can_close_an_open_form_with_an_invalid_newer_draft() {
    use crate::domain::drafts::FormDraftStore;
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    workflow
        .core
        .collaborate_form(form_receipt(RSVP_FORM, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let bytes = FakeDrafts(world.clone()).snapshot(RSVP_FORM).await.unwrap();
    let mut layout = crate::domain::collaboration::read_layout(&bytes)
        .unwrap()
        .layout;
    let FormSection::Questions { questions, .. } = &mut layout.sections[0] else {
        panic!("questions");
    };
    questions[0].column = ColumnId::new();
    let change = crate::domain::collaboration::replace_layout(&bytes, &layout).unwrap();
    FakeDrafts(world.clone())
        .update(RSVP_FORM, change.expected_revision, change.update)
        .await
        .unwrap();
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
                operation_id: None,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring");
    };
    assert!(!saved.projected);
    assert!(
        saved.accepting_responses,
        "the previous valid projection is still open"
    );
    let result = workflow
        .set_form_access(
            viewer(OWNER),
            SetAccess {
                request_id: AuthoringRequestId::new(),
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                draft: AccessDraft {
                    audience: Audience::Public,
                    status: FormStatus::Closed,
                    closes_at: None,
                    tally_visible: false,
                    channel_grants: vec![],
                },
            },
        )
        .await
        .unwrap();
    assert!(!result.saved.unwrap().accepting_responses);
    assert_eq!(
        world.lock().unwrap().forms[0].form.status,
        FormStatus::Closed
    );
}

struct EditingBooking(Shared);
impl crate::domain::authoring::ports::AuthoringBooking for EditingBooking {
    async fn check_target(
        &self,
        _: &Viewer,
        _: &models_forms::BookingTarget,
    ) -> Result<(), AuthoringError> {
        use crate::domain::drafts::FormDraftStore;
        let drafts = FakeDrafts(self.0.clone());
        let bytes = drafts.snapshot(RSVP_FORM).await.unwrap();
        let mut layout = crate::domain::collaboration::read_layout(&bytes)
            .unwrap()
            .layout;
        let FormSection::Questions { questions, .. } = &mut layout.sections[0] else {
            panic!("questions");
        };
        questions[0].column = ColumnId::new();
        let change = crate::domain::collaboration::replace_layout(&bytes, &layout).unwrap();
        drafts
            .update(RSVP_FORM, change.expected_revision, change.update)
            .await
            .unwrap();
        Ok(())
    }
}

#[tokio::test]
async fn sharing_rechecks_durable_draft_after_booking_readiness() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    {
        let mut state = world.lock().unwrap();
        state.forms[0].form.status = FormStatus::Closed;
        state
            .layouts
            .get_mut(&RSVP_FORM)
            .unwrap()
            .sections
            .push(FormSection::Booking {
                id: models_forms::FormSectionId::new(),
                title: "Book a call".into(),
                description: String::new(),
                target: models_forms::BookingTarget {
                    profile_id: models_forms::BookingProfileId::new(),
                    event_type_id: models_forms::BookingEventTypeId::new(),
                },
            });
    }
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: EditingBooking(world.clone()),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
                operation_id: None,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring");
    };
    let result = workflow
        .set_form_access(
            viewer(OWNER),
            SetAccess {
                request_id: AuthoringRequestId::new(),
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                draft: AccessDraft {
                    audience: Audience::Public,
                    status: FormStatus::Open,
                    closes_at: None,
                    tally_visible: false,
                    channel_grants: vec![],
                },
            },
        )
        .await;
    assert_eq!(result.unwrap_err().code, Code::ConcurrentFieldChange);
    let state = world.lock().unwrap();
    assert_eq!(state.forms[0].form.status, FormStatus::Closed);
    assert_eq!(state.forms[0].form.audience, Audience::Members);
    assert!(
        workflow
            .journal
            .records
            .lock()
            .unwrap()
            .operations
            .is_empty()
    );
}

#[tokio::test]
async fn read_reconciles_saved_work_without_overwriting_an_inflight_claim() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let create: Create = serde_json::from_value(json!({"requestId":AuthoringRequestId::new(),"name":"Recoverable intake","source":{"kind":"new"},"draft":{"sections":[{"kind":"questions","key":"company","questions":[{"key":"name","column":{"kind":"new","name":"Company","type":{"type":"text"}}}]}]}})).unwrap();
    let request_id = create.request_id;
    let created = workflow.create_form(viewer(OWNER), create).await.unwrap();
    {
        let mut records = workflow.journal.records.lock().unwrap();
        let operation = records
            .operations
            .get_mut(&(OWNER.to_string(), request_id))
            .unwrap();
        operation.result.state = MutationState::Pending;
        operation.result.phase = OperationPhase::SchemaApplied;
        operation.result.saved = None;
    }
    let ReadResult::Authoring {
        operation: Some(recovered),
        ..
    } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: created.form_id,
                view: ReadView::Authoring,
                include_summary: false,
                operation_id: Some(created.operation_id),
            },
        )
        .await
        .unwrap()
    else {
        panic!("operation recovery");
    };
    assert_eq!(recovered.state, MutationState::Completed);
    assert!(recovered.saved.is_some());
    assert!(recovered.diagnostics.is_empty());
    let records = workflow.journal.records.lock().unwrap();
    assert_eq!(
        records.operations[&(OWNER.to_string(), request_id)]
            .result
            .state,
        MutationState::Pending
    );
}

#[tokio::test]
async fn editing_unrelated_questions_preserves_an_existing_private_booking_target() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let booking_id = models_forms::FormSectionId::new();
    {
        let mut state = world.lock().unwrap();
        state
            .form_grants
            .insert(EDITOR.into(), vec![(RSVP_FORM, AccessLevel::Edit)]);
        state
            .layouts
            .get_mut(&RSVP_FORM)
            .unwrap()
            .sections
            .push(FormSection::Booking {
                id: booking_id,
                title: "Book".into(),
                description: String::new(),
                target: models_forms::BookingTarget {
                    profile_id: models_forms::BookingProfileId::new(),
                    event_type_id: models_forms::BookingEventTypeId::new(),
                },
            });
    }
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(EDITOR),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
                operation_id: None,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring");
    };
    let result = workflow
        .edit_form(
            viewer(EDITOR),
            Edit {
                request_id: AuthoringRequestId::new(),
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                changes: vec![Change::SetQuestion {
                    question_id: TEAM_QUESTION,
                    help_text: Some("Your primary team".into()),
                    required: None,
                    widget: None,
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await
        .expect("unrelated question edit does not reattach the existing destination");
    assert_eq!(result.state, MutationState::Completed);
    let saved = result.saved.unwrap();
    let replacement = workflow
        .edit_form(
            viewer(EDITOR),
            Edit {
                request_id: AuthoringRequestId::new(),
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                changes: vec![Change::SetBookingTarget {
                    section_id: booking_id,
                    target: models_forms::BookingTarget {
                        profile_id: models_forms::BookingProfileId::new(),
                        event_type_id: models_forms::BookingEventTypeId::new(),
                    },
                    qualification: Qualification::Advisory,
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await;
    assert_eq!(
        replacement.unwrap_err().code,
        Code::BookingTargetUnavailable
    );
}

struct SchemaEditingBooking(Shared);
impl crate::domain::authoring::ports::AuthoringBooking for SchemaEditingBooking {
    async fn check_target(
        &self,
        _: &Viewer,
        _: &models_forms::BookingTarget,
    ) -> Result<(), AuthoringError> {
        let mut state = self.0.lock().unwrap();
        let table = &mut state.database_mut(RSVP_DATABASE).tables[0];
        table
            .columns
            .iter_mut()
            .find(|c| c.id == TEAM)
            .unwrap()
            .name = "Renamed while checking booking".into();
        table.version += 1;
        Ok(())
    }
}

#[tokio::test]
async fn edited_question_schema_is_rechecked_after_remote_booking_validation() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: SchemaEditingBooking(world.clone()),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
                operation_id: None,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring");
    };
    let baseline_layout = saved.layout.clone();
    let result = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                request_id: AuthoringRequestId::new(),
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                changes: vec![
                    Change::SetQuestion {
                        question_id: TEAM_QUESTION,
                        help_text: Some("Your primary team".into()),
                        required: None,
                        widget: None,
                    },
                    Change::AddSection {
                        section: FormSection::Booking {
                            id: FormSectionId::new(),
                            title: "Call".into(),
                            description: String::new(),
                            target: models_forms::BookingTarget {
                                profile_id: models_forms::BookingProfileId::new(),
                                event_type_id: models_forms::BookingEventTypeId::new(),
                            },
                        },
                        after: saved.layout.sections.last().map(FormSection::id),
                    },
                ],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await;
    assert_eq!(result.unwrap_err().code, Code::ConcurrentFieldChange);
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], baseline_layout);
    assert!(
        workflow
            .journal
            .records
            .lock()
            .unwrap()
            .operations
            .is_empty()
    );
}

#[tokio::test]
async fn failed_ai_attachment_preserves_a_database_adopted_by_a_human() {
    let world = world();
    world.lock().unwrap().adopt_new_database_before_next_batch = true;
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        journal: Journal {
            records: Mutex::default(),
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        app_origin: "https://macro.test".into(),
    };
    let create: Create = serde_json::from_value(json!({"requestId":AuthoringRequestId::new(),"name":"Retain on failure","source":{"kind":"new"},"draft":{"sections":[{"kind":"questions","key":"company","questions":[{"key":"name","column":{"kind":"new","name":"Company","type":{"type":"text"}}}]}]}})).unwrap();
    let result = workflow.create_form(viewer(OWNER), create).await.unwrap();
    assert_eq!(result.state, MutationState::PartiallyApplied);
    let state = world.lock().unwrap();
    assert!(
        state.purged_databases.is_empty(),
        "ambiguous attachment failure must not purge human data"
    );
    let database = state.databases.last().unwrap();
    assert_eq!(database.tables[0].rows.len(), 1);
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.message.contains(&database.id.to_string()))
    );
}
