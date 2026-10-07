//! A form that created its own database goes by that database's name:
//! renaming either renames both, and every read names the form as the
//! database is named now. A form over an existing table keeps a name of its
//! own.

use ::databases::domain::models::DatabaseError;
use bot_id::BotId;
use entity_access::domain::models::{
    BotReceiptScope, EditAccessLevel, OwnerAccessLevel, ViewAccessLevel,
};

use super::*;
use crate::domain::models::{FormAccess, FormError, ListedForm, UpdateForm};
use crate::domain::ports::{CreateFormCommand, CreateSource, FormsService};

const PARTY_DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xd9));
const PARTY_TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7c));

/// A form over a new database of its own, named "Offsite RSVP", owned by
/// [`OWNER`] and edited by [`EDITOR`]: its id and its database's.
async fn create_standalone(world: &Shared) -> (FormId, DatabaseId) {
    let detail = service(world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Offsite RSVP".into(),
                source: CreateSource::NewDatabase,
            },
        )
        .await
        .unwrap();
    (detail.form.id, detail.form.database_id)
}

/// A database "Party" with one table, owned by [`OWNER`].
fn seed_party(world: &Shared) {
    world.lock().unwrap().databases.push(FakeDatabase {
        id: PARTY_DATABASE,
        name: "Party".into(),
        owner: OWNER.into(),
        trashed: false,
        tables: vec![FakeTable {
            id: PARTY_TABLE,
            name: "Guests".into(),
            version: 1,
            columns: vec![FakeColumn {
                id: ColumnId::from_uuid(Uuid::from_u128(0xa1)),
                name: "Name".into(),
                kind: ColumnKind::Text,
                options: vec![],
            }],
            rows: vec![],
        }],
    });
}

/// A form named "Party RSVP" over the table of `database`.
async fn create_attached(world: &Shared, database: DatabaseId, table: TableId) -> FormId {
    service(world)
        .create_form(
            viewer(OWNER),
            CreateFormCommand {
                name: "Party RSVP".into(),
                source: CreateSource::Table {
                    receipt: database_receipt::<OwnerAccessLevel>(
                        database,
                        OWNER,
                        AccessLevel::Owner,
                    ),
                    table_id: table,
                },
            },
        )
        .await
        .unwrap()
        .form
        .id
}

fn stored(world: &Shared, id: FormId) -> StoredForm {
    world
        .lock()
        .unwrap()
        .forms
        .iter()
        .find(|stored| stored.form.id == id)
        .cloned()
        .expect("the form exists")
}

fn edit(form: FormId) -> EntityAccessReceipt<EditAccessLevel> {
    form_receipt::<EditAccessLevel>(form, EDITOR, AccessLevel::Edit)
}

fn view(form: FormId) -> EntityAccessReceipt<ViewAccessLevel> {
    form_receipt::<ViewAccessLevel>(form, VIEWER, AccessLevel::View)
}

#[tokio::test]
async fn which_name_a_new_form_goes_by_is_recorded_from_where_it_was_created() {
    let world = world();
    seed_party(&world);
    let (standalone, database) = create_standalone(&world).await;
    let attached = create_attached(&world, PARTY_DATABASE, PARTY_TABLE).await;

    assert_eq!(
        world.lock().unwrap().database(database).name,
        "Offsite RSVP"
    );
    let table = world.lock().unwrap().database(database).tables[0].id;
    let managed = stored(&world, standalone).form;
    assert_eq!(
        stored(&world, standalone),
        StoredForm {
            form: Form {
                id: standalone,
                name: "Offsite RSVP".into(),
                description: "".into(),
                owner_id: OWNER.into(),
                database_id: database,
                table_id: table,
                submitted_column_id: managed.submitted_column_id,
                respondent_column_id: managed.respondent_column_id,
                audience: Audience::Members,
                tally_visible: false,
                status: FormStatus::Open,
                closes_at: None,
                confirmation_message: "".into(),
                created_at: start_of_tests(),
                updated_at: start_of_tests(),
            },
            trashed_at: None,
            name_follows_database: true,
        }
    );
    assert!(!stored(&world, attached).name_follows_database);
}

