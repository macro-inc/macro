//! Trusted lifecycle operations; rollout cannot suspend revocation or erasure.
use super::*;
impl PasswordService {
    /// Purge the namespace before removing any metadata or erasure identities.
    #[tracing::instrument(skip_all,err,name="passwords.team.purge",fields(team_id=%team.0,outcome=tracing::field::Empty))]
    pub async fn purge_team(&self, team: TeamId) -> Result<(), Error> {
        let _lease = self.repository.lock(team, ItemId(Uuid::nil())).await?;
        self.repository.close_team(team).await?;
        self.provider.purge_namespace(team).await?;
        self.repository.purge_team_metadata(team).await?;
        tracing::Span::current().record("outcome", "purged");
        Ok(())
    }

    /// Close all admissions for the deleting account before membership discovery.
    #[tracing::instrument(skip_all, err, name = "passwords.account.close", fields(outcome=tracing::field::Empty))]
    pub async fn close_user(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        self.repository.close_user(user).await?;
        tracing::Span::current().record("outcome", "closed");
        Ok(())
    }

    /// Account deletion awaits private erasure after team membership cleanup.
    /// Already-shared records remain with the team's current owner.
    #[tracing::instrument(skip_all,err,name="passwords.account.purge",fields(outcome=tracing::field::Empty))]
    pub async fn purge_user(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        self.repository.close_user(user).await?;
        for team in self.repository.user_vault_teams(user).await? {
            let _lease = self.repository.lock(team, ItemId(Uuid::nil())).await?;
            let owner = self.repository.team_owner(team).await?;
            if owner == *user {
                return Err(Error::Busy);
            }
            self.repository.depart_user(team, user, &owner).await?;
            loop {
                let items = self.repository.retired_user_items(team, user).await?;
                if items.is_empty() {
                    break;
                }
                for item in items {
                    if !self.erase_retired_record(team, item).await? {
                        return Err(Error::Unavailable);
                    }
                }
            }
            self.repository.scrub_user_metadata(team, user).await?;
        }
        tracing::Span::current().record("outcome", "purged");
        Ok(())
    }

    /// Retry durable private-item erasures without needing the removed member's session.
    #[tracing::instrument(skip_all,err,name="passwords.items.cleanup",fields(completed=tracing::field::Empty,failed=tracing::field::Empty))]
    pub async fn cleanup_retired_items(&self) -> Result<usize, Error> {
        let mut completed = 0;
        let mut failed = 0;
        for (team, item) in self.repository.item_cleanup_due().await? {
            match self.erase_retired_item(team, item).await {
                Ok(true) => completed += 1,
                Ok(false) => {}
                Err(error) => {
                    failed += 1;
                    tracing::warn!(team_id=%team.0,item_id=%item.0,error=%error,"passwords private-item erasure failed; retained for retry");
                }
            }
        }
        tracing::Span::current().record("completed", completed);
        tracing::Span::current().record("failed", failed);
        Ok(completed)
    }

    #[tracing::instrument(skip_all,err,name="passwords.item.erase",fields(team_id=%team.0,item_id=%item.0,outcome=tracing::field::Empty))]
    async fn erase_retired_item(&self, team: TeamId, item: ItemId) -> Result<bool, Error> {
        let _lease = match self.repository.lock(team, item).await {
            Ok(lease) => lease,
            Err(Error::Busy) => {
                tracing::Span::current().record("outcome", "contended");
                return Ok(false);
            }
            Err(error) => return Err(error),
        };
        self.erase_retired_record(team, item).await
    }

