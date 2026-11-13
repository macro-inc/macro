use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use serde_json::{Value, json};

use super::*;
use crate::domain::models::{DashboardVersion, DashboardVersionSummary};

const AGENT: &str = "macro|agent@example.com";
const ADMIN: &str = "macro|admin@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";
const STRANGER: &str = "macro|stranger@example.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Dashboards and their versions in memory, saved under the same
/// compare-and-set rule as Postgres.
#[derive(Clone, Default)]
struct FakeRepo {
    dashboards: Arc<Mutex<HashMap<DashboardId, StoredDashboard>>>,
    versions: Arc<Mutex<Vec<(DashboardId, DashboardVersion)>>>,
    homes: Arc<Mutex<HashMap<String, DashboardId>>>,
}

impl FakeRepo {
    fn record(
        &self,
        id: DashboardId,
        version: Version,
        author: &MacroUserIdStr<'static>,
        view: &View,
    ) {
        self.versions.lock().unwrap().push((
            id,
            DashboardVersion {
                version,
                author_id: author.clone(),
                created_at: Utc::now(),
                view: serde_json::to_value(view).unwrap(),
            },
        ));
    }
}

impl DashboardRepo for FakeRepo {
    type Err = Infallible;

    async fn create(&self, new: &NewDashboard) -> Result<StoredDashboard, Infallible> {
        let stored = StoredDashboard {
            id: new.id,
            owner_id: new.owner_id.clone(),
            title: new.view.title.clone(),
            version: Version::FIRST,
            view: new.view.clone(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        self.dashboards
            .lock()
            .unwrap()
            .insert(new.id, stored.clone());
        self.record(new.id, Version::FIRST, &new.owner_id, &new.view);
        Ok(stored)
    }

    async fn get(&self, id: DashboardId) -> Result<Option<StoredDashboard>, Infallible> {
        Ok(self.dashboards.lock().unwrap().get(&id).cloned())
    }

    async fn list_owned(
        &self,
        owner: &MacroUserIdStr<'_>,
        _limit: u32,
    ) -> Result<Vec<DashboardSummary>, Infallible> {
        Ok(self
            .dashboards
            .lock()
            .unwrap()
            .values()
            .filter(|stored| stored.owner_id.as_ref() == owner.as_ref())
            .map(|stored| DashboardSummary {
                id: stored.id,
                owner_id: stored.owner_id.clone(),
                title: stored.title.clone(),
                version: stored.version,
                updated_at: stored.updated_at,
            })
            .collect())
    }

    async fn save_version(&self, new: &NewVersion) -> Result<Option<StoredDashboard>, Infallible> {
        let saved = {
            let mut dashboards = self.dashboards.lock().unwrap();
            let Some(stored) = dashboards.get_mut(&new.id) else {
                return Ok(None);
            };
            if stored.version != new.replaces {
                return Ok(None);
            }
            stored.version = stored.version.next();
            stored.view = new.view.clone();
            stored.title = new.view.title.clone();
            stored.clone()
        };
        self.record(new.id, saved.version, &new.author_id, &new.view);
        Ok(Some(saved))
    }

    async fn versions(
        &self,
        id: DashboardId,
        _limit: u32,
    ) -> Result<Vec<DashboardVersionSummary>, Infallible> {
        let mut versions: Vec<_> = self
            .versions
            .lock()
            .unwrap()
            .iter()
            .filter(|(of, _)| *of == id)
            .map(|(_, version)| DashboardVersionSummary {
                version: version.version,
                author_id: version.author_id.clone(),
                created_at: version.created_at,
            })
            .collect();
        versions.reverse();
        Ok(versions)
    }

    async fn version(
        &self,
        id: DashboardId,
        number: Version,
    ) -> Result<Option<DashboardVersion>, Infallible> {
        Ok(self
            .versions
            .lock()
            .unwrap()
            .iter()
            .find(|(of, version)| *of == id && version.version == number)
            .map(|(_, version)| version.clone()))
    }

    async fn delete(&self, id: DashboardId) -> Result<bool, Infallible> {
        self.homes.lock().unwrap().retain(|_, home| *home != id);
        Ok(self.dashboards.lock().unwrap().remove(&id).is_some())
    }

    async fn set_home(&self, user: &MacroUserIdStr<'_>, id: DashboardId) -> Result<(), Infallible> {
        self.homes
            .lock()
            .unwrap()
            .insert(user.as_ref().to_owned(), id);
        Ok(())
    }

    async fn clear_home(&self, user: &MacroUserIdStr<'_>) -> Result<(), Infallible> {
        self.homes.lock().unwrap().remove(user.as_ref());
        Ok(())
    }

    async fn home(&self, user: &MacroUserIdStr<'_>) -> Result<Option<DashboardId>, Infallible> {
        Ok(self.homes.lock().unwrap().get(user.as_ref()).copied())
    }
}

/// The access rule the Postgres query applies, over fixed facts: the owner,
/// an admin of the owner's team, and explicit grants.
struct FakeAccess {
    repo: FakeRepo,
    grants: HashMap<String, AccessLevel>,
}

impl DashboardAccess for FakeAccess {
    type Err = Infallible;

    async fn access_level(
        &self,
        user: &MacroUserIdStr<'_>,
        id: DashboardId,
    ) -> Result<Option<AccessLevel>, Infallible> {
        let Some(stored) = self.repo.dashboards.lock().unwrap().get(&id).cloned() else {
            return Ok(None);
        };
        if stored.owner_id.as_ref() == user.as_ref() {
            return Ok(Some(AccessLevel::Owner));
        }
        if user.as_ref() == ADMIN {
            return Ok(Some(AccessLevel::Edit));
        }
        Ok(self.grants.get(user.as_ref()).copied())
    }
}

struct FakeGate(Vec<&'static str>);

impl DashboardGate for FakeGate {
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> bool {
        self.0.contains(&user.as_ref())
    }
}

type Service = DashboardServiceImpl<FakeRepo, FakeAccess, FakeGate>;

/// A service where everyone but `off` has the flag; teammates hold the
/// grants given.
fn service(grants: &[(&str, AccessLevel)], off: &[&'static str]) -> Service {
    let repo = FakeRepo::default();
    let access = FakeAccess {
        repo: repo.clone(),
        grants: grants
            .iter()
            .map(|(user, level)| ((*user).to_owned(), *level))
            .collect(),
    };
    let enabled = [AGENT, ADMIN, TEAMMATE, STRANGER]
        .into_iter()
        .filter(|user| !off.contains(user))
        .collect();
    DashboardServiceImpl::new(repo, access, FakeGate(enabled))
}

fn view(markdown: &str) -> Value {
    json!({
        "title": "Ops",
        "widgets": [
            { "type": "md", "id": "intro", "markdown": markdown },
            { "type": "container", "children": [{ "type": "md", "id": "notes", "markdown": "Notes" }] }
        ]
    })
}

fn markdown_of(dashboard: &Dashboard, index: usize) -> String {
    serde_json::to_value(&dashboard.view).unwrap()["widgets"][index]["markdown"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn the_creator_owns_a_new_dashboard_at_version_one() {
    let service = service(&[], &[]);

    let dashboard = service.create(&user(AGENT), view("Hello")).await.unwrap();

    assert_eq!(dashboard.version, Version::FIRST);
    assert_eq!(dashboard.access_level, AccessLevel::Owner);
    assert_eq!(dashboard.owner_id.as_ref(), AGENT);
    assert_eq!(dashboard.title.as_deref(), Some("Ops"));
    let listed = service.list(&user(AGENT)).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert!(service.list(&user(TEAMMATE)).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_view_that_does_not_decode_is_refused_with_its_place() {
    let service = service(&[], &[]);

    let error = service
        .create(&user(AGENT), json!({ "widgets": [{ "type": "markdown" }] }))
        .await
        .unwrap_err();

    let DashboardError::Invalid(problem) = error else {
        panic!("expected an invalid view, got {error:?}");
    };
    assert!(problem.contains("view.widgets[0].type"), "{problem}");
}

#[tokio::test]
async fn a_pane_id_used_twice_is_refused() {
    let service = service(&[], &[]);
    let duplicated = json!({
        "widgets": [
            { "type": "md", "id": "a", "markdown": "One" },
            { "type": "md", "id": "a", "markdown": "Two" }
        ]
    });

    let error = service.create(&user(AGENT), duplicated).await.unwrap_err();

    assert!(matches!(error, DashboardError::Invalid(problem) if problem.contains("\"a\"")));
}

#[tokio::test]
async fn an_oversized_view_is_refused() {
    let service = service(&[], &[]);
    let huge = view(&"x".repeat(MAX_VIEW_BYTES));

    let error = service.create(&user(AGENT), huge).await.unwrap_err();

    assert!(matches!(error, DashboardError::Invalid(problem) if problem.contains("limit")));
}

#[tokio::test]
async fn dashboards_are_not_found_with_the_flag_off() {
    let service = service(&[], &[STRANGER]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    assert!(matches!(
        service.create(&user(STRANGER), view("Hi")).await,
        Err(DashboardError::NotFound)
    ));
    assert!(matches!(
        service.get(&user(STRANGER), dashboard.id).await,
        Err(DashboardError::NotFound)
    ));
    assert!(matches!(
        service.home(&user(STRANGER), &user(AGENT)).await,
        Err(DashboardError::NotFound)
    ));
}

#[tokio::test]
async fn a_caller_without_access_cannot_tell_a_dashboard_exists() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    assert!(matches!(
        service.get(&user(STRANGER), dashboard.id).await,
        Err(DashboardError::NotFound)
    ));
    assert!(matches!(
        service
            .update(&user(STRANGER), dashboard.id, view("Mine"), None)
            .await,
        Err(DashboardError::NotFound)
    ));
}

#[tokio::test]
async fn a_viewer_reads_but_cannot_save() {
    let service = service(&[(TEAMMATE, AccessLevel::View)], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    let read = service.get(&user(TEAMMATE), dashboard.id).await.unwrap();
    assert_eq!(read.access_level, AccessLevel::View);

    assert!(matches!(
        service
            .update(&user(TEAMMATE), dashboard.id, view("Changed"), None)
            .await,
        Err(DashboardError::Forbidden(_))
    ));
    assert!(matches!(
        service
            .patch_pane(
                &user(TEAMMATE),
                dashboard.id,
                "intro".to_owned(),
                json!({ "type": "md", "markdown": "x" }),
                None
            )
            .await,
        Err(DashboardError::Forbidden(_))
    ));
}

#[tokio::test]
async fn a_team_admin_edits_the_agents_dashboard_as_a_new_version() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    let saved = service
        .update(&user(ADMIN), dashboard.id, view("Edited"), None)
        .await
        .unwrap();

    assert_eq!(saved.version, Version(2));
    assert_eq!(saved.access_level, AccessLevel::Edit);
    assert_eq!(markdown_of(&saved, 0), "Edited");
    let history = service.versions(&user(AGENT), dashboard.id).await.unwrap();
    assert_eq!(
        history
            .iter()
            .map(|version| (version.version.0, version.author_id.as_ref().to_owned()))
            .collect::<Vec<_>>(),
        vec![(2, ADMIN.to_owned()), (1, AGENT.to_owned())]
    );
}

#[tokio::test]
async fn a_save_on_an_old_version_conflicts() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();
    service
        .update(
            &user(AGENT),
            dashboard.id,
            view("Second"),
            Some(Version::FIRST),
        )
        .await
        .unwrap();

    let error = service
        .update(
            &user(ADMIN),
            dashboard.id,
            view("Stale"),
            Some(Version::FIRST),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, DashboardError::Conflict(1)));
    let current = service.get(&user(AGENT), dashboard.id).await.unwrap();
    assert_eq!(markdown_of(&current, 0), "Second");
}

#[tokio::test]
async fn a_pane_patch_replaces_a_nested_widget_and_keeps_the_rest() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    let patched = service
        .patch_pane(
            &user(AGENT),
            dashboard.id,
            "notes".to_owned(),
            json!({ "type": "md", "id": "notes", "markdown": "Patched" }),
            None,
        )
        .await
        .unwrap();

    assert_eq!(patched.version, Version(2));
    assert_eq!(
        serde_json::to_value(&patched.view).unwrap()["widgets"][1]["children"][0]["markdown"],
        "Patched"
    );
    assert_eq!(markdown_of(&patched, 0), "Hi");
}

#[tokio::test]
async fn a_patch_names_a_missing_pane_or_a_bad_widget() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    let missing = service
        .patch_pane(
            &user(AGENT),
            dashboard.id,
            "nope".to_owned(),
            json!({ "type": "md", "markdown": "x" }),
            None,
        )
        .await
        .unwrap_err();
    assert!(matches!(missing, DashboardError::Invalid(problem) if problem.contains("\"nope\"")));

    let bad = service
        .patch_pane(
            &user(AGENT),
            dashboard.id,
            "intro".to_owned(),
            json!({ "type": "md" }),
            None,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(bad, DashboardError::Invalid(problem) if problem.contains("widget is missing \"markdown\""))
    );

    let duplicate = service
        .patch_pane(
            &user(AGENT),
            dashboard.id,
            "intro".to_owned(),
            json!({ "type": "md", "id": "notes", "markdown": "x" }),
            None,
        )
        .await
        .unwrap_err();
    assert!(matches!(duplicate, DashboardError::Invalid(problem) if problem.contains("\"notes\"")));
}

#[tokio::test]
async fn a_revert_saves_the_earlier_view_as_the_newest_version() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("First")).await.unwrap();
    service
        .update(&user(AGENT), dashboard.id, view("Broken"), None)
        .await
        .unwrap();

    let reverted = service
        .revert(&user(AGENT), dashboard.id, Version::FIRST)
        .await
        .unwrap();

    assert_eq!(reverted.version, Version(3));
    assert_eq!(markdown_of(&reverted, 0), "First");
    assert!(matches!(
        service.revert(&user(AGENT), dashboard.id, Version(9)).await,
        Err(DashboardError::NotFound)
    ));
}

#[tokio::test]
async fn only_the_owner_deletes() {
    let service = service(&[], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    assert!(matches!(
        service.delete(&user(ADMIN), dashboard.id).await,
        Err(DashboardError::Forbidden(_))
    ));
    service.delete(&user(AGENT), dashboard.id).await.unwrap();
    assert!(matches!(
        service.get(&user(AGENT), dashboard.id).await,
        Err(DashboardError::NotFound)
    ));
}

#[tokio::test]
async fn an_agent_sets_its_home_and_readers_with_access_see_it() {
    let service = service(&[(TEAMMATE, AccessLevel::View)], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    assert!(matches!(
        service.home(&user(TEAMMATE), &user(AGENT)).await,
        Err(DashboardError::NotFound)
    ));

    service.set_home(&user(AGENT), dashboard.id).await.unwrap();

    let home = service.home(&user(TEAMMATE), &user(AGENT)).await.unwrap();
    assert_eq!(home.id, dashboard.id);
    assert!(matches!(
        service.home(&user(STRANGER), &user(AGENT)).await,
        Err(DashboardError::NotFound)
    ));

    service.clear_home(&user(AGENT)).await.unwrap();
    assert!(matches!(
        service.home(&user(TEAMMATE), &user(AGENT)).await,
        Err(DashboardError::NotFound)
    ));
}

#[tokio::test]
async fn a_home_must_be_a_dashboard_its_account_can_edit() {
    let service = service(&[(TEAMMATE, AccessLevel::View)], &[]);
    let dashboard = service.create(&user(AGENT), view("Hi")).await.unwrap();

    assert!(matches!(
        service.set_home(&user(TEAMMATE), dashboard.id).await,
        Err(DashboardError::Forbidden(_))
    ));
    assert!(matches!(
        service.set_home(&user(STRANGER), dashboard.id).await,
        Err(DashboardError::NotFound)
    ));
}