#[tokio::test]
async fn renaming_a_form_that_created_its_database_renames_the_database() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    let renamed_at = Utc.with_ymd_and_hms(2026, 9, 2, 9, 0, 0).unwrap();
    world.lock().unwrap().now = renamed_at;
    let forms = service(&world);

    let renamed = forms
        .rename_form(edit(form), " Q4 offsite ".into())
        .await
        .unwrap();

    assert_eq!(renamed.name, "Q4 offsite");
    assert_eq!(renamed.updated_at, renamed_at);
    {
        let world_now = world.lock().unwrap();
        assert_eq!(world_now.database(database).name, "Q4 offsite");
        // The database's name is the form's: nothing writes a second copy.
        let shadow = world_now
            .forms
            .iter()
            .find(|stored| stored.form.id == form)
            .unwrap();
        assert_eq!(shadow.form.name, "Offsite RSVP");
        assert_eq!(shadow.form.updated_at, renamed_at);
        // The databases domain renamed it under the editor's own auth, at the
        // Edit a form's editors hold on its database.
        let [rename] = world_now.database_renames.as_slice() else {
            panic!("one database rename: {:?}", world_now.database_renames);
        };
        assert_eq!(rename.database, database);
        assert_eq!(rename.name, "Q4 offsite");
        assert_eq!(rename.level, Some(AccessLevel::Edit));
        assert!(
            matches!(&rename.auth, EntityAccessAuth::Authenticated(user) if user.as_ref() == EDITOR),
            "{:?}",
            rename.auth
        );
        assert_eq!(world_now.form_pings, vec![form]);
        assert!(
            world_now
                .event_types()
                .contains(&"form.renamed".to_string()),
            "{:?}",
            world_now.event_types()
        );
    }

    assert_eq!(
        forms.get_form(view(form)).await.unwrap().form.name,
        "Q4 offsite"
    );
}

