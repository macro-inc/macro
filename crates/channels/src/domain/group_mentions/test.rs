use super::*;
use crate::domain::{
    models::{ChannelParticipant, ParticipantRole},
    ports::MockChannelRepo,
};
#[tokio::test]
async fn here_includes_active_humans_and_excludes_departed_users_and_bots() {
    let mut repo = MockChannelRepo::new();
    repo.expect_get_participants()
        .once()
        .returning(|channel_id| {
            Box::pin(async move {
                Ok([
                    ("macro|active@example.com".to_string(), false),
                    ("macro|left@example.com".to_string(), true),
                    (bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(), false),
                ]
                .into_iter()
                .map(|(user_id, left)| ChannelParticipant {
                    channel_id,
                    user_id,
                    role: ParticipantRole::Member,
                    joined_at: chrono::Utc::now(),
                    left_at: left.then(chrono::Utc::now),
                })
                .collect())
            })
        });
    let members = ChannelGroupRecipients(repo)
        .channel_members(Uuid::from_u128(1))
        .await
        .unwrap();
    assert_eq!(
        members.iter().map(|u| u.as_ref()).collect::<Vec<_>>(),
        ["macro|active@example.com"]
    );
}
