use super::*;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Data {
    teams: HashMap<String, Uuid>,
    topics: HashMap<Uuid, ChannelTopic>,
    team_channels: HashMap<Uuid, Uuid>,
    members: HashSet<(Uuid, Uuid)>,
}

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<Data>>);

#[async_trait::async_trait]
impl TopicRepository for FakeRepo {
    async fn user_team(&self, user_id: &str) -> anyhow::Result<Option<Uuid>> {
        Ok(self.0.lock().unwrap().teams.get(user_id).copied())
    }
    async fn topic_team(&self, topic_id: Uuid) -> anyhow::Result<Option<Uuid>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .topics
            .get(&topic_id)
            .map(|topic| topic.team_id))
    }
    async fn team_channel_team(&self, channel_id: Uuid) -> anyhow::Result<Option<Uuid>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .team_channels
            .get(&channel_id)
            .copied())
    }
    async fn create(
        &self,
        id: Uuid,
        team_id: Uuid,
        name: &str,
        description: Option<&str>,
        _user_id: &str,
    ) -> anyhow::Result<()> {
        let mut data = self.0.lock().unwrap();
        let sort_order = data.topics.len() as f64;
        data.topics.insert(
            id,
            ChannelTopic {
                id,
                team_id,
                name: name.to_string(),
                description: description.map(str::to_string),
                sort_order,
                sort_position: None,
                channel_count: 0,
                channel_ids: vec![],
            },
        );
        Ok(())
    }
    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> anyhow::Result<()> {
        let mut data = self.0.lock().unwrap();
        let topic = data.topics.get_mut(&id).unwrap();
        if let Some(name) = name {
            topic.name = name.to_string();
        }
        if let Some(description) = description {
            topic.description = Some(description.to_string());
        }
        Ok(())
    }
    async fn delete(&self, id: Uuid) -> anyhow::Result<()> {
        let mut data = self.0.lock().unwrap();
        data.topics.remove(&id);
        data.members.retain(|(topic_id, _)| *topic_id != id);
        Ok(())
    }
    async fn add_channel(
        &self,
        topic_id: Uuid,
        channel_id: Uuid,
        _user_id: &str,
    ) -> anyhow::Result<()> {
        self.0
            .lock()
            .unwrap()
            .members
            .insert((topic_id, channel_id));
        Ok(())
    }
    async fn remove_channel(&self, topic_id: Uuid, channel_id: Uuid) -> anyhow::Result<()> {
        self.0
            .lock()
            .unwrap()
            .members
            .remove(&(topic_id, channel_id));
        Ok(())
    }
    async fn list(&self, team_id: Uuid, _user_id: &str) -> anyhow::Result<Vec<ChannelTopic>> {
        let data = self.0.lock().unwrap();
        let mut topics: Vec<_> = data
            .topics
            .values()
            .filter(|topic| topic.team_id == team_id)
            .cloned()
            .collect();
        for topic in &mut topics {
            topic.channel_ids = data
                .members
                .iter()
                .filter(|(id, _)| *id == topic.id)
                .map(|(_, id)| *id)
                .collect();
            topic.channel_count = topic.channel_ids.len() as i64;
        }
        topics.sort_by(|a, b| {
            (a.sort_position.unwrap_or(a.sort_order))
                .total_cmp(&b.sort_position.unwrap_or(b.sort_order))
        });
        Ok(topics)
    }
    async fn set_order(&self, _user_id: &str, ids: &[Uuid]) -> anyhow::Result<()> {
        let mut data = self.0.lock().unwrap();
        for (index, id) in ids.iter().enumerate() {
            data.topics.get_mut(id).unwrap().sort_position = Some(index as f64);
        }
        Ok(())
    }
}

fn setup() -> (TopicService<FakeRepo>, FakeRepo, Uuid) {
    let repo = FakeRepo::default();
    let team = Uuid::new_v4();
    repo.0.lock().unwrap().teams.insert("member".into(), team);
    (TopicService::new(repo.clone()), repo, team)
}

#[tokio::test]
async fn topic_crud_requires_team_membership() {
    let (service, _, _) = setup();
    assert!(matches!(
        service.create("outsider", "Engineering", None).await,
        Err(TopicError::Forbidden)
    ));
    let id = service.create("member", "Engineering", None).await.unwrap();
    assert!(matches!(
        service.update("outsider", id, Some("Design"), None).await,
        Err(TopicError::Forbidden)
    ));
    service
        .update("member", id, Some("Design"), None)
        .await
        .unwrap();
    assert_eq!(service.list("member").await.unwrap()[0].name, "Design");
    assert!(matches!(
        service.delete("outsider", id).await,
        Err(TopicError::Forbidden)
    ));
    service.delete("member", id).await.unwrap();
    assert!(service.list("member").await.unwrap().is_empty());
}

#[tokio::test]
async fn only_same_team_channels_are_filed_and_multiple_topics_work() {
    let (service, repo, team) = setup();
    let a = service.create("member", "A", None).await.unwrap();
    let b = service.create("member", "B", None).await.unwrap();
    let channel = Uuid::new_v4();
    assert!(matches!(
        service.add_channel("member", a, channel).await,
        Err(TopicError::Invalid(_))
    ));
    repo.0
        .lock()
        .unwrap()
        .team_channels
        .insert(channel, Uuid::new_v4());
    assert!(matches!(
        service.add_channel("member", a, channel).await,
        Err(TopicError::Invalid(_))
    ));
    repo.0.lock().unwrap().team_channels.insert(channel, team);
    service.add_channel("member", a, channel).await.unwrap();
    service.add_channel("member", b, channel).await.unwrap();
    assert!(
        service
            .list("member")
            .await
            .unwrap()
            .iter()
            .all(|topic| topic.channel_ids == vec![channel])
    );
    service.delete("member", a).await.unwrap();
    assert_eq!(
        service.list("member").await.unwrap()[0].channel_ids,
        vec![channel]
    );
    service.delete("member", b).await.unwrap();
    let state = repo.0.lock().unwrap();
    assert!(state.members.is_empty());
    assert_eq!(state.team_channels.get(&channel), Some(&team));
}

#[tokio::test]
async fn custom_order_is_per_user_and_rejects_other_team_ids() {
    let (service, repo, team) = setup();
    let a = service.create("member", "A", None).await.unwrap();
    let b = service.create("member", "B", None).await.unwrap();
    service.set_order("member", &[b, a]).await.unwrap();
    assert_eq!(
        service
            .list("member")
            .await
            .unwrap()
            .iter()
            .map(|topic| topic.id)
            .collect::<Vec<_>>(),
        vec![b, a]
    );
    assert!(matches!(
        service.set_order("member", &[a, a]).await,
        Err(TopicError::Invalid(_))
    ));
    let outsider = Uuid::new_v4();
    repo.0.lock().unwrap().topics.insert(
        outsider,
        ChannelTopic {
            id: outsider,
            team_id: Uuid::new_v4(),
            name: "Other".into(),
            description: None,
            sort_order: 0.0,
            sort_position: None,
            channel_count: 0,
            channel_ids: vec![],
        },
    );
    assert!(matches!(
        service.set_order("member", &[outsider]).await,
        Err(TopicError::Forbidden)
    ));
    assert_eq!(repo.0.lock().unwrap().topics.get(&a).unwrap().team_id, team);
}
