//! End-to-end workflow assertions at the domain boundary, before tool adapters.
use super::*;
use crate::domain::authoring::{Create, workflow::AuthoringWorkflow};
use crate::domain::authoring::{
    ports::{AuthoringAccess, AuthoringCore, AuthoringSettings, FormsAuthoringService},
    *,
};
use crate::domain::collaboration;
use serde_json::json;

struct Settings {
    world: Shared,
}
impl AuthoringSettings for Settings {
    async fn grants(&self, _: FormId) -> Result<Vec<Grant>, AuthoringError> {
        Ok(vec![])
    }
    async fn settings(
        &self,
        expected: &Snapshot,
        update: &models_forms::UpdateForm,
        grants: &[GrantChange],
        _: bool,
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
async fn each_creation_is_independent_and_stays_closed() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name": "Startup intake", "source": {"kind":"new"},
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
        .expect("another call creates another form");
    assert_ne!(retried.form_id, created.form_id);
    let state = world.lock().unwrap();
    assert_eq!(state.created_databases.len(), 2);
    assert_eq!(state.forms.len(), 2);
    assert_eq!(state.forms[0].form.status, FormStatus::Closed);
    assert_eq!(state.forms[0].form.audience, Audience::Members);
}

#[tokio::test]
async fn existing_table_requires_owner_before_provisioning() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name":"Unauthorized","source":{"kind":"table","databaseId":RSVP_DATABASE,"tableId":RSVP_TABLE},"draft":{"sections":[]}
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
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name":"Intake", "source":{"kind":"new"},
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
        form_id: id,
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
        workflow.edit_form(viewer(OWNER), edit).await.unwrap().state,
        MutationState::Completed
    );
    let access = SetAccess {
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
            .unwrap_err()
            .code,
        Code::ConcurrentFieldChange
    );
    let respondent = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: id,
                view: ReadView::Respondent,
                include_summary: false,
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
async fn interrupted_creation_reports_partial_with_a_form_id_to_inspect() {
    let world = world();
    world.lock().unwrap().fail_drafts = true;
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(
        json!({"name":"Interrupted", "source":{"kind":"new"}, "draft":{"sections":[]}}),
    )
    .unwrap();
    let first = workflow
        .create_form(viewer(OWNER), intent.clone())
        .await
        .unwrap();
    assert_eq!(first.state, MutationState::PartiallyApplied);
    assert!(!first.diagnostics.is_empty());
    assert_eq!(world.lock().unwrap().created_databases.len(), 1);
    assert_eq!(world.lock().unwrap().forms[0].form.id, first.form_id);
}

#[tokio::test]
async fn existing_table_creation_protects_managed_bindings() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().forms.clear();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let managed: Create = serde_json::from_value(json!({ "name":"Managed", "source":{"kind":"table","databaseId":RSVP_DATABASE,"tableId":RSVP_TABLE}, "draft":{"sections":[{"kind":"questions","key":"section","questions":[{"key":"submitted","column":{"kind":"existing","columnId":SUBMITTED}}]}]} })).unwrap();
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
    let create: Create = serde_json::from_value(json!({ "name":"Startup intake", "source":{"kind":"table","databaseId":RSVP_DATABASE,"tableId":RSVP_TABLE}, "draft":{"sections":[{"kind":"questions","key":"section","questions":[{"key":"revenue","column":{"kind":"new","name":"Annual revenue","type":{"type":"number"}}}]}]} })).unwrap();
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
    assert_eq!(world.lock().unwrap().forms.len(), 1);
}