    #[tracing::instrument(skip_all,err,name="passwords.item.erase_provider",fields(team_id=%team.0,item_id=%item.0,outcome=tracing::field::Empty))]
    pub(super) async fn erase_retired_record(
        &self,
        team: TeamId,
        item: ItemId,
    ) -> Result<bool, Error> {
        let record = match self.repository.get(team, item).await {
            Ok(record) => record,
            Err(Error::NotFound) => return Ok(false),
            Err(error) => return Err(error),
        };
        if record.member_removal_pending {
            return Err(Error::Busy);
        }
        if !record.deleting {
            return Ok(false);
        }
        self.repository.retire_totp(team, item, None).await?;
        for key in self.repository.totp_keys(team, item).await? {
            self.provider.delete_totp(team, key).await?;
        }
        self.provider.delete(team, item).await?;
        self.repository.delete(team, item).await?;
        tracing::Span::current().record("outcome", "erased");
        Ok(true)
    }
    #[tracing::instrument(skip_all,err,name="passwords.totp.erase",fields(team_id=%cleanup.team_id.0,key_id=%cleanup.key_id.0,outcome=tracing::field::Empty))]
    pub(super) async fn erase_retired_totp(&self, cleanup: TotpCleanup) -> Result<bool, Error> {
        let _lease = match self.repository.lock(cleanup.team_id, cleanup.item_id).await {
            Ok(lease) => lease,
            Err(Error::Busy) => {
                tracing::Span::current().record("outcome", "contended");
                return Ok(false);
            }
            Err(error) => return Err(error),
        };
        if !self.repository.totp_cleanup_ready(cleanup).await? {
            tracing::Span::current().record("outcome", "quarantined");
            return Ok(false);
        }
        self.provider
            .delete_totp(cleanup.team_id, cleanup.key_id)
            .await?;
        self.repository.finish_totp_cleanup(cleanup).await?;
        tracing::Span::current().record("outcome", "erased");
        Ok(true)
    }
}