#[tokio::test]
async fn a_bot_renaming_a_standalone_form_renames_its_database_as_itself() {
    let world = world();
    let (form, _) = create_standalone(&world).await;
    let bot = BotId::new_from_uuid(Uuid::from_u128(0xb07));
    let receipt = EntityAccessReceipt::<EditAccessLevel>::try_new_bot(
        bot.into_storage_id(),
        BotReceiptScope::User {
            acting_user: user(EDITOR),
        },
        Entity {
            entity_id: form.to_string(),
            entity_type: EntityType::Form,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap();

    service(&world)
        .rename_form(receipt, "Bot named".into())
        .await
        .unwrap();

    let world = world.lock().unwrap();
    let [rename] = world.database_renames.as_slice() else {
        panic!("one database rename");
    };
    assert!(
        matches!(
            &rename.auth,
            EntityAccessAuth::Bot(auth)
                if auth.bot_id() == bot
                    && auth.scope().acting_user_id().map(|user| user.as_ref()) == Some(EDITOR)
        ),
        "{:?}",
        rename.auth
    );
}

#[tokio::test]
async fn renaming_takes_a_receipt_for_the_form_itself() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    let refused = service(&world)
        .rename_form(
            database_receipt::<EditAccessLevel>(database, OWNER, AccessLevel::Owner),
            "Through the database".into(),
        )
        .await;
    assert!(matches!(refused, Err(FormError::NotFound)), "{refused:?}");
    let world = world.lock().unwrap();
    assert!(world.database_renames.is_empty());
    assert_eq!(world.database(database).name, "Offsite RSVP");
    assert_eq!(
        world
            .forms
            .iter()
            .find(|stored| stored.form.id == form)
            .unwrap()
            .form
            .name,
        "Offsite RSVP"
    );
}

#[tokio::test]
async fn renaming_the_database_renames_its_form_wherever_the_form_is_read() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    let table = TableId::new();
    world
        .lock()
        .unwrap()
        .database_mut(database)
        .tables
        .push(FakeTable {
            id: table,
            name: "Guests".into(),
            version: 1,
            columns: vec![FakeColumn {
                id: ColumnId::new(),
                name: "Name".into(),
                kind: ColumnKind::Text,
                options: vec![],
            }],
            rows: vec![],
        });
    let attached = create_attached(&world, database, table).await;
    {
        let mut world = world.lock().unwrap();
        world.database_mut(database).name = "Renamed in the grid".into();
        world.form_grants.insert(
            OWNER.into(),
            vec![(form, AccessLevel::Owner), (attached, AccessLevel::Owner)],
        );
    }
    let forms = service(&world);

    assert_eq!(
        forms.get_form(view(form)).await.unwrap().form.name,
        "Renamed in the grid"
    );
    let reads_before_listing = world.lock().unwrap().database_metadata_reads;
    let listed = forms.accessible_forms(viewer(OWNER)).await.unwrap();
    let names: Vec<(FormId, String, FormAccess)> = listed
        .into_iter()
        .map(|ListedForm { form, access }| (form.id, form.name, access))
        .collect();
    assert_eq!(names.len(), 2);
    assert!(names.contains(&(form, "Renamed in the grid".into(), FormAccess::Owner)));
    assert!(names.contains(&(attached, "Party RSVP".into(), FormAccess::Owner)));
    // One read of the database names every form that follows it.
    assert_eq!(
        world.lock().unwrap().database_metadata_reads,
        reads_before_listing + 1
    );

    let over_database = forms
        .forms_for_database(database_receipt::<ViewAccessLevel>(
            database,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert_eq!(
        over_database
            .iter()
            .map(|form| (form.id, form.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(form, "Renamed in the grid"), (attached, "Party RSVP")]
    );

    let updated = forms
        .update_form(
            edit(form),
            UpdateForm {
                description: Some("Tell us by Friday.".into()),
                ..UpdateForm::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.name, "Renamed in the grid");
    let layout = forms.get_form(view(form)).await.unwrap();
    let put = forms
        .put_layout(
            edit(form),
            FormLayout {
                sections: vec![FormSection::Questions {
                    id: match &layout.sections[0] {
                        crate::domain::models::FormSectionDetail::Questions { id, .. } => *id,
                        _ => panic!("one section of questions"),
                    },
                    title: "".into(),
                    description: "".into(),
                    questions: vec![],
                }],
            },
        )
        .await
        .unwrap();
    assert_eq!(put.detail.form.name, "Renamed in the grid");
}

#[tokio::test]
async fn a_form_over_an_existing_table_keeps_a_name_of_its_own() {
    let world = world();
    seed_party(&world);
    let form = create_attached(&world, PARTY_DATABASE, PARTY_TABLE).await;
    let forms = service(&world);

    let renamed = forms
        .rename_form(edit(form), "Guest list".into())
        .await
        .unwrap();
    assert_eq!(renamed.name, "Guest list");
    {
        let world = world.lock().unwrap();
        assert_eq!(world.database(PARTY_DATABASE).name, "Party");
        assert!(world.database_renames.is_empty());
    }

    world.lock().unwrap().database_mut(PARTY_DATABASE).name = "Celebration".into();
    assert_eq!(
        forms.get_form(view(form)).await.unwrap().form.name,
        "Guest list"
    );
}

#[tokio::test]
async fn a_refused_database_rename_leaves_the_form_as_it_was() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    let before = stored(&world, form);
    {
        let mut world = world.lock().unwrap();
        world.now = Utc.with_ymd_and_hms(2026, 9, 2, 9, 0, 0).unwrap();
        world.refuse_next_database_rename = Some(DatabaseError::Unauthorized);
        world.events.clear();
    }
    let forms = service(&world);

    let refused = forms.rename_form(edit(form), "Q4 offsite".into()).await;

    assert!(
        matches!(
            refused,
            Err(FormError::Database(DatabaseError::Unauthorized))
        ),
        "{refused:?}"
    );
    assert_eq!(stored(&world, form), before);
    {
        let world = world.lock().unwrap();
        assert_eq!(world.database(database).name, "Offsite RSVP");
        assert!(world.form_pings.is_empty());
        assert!(world.events.is_empty());
    }
    assert_eq!(
        forms.get_form(view(form)).await.unwrap().form.name,
        "Offsite RSVP"
    );
}

#[tokio::test]
async fn a_form_whose_database_is_in_the_trash_cannot_be_renamed() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    let before = stored(&world, form);
    world.lock().unwrap().database_mut(database).trashed = true;

    let refused = service(&world)
        .rename_form(edit(form), "Q4 offsite".into())
        .await;

    assert!(matches!(refused, Err(FormError::TableGone)), "{refused:?}");
    assert_eq!(stored(&world, form), before);
    assert_eq!(
        world.lock().unwrap().database(database).name,
        "Offsite RSVP"
    );
}

#[tokio::test]
async fn a_form_named_by_a_trashed_database_still_reads_its_name() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    {
        let mut world = world.lock().unwrap();
        let trashed = world.database_mut(database);
        trashed.name = "Archived offsite".into();
        trashed.trashed = true;
        world
            .form_grants
            .insert(OWNER.into(), vec![(form, AccessLevel::Owner)]);
    }
    let forms = service(&world);

    let detail = forms.get_form(view(form)).await.unwrap();
    assert_eq!(detail.form.name, "Archived offsite");
    assert!(detail.table_gone);
    assert_eq!(
        forms.accessible_forms(viewer(OWNER)).await.unwrap()[0]
            .form
            .name,
        "Archived offsite"
    );
}

#[tokio::test]
async fn a_failed_read_of_the_databases_name_fails_the_read_instead_of_falling_back() {
    let world = world();
    seed_party(&world);
    let (form, database) = create_standalone(&world).await;
    let attached = create_attached(&world, PARTY_DATABASE, PARTY_TABLE).await;
    {
        let mut world = world.lock().unwrap();
        world.fail_database_metadata_reads = true;
        world
            .form_grants
            .insert(OWNER.into(), vec![(form, AccessLevel::Owner)]);
    }
    let forms = service(&world);

    let read = forms.get_form(view(form)).await;
    assert!(matches!(read, Err(FormError::Database(_))), "{read:?}");
    let listed = forms.accessible_forms(viewer(OWNER)).await;
    assert!(matches!(listed, Err(FormError::Database(_))), "{listed:?}");
    let over_database = forms
        .forms_for_database(database_receipt::<ViewAccessLevel>(
            database,
            OWNER,
            AccessLevel::Owner,
        ))
        .await;
    assert!(
        matches!(over_database, Err(FormError::Database(_))),
        "{over_database:?}"
    );
    let updated = forms
        .update_form(
            edit(form),
            UpdateForm {
                description: Some("Tell us by Friday.".into()),
                ..UpdateForm::default()
            },
        )
        .await;
    assert!(
        matches!(updated, Err(FormError::Database(_))),
        "{updated:?}"
    );

    // A form with a name of its own reads no database name.
    assert_eq!(
        forms.get_form(view(attached)).await.unwrap().form.name,
        "Party RSVP"
    );
}

#[tokio::test]
async fn a_form_outliving_its_database_fails_loudly() {
    let world = world();
    let (form, database) = create_standalone(&world).await;
    world
        .lock()
        .unwrap()
        .databases
        .retain(|stored| stored.id != database);

    let read = service(&world).get_form(view(form)).await;

    assert!(
        matches!(read, Err(FormError::DatabaseContract(_))),
        "{read:?}"
    );
}