#[tokio::test]
async fn a_managed_name_is_rejected_before_new_database_creation() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let create: Create = serde_json::from_value(json!({ "name":"Invalid", "source":{"kind":"new"}, "draft":{"sections":[{"kind":"questions","key":"section","questions":[{"key":"submitted","column":{"kind":"new","name":"Submitted","type":{"type":"text"}}}]}]} })).unwrap();
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
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
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
                form_id: RSVP_FORM,
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
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
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
        settings: Settings {
            world: world.clone(),
        },
        booking: EditingBooking(world.clone()),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
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
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { .. } = workflow
        .read_form(
            viewer(EDITOR),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
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
                form_id: RSVP_FORM,
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
    assert!(result.saved.is_some());
    let replacement = workflow
        .edit_form(
            viewer(EDITOR),
            Edit {
                form_id: RSVP_FORM,
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
        settings: Settings {
            world: world.clone(),
        },
        booking: SchemaEditingBooking(world.clone()),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
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
                form_id: RSVP_FORM,
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
}

#[tokio::test]
async fn failed_ai_attachment_preserves_a_database_adopted_by_a_human() {
    let world = world();
    world.lock().unwrap().adopt_new_database_before_next_batch = true;
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let create: Create = serde_json::from_value(json!({"name":"Retain on failure","source":{"kind":"new"},"draft":{"sections":[{"kind":"questions","key":"company","questions":[{"key":"name","column":{"kind":"new","name":"Company","type":{"type":"text"}}}]}]}})).unwrap();
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

#[tokio::test]
async fn review_regression_metadata_edit_preserves_human_reference_questions_and_empty_gates() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    {
        let mut state = world.lock().unwrap();
        let column = state.database_mut(RSVP_DATABASE).tables[0]
            .columns
            .iter_mut()
            .find(|c| c.id == TEAM)
            .unwrap();
        column.kind = ColumnKind::Entity {
            target: EntityKind::User,
            multi: false,
        };
        column.options.clear();
        state.layouts.insert(
            RSVP_FORM,
            FormLayout {
                sections: vec![
                    FormSection::Questions {
                        id: ABOUT_YOU,
                        title: "Contact".into(),
                        description: String::new(),
                        questions: vec![QuestionLayout {
                            id: TEAM_QUESTION,
                            column: TEAM,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        }],
                    },
                    FormSection::Gate {
                        id: FormSectionId::new(),
                        title: "Optional screening".into(),
                        description: String::new(),
                        rules: FilterGroup {
                            conjunction: Conjunction::And,
                            conditions: vec![],
                        },
                        message: String::new(),
                    },
                ],
            },
        );
    }
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring read")
    };
    let result = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                form_id: RSVP_FORM,
                changes: vec![],
                new_columns: vec![],
                description: Some("Updated description".into()),
                confirmation_message: None,
            },
        )
        .await
        .expect("unrelated metadata edit must preserve human-authored placements");
    assert_eq!(
        result.state,
        MutationState::Completed,
        "{:?}",
        result.diagnostics
    );
    assert_eq!(result.saved.unwrap().layout, saved.layout);
}