#[cfg(test)]
mod test {
    use super::super::test::fakes::*;
    use super::*;
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    use std::sync::atomic::{AtomicBool, Ordering};
    #[derive(Clone)]
    struct TraceBuffer(Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for TraceBuffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for TraceBuffer {
        type Writer = Self;
        fn make_writer(&'a self) -> Self {
            self.clone()
        }
    }
    struct Fixture {
        service: PasswordService,
        repository: Arc<FakeRepository>,
        provider: Arc<FakeProvider>,
        team: TeamId,
        item: ItemId,
        actor: Actor,
    }
    impl Fixture {
        async fn new() -> Self {
            let repository = Arc::new(FakeRepository::new());
            let provider = Arc::new(FakeProvider::new());
            let service = PasswordService {
                repository: repository.clone(),
                provider: provider.clone(),
                reauthentication: Arc::new(FakeReauthentication {
                    recent: AtomicBool::new(true),
                }),
                availability: Arc::new(FakeAvailability),
            };
            let team = TeamId(Uuid::now_v7());
            let actor = Actor {
                user_id: MacroUserIdStr::parse_from_str("macro|departed@example.test")
                    .unwrap()
                    .into_owned(),
                session_token: None,
            };
            repository
                .memberships
                .lock()
                .unwrap()
                .insert(actor.user_id.to_string(), vec![team]);
            let item = service
                .create(
                    &actor,
                    team,
                    WriteItem {
                        operation_id: Uuid::now_v7(),
                        name: "Credential".into(),
                        kind: ItemKind::Login,
                        url: None,
                        folder_id: None,
                        favorite: false,
                        expected_version: None,
                        values: SecretValues {
                            username: SecretString("account".into()),
                            password: SecretString("synthetic".into()),
                            notes: SecretString(String::new()),
                            fields: vec![],
                        },
                    },
                )
                .await
                .unwrap()
                .id;
            Self {
                service,
                repository,
                provider,
                team,
                item,
                actor,
            }
        }
    }
    #[tokio::test]
    async fn namespace_failure_retains_metadata_closes_admission_and_retry_completes() {
        let f = Fixture::new().await;
        f.provider.fail_purge.store(true, Ordering::SeqCst);
        assert!(matches!(
            f.service.purge_team(f.team).await,
            Err(Error::Unavailable)
        ));
        assert!(f.repository.records.lock().unwrap().contains_key(&f.item.0));
        assert!(matches!(
            f.service
                .reveal(&f.actor, f.team, f.item, None, false)
                .await,
            Err(Error::NotFound)
        ));
        f.provider.fail_purge.store(false, Ordering::SeqCst);
        f.service.purge_team(f.team).await.unwrap();
        assert_eq!(*f.provider.purged.lock().unwrap(), vec![f.team]);
        assert!(f.repository.records.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn disclosure_after_lease_loss_and_membership_revocation_returns_no_secret() {
        // The provider completes after the database lease was lost and revocation committed.
        // A real lease prevents this interleaving; the marker fake intentionally allows it.
        let buffer = TraceBuffer(Arc::new(std::sync::Mutex::new(vec![])));
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
            .with_writer(buffer.clone())
            .finish();
        let f = Fixture::new().await;
        *f.provider.revoke_on_disclosure.lock().unwrap() = Some(f.repository.clone());
        // Keep the collector alive for spans whose callsites other tests have cached.
        // Provider redaction tests retain their own scoped subscribers.
        tracing::subscriber::set_global_default(subscriber).unwrap();
        let result = f
            .service
            .reveal(&f.actor, f.team, f.item, None, false)
            .await;
        assert!(matches!(result, Err(Error::NotFound)));
        let trace = String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap();
        assert!(trace.contains("passwords.disclosure.recheck"), "{trace}");
        assert!(trace.contains("post_io_access_denied=true"));
        assert!(trace.contains("outcome=\"denied\""));
        assert!(!trace.contains("synthetic"));
        let f = Fixture::new().await;
        *f.provider.revoke_on_disclosure.lock().unwrap() = Some(f.repository.clone());
        assert!(matches!(
            f.service.copy(&f.actor, f.team, f.item, None).await,
            Err(Error::NotFound)
        ));
        let f = Fixture::new().await;
        *f.provider.revoke_on_disclosure.lock().unwrap() = Some(f.repository.clone());
        assert!(matches!(
            f.service.history(&f.actor, f.team, f.item).await,
            Err(Error::NotFound)
        ));
        let f = Fixture::new().await;
        f.service
            .configure_totp(
                &f.actor,
                f.team,
                f.item,
                Some(SecretString("JBSWY3DPEHPK3PXP".into())),
            )
            .await
            .unwrap();
        *f.provider.revoke_on_disclosure.lock().unwrap() = Some(f.repository.clone());
        assert!(matches!(
            f.service.totp(&f.actor, f.team, f.item).await,
            Err(Error::NotFound)
        ));
    }

    #[tokio::test]
    async fn private_membership_fence_does_not_disclose_item_existence_to_other_members() {
        let f = Fixture::new().await;
        f.repository
            .records
            .lock()
            .unwrap()
            .get_mut(&f.item.0)
            .unwrap()
            .member_removal_pending = true;
        let other = Actor {
            user_id: MacroUserIdStr::parse_from_str("macro|other@example.test")
                .unwrap()
                .into_owned(),
            session_token: None,
        };
        f.repository
            .memberships
            .lock()
            .unwrap()
            .insert(other.user_id.to_string(), vec![f.team]);
        assert!(matches!(
            f.service.get(&other, f.team, f.item).await,
            Err(Error::NotFound)
        ));
        assert!(matches!(
            f.service.reveal(&other, f.team, f.item, None, false).await,
            Err(Error::NotFound)
        ));
        assert!(matches!(
            f.service.username(&other, f.team, f.item, false).await,
            Err(Error::NotFound)
        ));
    }
    #[tokio::test]
    async fn reversible_member_fence_blocks_values_and_deletion_without_erasure() {
        let f = Fixture::new().await;
        f.repository
            .records
            .lock()
            .unwrap()
            .get_mut(&f.item.0)
            .unwrap()
            .member_removal_pending = true;
        assert!(matches!(
            f.service
                .reveal(&f.actor, f.team, f.item, None, false)
                .await,
            Err(Error::Busy)
        ));
        assert!(matches!(
            f.service.delete(&f.actor, f.team, f.item).await,
            Err(Error::Busy)
        ));
        assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 0);
        assert!(f.provider.stored.lock().unwrap().contains_key(&f.item.0));
        f.repository
            .records
            .lock()
            .unwrap()
            .get_mut(&f.item.0)
            .unwrap()
            .member_removal_pending = false;
        f.service
            .reveal(&f.actor, f.team, f.item, None, false)
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn private_erasure_survives_provider_failure_and_needs_no_departed_members_session() {
        let f = Fixture::new().await;
        f.repository
            .records
            .lock()
            .unwrap()
            .get_mut(&f.item.0)
            .unwrap()
            .deleting = true;
        f.repository.memberships.lock().unwrap().clear();
        f.provider.fail_delete.store(true, Ordering::SeqCst);
        assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 0);
        assert!(f.provider.stored.lock().unwrap().contains_key(&f.item.0));
        assert!(
            f.repository
                .records
                .lock()
                .unwrap()
                .get(&f.item.0)
                .unwrap()
                .deleting
        );
        f.provider.fail_delete.store(false, Ordering::SeqCst);
        assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 1);
        assert!(!f.provider.stored.lock().unwrap().contains_key(&f.item.0));
        assert!(
            f.repository.records.lock().unwrap().contains_key(&f.item.0),
            "retain the metadata fence"
        );
    }
}
