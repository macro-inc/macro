use super::*;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
struct FakeRepository(Arc<Mutex<HashMap<Uuid, TaskTemplate>>>);

impl Repository for FakeRepository {
    type Err = std::io::Error;

    async fn list(&self, user: &str, team: Option<Uuid>) -> Result<Vec<TaskTemplate>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .values()
            .filter(|row| {
                row.user_id.as_deref() == Some(user) || (team.is_some() && row.team_id == team)
            })
            .cloned()
            .collect())
    }

    async fn get(&self, id: Uuid) -> Result<Option<TaskTemplate>, Self::Err> {
        Ok(self.0.lock().unwrap().get(&id).cloned())
    }

    async fn create(&self, template: &TaskTemplate) -> Result<bool, Self::Err> {
        let mut rows = self.0.lock().unwrap();
        if rows.contains_key(&template.id) {
            return Ok(false);
        }
        let mut row = template.clone();
        row.can_manage = false;
        rows.insert(row.id, row);
        Ok(true)
    }

    async fn update(&self, template: &TaskTemplate, expected: i64) -> Result<bool, Self::Err> {
        let mut rows = self.0.lock().unwrap();
        let Some(row) = rows.get_mut(&template.id) else {
            return Ok(false);
        };
        if row.revision != expected {
            return Ok(false);
        }
        row.name = template.name.clone();
        row.configuration = template.configuration.clone();
        row.revision += 1;
        row.updated_at = Utc::now();
        Ok(true)
    }

    async fn delete(&self, template: &TaskTemplate, expected: i64) -> Result<bool, Self::Err> {
        let mut rows = self.0.lock().unwrap();
        if rows
            .get(&template.id)
            .is_some_and(|row| row.revision == expected)
        {
            rows.remove(&template.id);
            return Ok(true);
        }
        Ok(false)
    }
}

#[derive(Clone, Default)]
struct FakeMembership(Arc<Mutex<HashMap<(String, Uuid), TeamAccess>>>);

impl Membership for FakeMembership {
    type Err = std::io::Error;

    async fn access(&self, user: &str, team: Uuid) -> Result<Option<TeamAccess>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(&(user.to_owned(), team))
            .copied())
    }
}

#[test]
fn accepts_only_defaults_for_listed_properties_and_deduplicates_ids() {
    let id = Uuid::now_v7();
    let outside = Uuid::now_v7();
    let mut configuration = TaskTemplateConfiguration {
        property_ids: vec![id, id],
        defaults: vec![PropertyDefault {
            property_id: outside,
            value: SetPropertyValue::Boolean { value: true },
        }],
        description_markdown: String::new(),
    };
    assert!(matches!(configuration.validate(), Err(Error::Invalid)));
    configuration.defaults[0].property_id = id;
    assert!(configuration.validate().is_ok());
    assert_eq!(configuration.property_ids, vec![id]);
    configuration.defaults.push(PropertyDefault {
        property_id: id,
        value: SetPropertyValue::Boolean { value: false },
    });
    assert!(matches!(configuration.validate(), Err(Error::Invalid)));
}

