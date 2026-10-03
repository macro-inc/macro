use super::*;
use crate::domain::{
    models::CreateScheduledAction,
    ports::ScheduledActionService,
    service::test::{FakeRepo, configuration, service, user},
};
use std::sync::Mutex;

struct Repo(Mutex<SharedRoutine>);
impl RoutineSharingRepo for Repo {
    async fn get(&self, id: Uuid) -> Result<Option<SharedRoutine>> {
        Ok(Some(self.0.lock().unwrap().clone()).filter(|r| r.action.id == Some(id)))
    }
    async fn list(&self, _teams: Vec<Uuid>) -> Result<Vec<SharedRoutine>> {
        Ok(vec![self.0.lock().unwrap().clone()])
    }
    async fn share(&self, _: Uuid, team: Option<Uuid>) -> Result<()> {
        self.0.lock().unwrap().team_id = team;
        Ok(())
    }
}
struct Teams(Vec<Uuid>);
impl RoutineTeams for Teams {
    async fn teams(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<Uuid>> {
        Ok(self.0.clone())
    }
}
async fn setup(
    team: Option<Uuid>,
    member: bool,
) -> (RoutineSharingServiceImpl<Repo, Teams, FakeRepo>, Uuid) {
    let action = service(false)
        .create_action(
            CreateScheduledAction::Canonical(configuration(false)),
            user(),
        )
        .await
        .unwrap();
    let id = action.id.unwrap();
    (
        RoutineSharingServiceImpl::new(
            Repo(Mutex::new(SharedRoutine {
                action,
                team_id: team,
            })),
            Teams(if member {
                team.into_iter().collect()
            } else {
                vec![]
            }),
            Arc::new(FakeRepo::default()),
        ),
        id,
    )
}
fn other() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|teammate@macro.com").unwrap()
}
#[tokio::test]
async fn personal_routines_are_private_even_to_teammates() {
    let (service, id) = setup(None, true).await;
    assert!(service.get(id, other()).await.is_err());
    assert!(service.history(id, other()).await.is_err());
    assert!(service.list(other()).await.unwrap().is_empty());
    assert!(service.get(id, user()).await.is_ok());
}
#[tokio::test]
async fn members_read_shared_routines_but_cannot_reshare_them() {
    let team = macro_uuid::generate_uuid_v7();
    let (service, id) = setup(Some(team), true).await;
    assert!(service.get(id, other()).await.is_ok());
    assert!(service.history(id, other()).await.is_ok());
    assert_eq!(service.list(other()).await.unwrap().len(), 1);
    assert!(service.share(id, None, other()).await.is_err());
    service.share(id, None, user()).await.unwrap();
    assert!(service.get(id, other()).await.is_err());
}
#[tokio::test]
async fn nonmembers_cannot_read_history_or_share_to_a_team() {
    let team = macro_uuid::generate_uuid_v7();
    let (service, id) = setup(Some(team), false).await;
    assert!(service.get(id, other()).await.is_err());
    assert!(service.history(id, other()).await.is_err());
    assert!(service.share(id, Some(team), user()).await.is_err());
    // A creator who left a team can still revoke its access.
    assert!(service.share(id, None, user()).await.is_ok());
}
