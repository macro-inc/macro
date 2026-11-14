use std::collections::HashMap;

use entity_access::domain::{
    models::{AccessError, EntityAudience},
    ports::EntityAudienceLookup,
};
use projects::domain::events::{ProjectMacroEvent, ProjectPermanentlyDeletedMetadata};

use super::*;
use crate::domain::{models::SoupRealtimeMessage, ports::SoupRealtimePublisher};
use crate::outbound::entity_access::EntityAccessExpander;

/// Resolves audiences the way the entity-access repository does: entities whose
/// users are the same come back as one audience. Counts every lookup.
#[derive(Clone)]
struct GroupingLookup {
    users_by_entity: Arc<HashMap<(EntityType, String), Vec<MacroUserIdStr<'static>>>>,
    lookups: Arc<AtomicUsize>,
}

impl EntityAudienceLookup for GroupingLookup {
    async fn get_entity_audiences(
        &self,
        entity_type: EntityType,
        entity_ids: &[&str],
    ) -> Result<Vec<EntityAudience>, AccessError> {
        self.lookups.fetch_add(1, Ordering::SeqCst);
        let mut audiences: Vec<EntityAudience> = Vec::new();
        for entity_id in entity_ids {
            let Some(users) = self
                .users_by_entity
                .get(&(entity_type, entity_id.to_string()))
            else {
                continue;
            };
            match audiences
                .iter_mut()
                .find(|audience| &audience.users == users)
            {
                Some(audience) => audience.entity_ids.push(entity_id.to_string()),
                None => audiences.push(EntityAudience {
                    entity_ids: vec![entity_id.to_string()],
                    users: users.clone(),
                }),
            }
        }
        Ok(audiences)
    }
}

struct RecordingPublisher(Arc<Mutex<Vec<SoupRealtimeMessage>>>);

impl SoupRealtimePublisher for RecordingPublisher {
    async fn publish(&self, message: SoupRealtimeMessage) -> Result<(), Report> {
        self.0.lock().expect("messages lock").push(message);
        Ok(())
    }
}

fn person(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{name}@example.com")).expect("valid user id")
}

struct Folder {
    root_id: String,
    parent_id: String,
    folder_ids: Vec<String>,
    document_ids: Vec<String>,
}

/// A folder under a parent, with nested folders and documents spread through them.
fn folder(folder_count: usize, document_count: usize) -> Folder {
    let root_id = Uuid::now_v7().to_string();
    let mut folder_ids = vec![root_id.clone()];
    folder_ids.extend((1..folder_count).map(|_| Uuid::now_v7().to_string()));
    Folder {
        root_id,
        parent_id: Uuid::now_v7().to_string(),
        folder_ids,
        document_ids: (0..document_count)
            .map(|_| Uuid::now_v7().to_string())
            .collect(),
    }
}

fn trashed(folder: &Folder) -> DeclaredMacroEvent {
    DeclaredMacroEvent::ProjectMacroEvent(ProjectMacroEvent::deleted(
        folder.root_id.clone(),
        ProjectDeletedMetadata {
            project_id: folder.root_id.clone(),
            owner: Owner::User(user()),
            actor_user_id: None,
            parent_project_id: Some(folder.parent_id.clone()),
            deleted_project_ids: folder.folder_ids.clone(),
            deleted_document_ids: folder.document_ids.clone(),
            deleted_chat_ids: Vec::new(),
        },
    ))
}

/// What one lookup per entity reaches: every current user of each patch's
/// access source, sorted for comparison.
fn per_entity_messages(
    event: &DeclaredMacroEvent,
    users_by_entity: &HashMap<(EntityType, String), Vec<MacroUserIdStr<'static>>>,
) -> Vec<(String, Patch<Entity<'static>>)> {
    let mut messages: Vec<_> = patches_from_event(event)
        .into_iter()
        .flat_map(|patch| {
            let source = (
                patch.access_source.entity_type,
                patch.access_source.entity_id.to_string(),
            );
            users_by_entity
                .get(&source)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(move |user_id| (user_id.to_string(), patch.patch.clone()))
        })
        .collect();
    messages.sort_by_key(|(user_id, patch)| (user_id.clone(), format!("{patch:?}")));
    messages
}