#[tokio::test]
async fn personal_templates_remain_private_and_owner_managed() {
    let service = Service::new(FakeRepository::default(), FakeMembership::default());
    let created = service
        .create(
            "creator",
            CreateTaskTemplateRequest {
                id: None,
                team_id: None,
                name: "  Personal template  ".into(),
                configuration: TaskTemplateConfiguration {
                    property_ids: vec![],
                    defaults: vec![],
                    description_markdown: "Description".into(),
                },
            },
        )
        .await
        .unwrap();
    assert!(created.can_manage);
    assert_eq!(created.name, "Personal template");
    assert_eq!(created.user_id.as_deref(), Some("creator"));
    assert!(service.list("other", None).await.unwrap().is_empty());
    assert!(service.get("creator", created.id).await.unwrap().can_manage);
    assert!(matches!(
        service.get("other", created.id).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service
            .update(
                "other",
                created.id,
                UpdateTaskTemplateRequest {
                    revision: 1,
                    name: "Other".into(),
                    configuration: created.configuration.clone(),
                }
            )
            .await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service.delete("other", created.id, 1).await,
        Err(Error::NotFound)
    ));
    let updated = service
        .update(
            "creator",
            created.id,
            UpdateTaskTemplateRequest {
                revision: 1,
                name: "Updated".into(),
                configuration: created.configuration.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.revision, 2);
    assert!(updated.can_manage);
    assert!(matches!(
        service.delete("creator", created.id, 1).await,
        Err(Error::Conflict)
    ));
    service.delete("creator", created.id, 2).await.unwrap();
    assert!(service.list("creator", None).await.unwrap().is_empty());
}

#[tokio::test]
async fn team_templates_require_current_membership_and_creator_or_admin_management() {
    let team = Uuid::now_v7();
    let membership = FakeMembership::default();
    membership.0.lock().unwrap().extend([
        (("creator".into(), team), TeamAccess::Member),
        (("member".into(), team), TeamAccess::Member),
        (("admin".into(), team), TeamAccess::Admin),
    ]);
    let service = Service::new(FakeRepository::default(), membership.clone());
    let input = CreateTaskTemplateRequest {
        id: None,
        team_id: Some(team),
        name: "Team template".into(),
        configuration: TaskTemplateConfiguration {
            property_ids: vec![],
            defaults: vec![],
            description_markdown: "Team description".into(),
        },
    };
    assert!(matches!(
        service.create("outsider", input.clone()).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.list("outsider", Some(team)).await,
        Err(Error::Forbidden)
    ));
    let created = service.create("creator", input).await.unwrap();
    assert!(created.can_manage);
    assert_eq!(created.team_id, Some(team));
    assert!(created.user_id.is_none());
    assert!(!service.list("member", Some(team)).await.unwrap()[0].can_manage);
    assert!(service.list("admin", Some(team)).await.unwrap()[0].can_manage);
    assert!(!service.get("member", created.id).await.unwrap().can_manage);
    assert!(matches!(
        service.get("outsider", created.id).await,
        Err(Error::NotFound)
    ));
    let update = UpdateTaskTemplateRequest {
        revision: 1,
        name: "Updated template".into(),
        configuration: created.configuration.clone(),
    };
    assert!(matches!(
        service.update("member", created.id, update.clone()).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service.delete("member", created.id, 1).await,
        Err(Error::NotFound)
    ));
    let updated = service
        .update("creator", created.id, update.clone())
        .await
        .unwrap();
    assert_eq!(updated.revision, 2);
    membership
        .0
        .lock()
        .unwrap()
        .remove(&("creator".into(), team));
    assert!(matches!(
        service.list("creator", Some(team)).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.get("creator", created.id).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service.update("creator", created.id, update.clone()).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service.delete("creator", created.id, 2).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service.update("admin", created.id, update).await,
        Err(Error::Conflict)
    ));
    let updated = service
        .update(
            "admin",
            created.id,
            UpdateTaskTemplateRequest {
                revision: 2,
                name: "Admin update".into(),
                configuration: created.configuration,
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.revision, 3);
    assert!(updated.can_manage);
    service.delete("admin", created.id, 3).await.unwrap();
    assert!(service.list("member", Some(team)).await.unwrap().is_empty());
}

#[test]
fn deleted_creator_attribution_does_not_prevent_admin_management() {
    let template = TaskTemplate {
        id: Uuid::now_v7(),
        user_id: None,
        team_id: Some(Uuid::now_v7()),
        creator_id: None,
        name: "Team".into(),
        configuration: TaskTemplateConfiguration {
            property_ids: vec![],
            defaults: vec![],
            description_markdown: String::new(),
        },
        revision: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        can_manage: false,
    };
    assert!(can_manage(&template, "admin", Some(TeamAccess::Admin)));
    assert!(!can_manage(&template, "member", Some(TeamAccess::Member)));
    assert!(!can_manage(&template, "former-admin", None));
}

#[tokio::test]
async fn creation_replays_keep_one_template_and_reject_changed_input_or_actor() {
    let repository = FakeRepository::default();
    let service = Service::new(repository.clone(), FakeMembership::default());
    let id = Uuid::now_v7();
    let input = CreateTaskTemplateRequest {
        id: Some(id),
        team_id: None,
        name: "Reusable checklist".into(),
        configuration: TaskTemplateConfiguration {
            property_ids: vec![Uuid::now_v7()],
            defaults: vec![],
            description_markdown: "- [ ] Check details".into(),
        },
    };
    let created = service.create("creator", input.clone()).await.unwrap();
    let replayed = service.create("creator", input.clone()).await.unwrap();
    assert_eq!(created.id, id);
    assert_eq!(replayed.id, id);
    assert_eq!(replayed.revision, 1);
    assert_eq!(replayed.created_at, created.created_at);
    assert_eq!(repository.0.lock().unwrap().len(), 1);

    let mut renamed = input.clone();
    renamed.name = "Different checklist".into();
    assert!(matches!(
        service.create("creator", renamed).await,
        Err(Error::Conflict)
    ));
    let mut changed = input.clone();
    changed.configuration.description_markdown = "Different description".into();
    assert!(matches!(
        service.create("creator", changed).await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        service.create("other", input).await,
        Err(Error::Conflict)
    ));
    assert_eq!(repository.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn team_creation_replays_require_original_creator_scope_and_current_membership() {
    let team = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    let membership = FakeMembership::default();
    membership.0.lock().unwrap().extend([
        (("creator".into(), team), TeamAccess::Member),
        (("member".into(), team), TeamAccess::Member),
        (("creator".into(), other_team), TeamAccess::Member),
    ]);
    let service = Service::new(FakeRepository::default(), membership.clone());
    let input = CreateTaskTemplateRequest {
        id: Some(Uuid::now_v7()),
        team_id: Some(team),
        name: "Team checklist".into(),
        configuration: TaskTemplateConfiguration {
            property_ids: vec![],
            defaults: vec![],
            description_markdown: String::new(),
        },
    };
    let created = service.create("creator", input.clone()).await.unwrap();
    assert_eq!(
        service.create("creator", input.clone()).await.unwrap().id,
        created.id
    );
    assert!(matches!(
        service.create("member", input.clone()).await,
        Err(Error::Conflict)
    ));
    let mut different_scope = input.clone();
    different_scope.team_id = Some(other_team);
    assert!(matches!(
        service.create("creator", different_scope).await,
        Err(Error::Conflict)
    ));
    membership
        .0
        .lock()
        .unwrap()
        .remove(&("creator".into(), team));
    assert!(matches!(
        service.create("creator", input).await,
        Err(Error::Forbidden)
    ));
}