#[tokio::test]
async fn review_regression_sharing_preserves_human_reference_questions_and_empty_gates() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    {
        let mut state = world.lock().unwrap();
        let column = state.database_mut(RSVP_DATABASE).tables[0]
            .columns
            .iter_mut()
            .find(|c| c.id == TEAM)
            .unwrap();
        column.kind = ColumnKind::Entity {
            target: EntityKind::User,
            multi: false,
        };
        column.options.clear();
        state.layouts.insert(
            RSVP_FORM,
            FormLayout {
                sections: vec![
                    FormSection::Questions {
                        id: ABOUT_YOU,
                        title: "Contact".into(),
                        description: String::new(),
                        questions: vec![QuestionLayout {
                            id: TEAM_QUESTION,
                            column: TEAM,
                            help_text: String::new(),
                            required: false,
                            widget: None,
                        }],
                    },
                    FormSection::Gate {
                        id: FormSectionId::new(),
                        title: "Optional screening".into(),
                        description: String::new(),
                        rules: FilterGroup {
                            conjunction: Conjunction::And,
                            conditions: vec![],
                        },
                        message: String::new(),
                    },
                ],
            },
        );
    }
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring read")
    };
    let result = workflow
        .set_form_access(
            viewer(OWNER),
            SetAccess {
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
        .await
        .expect("sharing authors no new placements");
    assert_eq!(
        result.state,
        MutationState::Completed,
        "{:?}",
        result.diagnostics
    );
    assert_eq!(result.saved.unwrap().layout, saved.layout);
}

#[tokio::test]
async fn review_regression_equivalent_revision_bytes_remain_projected_and_editable() {
    use crate::domain::authoring::ports::AuthoringCore;
    use crate::domain::collaboration;
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let forms = service(&world);
    let receipt = form_receipt::<EditAccessLevel>(RSVP_FORM, OWNER, AccessLevel::Owner);
    forms.authoring_snapshot(receipt.clone()).await.unwrap();
    let document = loro::LoroDoc::new();
    document
        .import(&world.lock().unwrap().drafts[&RSVP_FORM])
        .unwrap();
    document.set_peer_id(1).unwrap();
    document
        .get_map("review-fixture")
        .insert("first", true)
        .unwrap();
    document.commit();
    document.set_peer_id(2).unwrap();
    document
        .get_map("review-fixture")
        .insert("second", true)
        .unwrap();
    document.commit();
    world.lock().unwrap().drafts.insert(
        RSVP_FORM,
        document.export(loro::ExportMode::Snapshot).unwrap(),
    );
    let initial = forms.authoring_snapshot(receipt.clone()).await.unwrap();
    let reordered = reorder_revision(&initial.revision);
    assert_ne!(initial.revision, reordered);
    assert!(collaboration::revision_matches(&initial.revision, &reordered).unwrap());
    world
        .lock()
        .unwrap()
        .draft_states
        .get_mut(&RSVP_FORM)
        .unwrap()
        .revision = Some(reordered.clone());
    let snapshot = forms.authoring_snapshot(receipt.clone()).await.unwrap();
    assert!(
        snapshot.projected,
        "map byte order must not make a valid projection appear stale"
    );
    assert_eq!(
        snapshot.revision, reordered,
        "settings CAS needs the persisted representation"
    );
    let mut edited = snapshot.layout;
    let FormSection::Questions { title, .. } = &mut edited.sections[0] else {
        panic!("questions")
    };
    *title = "Updated contact details".into();
    let saved = forms
        .save_authoring_layout(receipt, reordered, edited.clone())
        .await
        .unwrap();
    assert!(saved.projected);
    assert_eq!(saved.layout, edited);

    // Invalid drafts must also remain closable across equivalent byte encodings.
    use crate::domain::drafts::FormDraftStore;
    let mut invalid = saved.layout;
    let FormSection::Questions { questions, .. } = &mut invalid.sections[0] else {
        panic!("questions")
    };
    questions[0].column = ColumnId::new();
    let change =
        collaboration::replace_layout(&world.lock().unwrap().drafts[&RSVP_FORM], &invalid).unwrap();
    FakeDrafts(world.clone())
        .update(RSVP_FORM, change.expected_revision, change.update)
        .await
        .unwrap();
    let workflow = AuthoringWorkflow {
        core: Arc::new(forms),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: RSVP_FORM,
                view: ReadView::Authoring,
                include_summary: false,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring read")
    };
    assert!(!saved.projected);
    let closed = workflow
        .set_form_access(
            viewer(OWNER),
            SetAccess {
                form_id: RSVP_FORM,
                base_revision: saved.revision,
                draft: AccessDraft {
                    audience: Audience::Members,
                    status: FormStatus::Closed,
                    closes_at: None,
                    tally_visible: false,
                    channel_grants: vec![],
                },
            },
        )
        .await
        .expect("equivalent revisions cannot prevent closing an invalid draft");
    assert_eq!(closed.saved.unwrap().form.status, FormStatus::Closed);
}

fn reorder_revision(revision: &[u8]) -> Vec<u8> {
    // Preserve the encoded map entries exactly, but reverse their order.
    let mut cursor = 1;
    let mut entries = vec![];
    for _ in 0..revision[0] {
        let start = cursor;
        for _ in 0..2 {
            while revision[cursor] & 128 != 0 {
                cursor += 1;
            }
            cursor += 1;
        }
        entries.push(revision[start..cursor].to_vec());
    }
    assert_eq!(cursor, revision.len());
    let mut reordered = vec![revision[0]];
    for entry in entries.into_iter().rev() {
        reordered.extend(entry);
    }
    reordered
}

#[tokio::test]
async fn crdt_review_revision_is_stable_across_reads_without_retained_snapshots() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name":"Live editing", "source":{"kind":"new"},
        "draft":{"sections":[{"kind":"questions","key":"intro","questions":[{"key":"name","column":{"kind":"new","name":"Name","type":{"type":"text"}},"helpText":"Original"}]}]}
    })).unwrap();
    let created = workflow.create_form(viewer(OWNER), intent).await.unwrap();
    let saved = created.saved.unwrap();
    let ReadResult::Authoring { saved: again, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id: saved.form.id,
                view: ReadView::Authoring,
                include_summary: false,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring")
    };
    assert_eq!(
        saved.revision, again.revision,
        "review identity comes from current content, not a retained snapshot row"
    );
}