struct Run {
    outcome: EventOutcome,
    lookups: usize,
    messages: Vec<(String, Patch<Entity<'static>>)>,
}

async fn run(
    event: &DeclaredMacroEvent,
    users_by_entity: HashMap<(EntityType, String), Vec<MacroUserIdStr<'static>>>,
) -> Run {
    let lookups = Arc::new(AtomicUsize::new(0));
    let published = Arc::new(Mutex::new(Vec::new()));
    let service = SoupRealtimeServiceImpl::new(
        EntityAccessExpander::new(GroupingLookup {
            users_by_entity: Arc::new(users_by_entity),
            lookups: lookups.clone(),
        }),
        RecordingPublisher(published.clone()),
    );

    let outcome = process_event(&service, &NoPullRequestSessions, event, || {}).await;

    let mut messages: Vec<_> = published
        .lock()
        .expect("messages lock")
        .iter()
        .map(|message| (message.user_id.to_string(), message.patch.clone()))
        .collect();
    messages.sort_by_key(|(user_id, patch)| (user_id.clone(), format!("{patch:?}")));
    Run {
        outcome,
        lookups: lookups.load(Ordering::SeqCst),
        messages,
    }
}

fn folder_access(
    folder: &Folder,
    users: &[MacroUserIdStr<'static>],
) -> HashMap<(EntityType, String), Vec<MacroUserIdStr<'static>>> {
    let mut users_by_entity = HashMap::new();
    for folder_id in folder.folder_ids.iter().chain([&folder.parent_id]) {
        users_by_entity.insert((EntityType::Project, folder_id.clone()), users.to_vec());
    }
    for document_id in &folder.document_ids {
        users_by_entity.insert((EntityType::Document, document_id.clone()), users.to_vec());
    }
    users_by_entity
}

#[tokio::test]
async fn trashing_a_large_folder_makes_a_bounded_number_of_lookups() {
    let folder = folder(40, 2_000);
    let users_by_entity = folder_access(&folder, &[person("owner"), person("member")]);
    let event = trashed(&folder);
    let patch_count = patches_from_event(&event).len();
    let expected = per_entity_messages(&event, &users_by_entity);

    let run = run(&event, users_by_entity).await;

    assert!(matches!(run.outcome, EventOutcome::Notified));
    // One lookup per entity type in each batch, never one per entity.
    let batch_count = patch_count.div_ceil(NOTIFY_BATCH_SIZE);
    assert_eq!(batch_count, 5);
    assert!(
        run.lookups <= 2 * batch_count,
        "{} lookups for {patch_count} entities",
        run.lookups
    );
    assert_eq!(run.messages.len(), 2 * patch_count);
    assert_eq!(run.messages, expected);
}

#[tokio::test]
async fn a_separately_shared_file_reaches_its_own_extra_user_only() {
    let folder = folder(3, 1_200);
    let shared_document = folder.document_ids[700].clone();
    let mut users_by_entity = folder_access(&folder, &[person("owner")]);
    users_by_entity.insert(
        (EntityType::Document, shared_document.clone()),
        vec![person("owner"), person("guest")],
    );
    let event = trashed(&folder);
    let expected = per_entity_messages(&event, &users_by_entity);

    let run = run(&event, users_by_entity).await;

    assert!(matches!(run.outcome, EventOutcome::Notified));
    assert_eq!(run.messages, expected);
    let guest_messages: Vec<_> = run
        .messages
        .iter()
        .filter(|(user_id, _)| user_id == &person("guest").to_string())
        .map(|(_, patch)| patch.clone())
        .collect();
    assert_eq!(
        guest_messages,
        vec![Patch::Deleted(
            EntityType::Document.with_entity_string(shared_document)
        )]
    );
}

#[tokio::test]
async fn purging_a_folder_still_reaches_the_same_users_as_per_entity_lookups() {
    let folder = folder(3, 600);
    let users_by_entity = folder_access(&folder, &[person("owner"), person("member")]);
    let event = DeclaredMacroEvent::ProjectMacroEvent(ProjectMacroEvent::permanently_deleted(
        folder.root_id.clone(),
        ProjectPermanentlyDeletedMetadata {
            project_id: folder.root_id.clone(),
            owner: Owner::User(user()),
            actor_user_id: None,
            parent_project_id: Some(folder.parent_id.clone()),
            purged_project_ids: folder.folder_ids.clone(),
            purged_document_ids: folder.document_ids.clone(),
            purged_chat_ids: Vec::new(),
        },
    ));
    let expected = per_entity_messages(&event, &users_by_entity);

    let run = run(&event, users_by_entity).await;

    // A purge publishes no Soup patches today; batching must not change that.
    assert!(matches!(run.outcome, EventOutcome::Ignored));
    assert_eq!(run.lookups, 0);
    assert_eq!(run.messages, expected);
    assert!(run.messages.is_empty());
}