#[tokio::test]
async fn crdt_edit_uses_the_current_document_instead_of_a_read_time_baseline() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name":"Live editing", "source":{"kind":"new"},
        "draft":{"sections":[{"kind":"questions","key":"intro","questions":[{"key":"name","column":{"kind":"new","name":"Name","type":{"type":"text"}},"helpText":"Original"}]}]}
    })).unwrap();
    let created = workflow.create_form(viewer(OWNER), intent).await.unwrap();
    let saved = created.saved.unwrap();
    let mut human = saved.layout.clone();
    let FormSection::Questions { questions, .. } = &mut human.sections[0] else {
        panic!("questions")
    };
    questions[0].help_text = "Human revision".into();
    questions[0].required = true;
    workflow
        .core
        .put_layout(
            form_receipt(saved.form.id, OWNER, AccessLevel::Owner),
            human,
        )
        .await
        .unwrap();
    let result = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                form_id: saved.form.id,
                changes: vec![Change::SetQuestion {
                    question_id: created.keys.questions["name"],
                    help_text: Some("Updated help".into()),
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
    assert_eq!(result.state, MutationState::Completed);
    let FormSection::Questions { questions, .. } = &result.saved.unwrap().layout.sections[0] else {
        panic!("questions")
    };
    assert_eq!(questions[0].help_text, "Updated help");
    assert!(questions[0].required);
}

#[tokio::test]
async fn crdt_edit_merges_concurrent_characters_and_later_calls_use_current_state() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name":"Live editing", "source":{"kind":"new"},
        "draft":{"sections":[{"kind":"questions","key":"intro","questions":[{"key":"name","column":{"kind":"new","name":"Name","type":{"type":"text"}},"helpText":"Original"}]}]}
    })).unwrap();
    let created = workflow.create_form(viewer(OWNER), intent).await.unwrap();
    let saved = created.saved.unwrap();
    let snapshot = workflow
        .core
        .authoring_snapshot(form_receipt(saved.form.id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let mut human = saved.layout.clone();
    let FormSection::Questions { questions, .. } = &mut human.sections[0] else {
        panic!("questions")
    };
    questions[0].help_text = "Human Original".into();
    questions[0].required = true;
    let change = collaboration::replace_layout(&snapshot.document, &human).unwrap();
    world.lock().unwrap().draft_update_before_next_write = Some(change.update);
    let intent = Edit {
        form_id: saved.form.id,
        changes: vec![Change::SetQuestion {
            question_id: created.keys.questions["name"],
            help_text: Some("Original AI".into()),
            required: None,
            widget: None,
        }],
        new_columns: vec![],
        description: None,
        confirmation_message: None,
    };
    let result = workflow
        .edit_form(viewer(OWNER), intent.clone())
        .await
        .unwrap();
    assert_eq!(
        result.state,
        MutationState::Completed,
        "{:?}",
        result.diagnostics
    );
    let FormSection::Questions { questions, .. } = &result.saved.unwrap().layout.sections[0] else {
        panic!("questions")
    };
    assert_eq!(questions[0].help_text, "Human Original AI");
    assert!(questions[0].required);
    let repeated = workflow.edit_form(viewer(OWNER), intent).await.unwrap();
    let FormSection::Questions { questions, .. } = &repeated.saved.unwrap().layout.sections[0]
    else {
        panic!("questions")
    };
    assert_eq!(
        questions[0].help_text, "Original AI",
        "a later tool invocation is a new edit against current content"
    );
}

#[tokio::test]
async fn crdt_merge_refuses_to_strand_a_concurrently_added_screening_rule() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name":"Live editing", "source":{"kind":"new"},
        "draft":{"sections":[{"kind":"questions","key":"intro","questions":[{"key":"name","column":{"kind":"new","name":"Name","type":{"type":"text"}},"helpText":"Original"}]}]}
    })).unwrap();
    let created = workflow.create_form(viewer(OWNER), intent).await.unwrap();
    let saved = created.saved.unwrap();
    let snapshot = workflow
        .core
        .authoring_snapshot(form_receipt(saved.form.id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    let FormSection::Questions { questions, .. } = &saved.layout.sections[0] else {
        panic!("questions")
    };
    let column = questions[0].column;
    let mut human = saved.layout.clone();
    human.sections.push(FormSection::Gate {
        id: models_forms::FormSectionId::new(),
        title: "Screening".into(),
        description: String::new(),
        message: "Name required".into(),
        rules: models_databases::views::FilterGroup {
            conjunction: models_databases::views::Conjunction::And,
            conditions: vec![models_databases::views::FilterNode::Condition(
                models_databases::views::FilterCondition {
                    column,
                    test: models_databases::views::FilterTest::Presence {
                        operator: models_databases::views::PresenceOperator::IsNotEmpty,
                    },
                },
            )],
        },
    });
    world.lock().unwrap().draft_update_before_next_write = Some(
        collaboration::replace_layout(&snapshot.document, &human)
            .unwrap()
            .update,
    );
    let result = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                form_id: saved.form.id,
                changes: vec![Change::RemoveQuestion {
                    question_id: created.keys.questions["name"],
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await
        .unwrap();
    assert_ne!(result.state, MutationState::Completed);
    assert!(!result.diagnostics.is_empty());
    let actual = workflow
        .core
        .authoring_snapshot(form_receipt(saved.form.id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        actual.layout, human,
        "the human's valid layout remains intact when merging would strand its gate"
    );
}

/// Test codec; production uses the Cloudflare worker through the same port.
struct Editor;
impl crate::domain::authoring::ports::AuthoringEditor for Editor {
    async fn prepare_edit(
        &self,
        snapshot: &[u8],
        layout: &FormLayout,
    ) -> Result<Vec<u8>, AuthoringError> {
        Ok(collaboration::replace_layout(snapshot, layout)
            .unwrap()
            .update)
    }
}

#[tokio::test]
async fn crdt_merge_revalidates_authoring_limits_after_a_concurrent_addition() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        settings: Settings {
            world: world.clone(),
        },
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let sections: Vec<_> = (0..99)
        .map(|n| json!({"kind":"questions", "key": format!("section{n}"), "questions":[]}))
        .collect();
    let intent: Create = serde_json::from_value(json!({
        "name":"Concurrent limits", "source":{"kind":"new"}, "draft":{"sections":sections}
    }))
    .unwrap();
    let result = workflow.create_form(viewer(OWNER), intent).await.unwrap();
    let saved = result.saved.unwrap();
    let receipt = form_receipt(saved.form.id, OWNER, AccessLevel::Owner);
    let snapshot = workflow
        .core
        .authoring_snapshot(receipt.clone())
        .await
        .unwrap();
    let section = || FormSection::Questions {
        id: FormSectionId::new(),
        title: String::new(),
        description: String::new(),
        questions: vec![],
    };
    let mut human = saved.layout.clone();
    human.sections.push(section());
    world.lock().unwrap().draft_update_before_next_write = Some(
        collaboration::replace_layout(&snapshot.document, &human)
            .unwrap()
            .update,
    );
    let mut ai = saved.layout;
    ai.sections.push(section());
    let update = collaboration::replace_layout(&snapshot.document, &ai)
        .unwrap()
        .update;
    let error = workflow
        .core
        .apply_authoring_update(receipt.clone(), update)
        .await
        .unwrap_err();
    assert_eq!(error.code, Code::TooManySections);
    assert_eq!(
        workflow
            .core
            .authoring_snapshot(receipt)
            .await
            .unwrap()
            .layout,
        human
    );
}

struct InvalidEditor(Vec<u8>);
impl crate::domain::authoring::ports::AuthoringEditor for InvalidEditor {
    async fn prepare_edit(&self, _: &[u8], _: &FormLayout) -> Result<Vec<u8>, AuthoringError> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn malformed_worker_updates_are_rejected_before_schema_mutations() {
    for incomplete in [false, true] {
        let world = world();
        let workflow = AuthoringWorkflow {
            core: Arc::new(service(&world)),
            databases: Arc::new(FakeDatabases(world.clone())),
            settings: Settings {
                world: world.clone(),
            },
            booking: (),
            access: Access(world.clone()),
            editor: Editor,
            app_origin: "https://macro.test".into(),
        };
        let intent: Create = serde_json::from_value(json!({
            "name":"Worker validation", "source":{"kind":"new"}, "draft":{"sections":[]}
        }))
        .unwrap();
        let saved = workflow
            .create_form(viewer(OWNER), intent)
            .await
            .unwrap()
            .saved
            .unwrap();
        let receipt = form_receipt(saved.form.id, OWNER, AccessLevel::Owner);
        let snapshot = workflow
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .unwrap();
        let response = if incomplete {
            let doc = loro::LoroDoc::new();
            doc.import(&snapshot.document).unwrap();
            doc.get_map("extra").insert("first", true).unwrap();
            doc.commit();
            let version = doc.oplog_vv();
            doc.get_map("extra").insert("second", true).unwrap();
            doc.commit();
            doc.export(loro::ExportMode::updates(&version)).unwrap()
        } else {
            snapshot.document.clone()
        };
        let workflow = AuthoringWorkflow {
            editor: InvalidEditor(response),
            core: workflow.core,
            databases: workflow.databases,
            settings: workflow.settings,
            booking: workflow.booking,
            access: workflow.access,
            app_origin: workflow.app_origin,
        };

        let result = workflow
            .edit_form(
                viewer(OWNER),
                Edit {
                    form_id: saved.form.id,
                    changes: vec![],
                    new_columns: vec![NewColumnDraft {
                        id: ColumnId::new(),
                        name: "Must not exist".into(),
                        kind: ColumnKind::Text,
                        options: vec![],
                    }],
                    description: None,
                    confirmation_message: None,
                },
            )
            .await;
        assert!(result.is_err(), "malformed update must fail preflight");
        assert_eq!(
            workflow
                .core
                .authoring_snapshot(receipt)
                .await
                .unwrap()
                .columns,
            snapshot.columns
        );
    }
}
