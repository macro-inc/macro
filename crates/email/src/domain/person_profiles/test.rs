use super::*;
use std::sync::{Arc, Mutex};

const THREAD: &str = "0198f0aa-0000-7000-8000-000000000001";

#[derive(Default)]
struct State {
    participants: Vec<String>,
    own: Vec<String>,
    stored: Vec<(PersonProfile, DateTime<Utc>)>,
    fail_store: bool,
    stored_queries: Vec<Vec<String>>,
}

#[derive(Clone, Default)]
struct FakeRepo(Arc<Mutex<State>>);

impl PersonProfileRepository for FakeRepo {
    async fn thread_participants(&self, _: Uuid, limit: i64) -> Result<Vec<String>, Report> {
        assert_eq!(limit, MAX_THREAD_PARTICIPANTS);
        Ok(self.0.lock().unwrap().participants.clone())
    }
    async fn viewer_addresses(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<String>, Report> {
        Ok(self.0.lock().unwrap().own.clone())
    }
    async fn stored_profiles(
        &self,
        addresses: &[String],
        fresh_after: DateTime<Utc>,
    ) -> Result<Vec<PersonProfile>, Report> {
        let mut state = self.0.lock().unwrap();
        state.stored_queries.push(addresses.to_vec());
        Ok(state
            .stored
            .iter()
            .filter(|(p, at)| addresses.contains(&p.email_address) && *at >= fresh_after)
            .map(|(p, _)| p.clone())
            .collect())
    }
    async fn store_profiles(
        &self,
        profiles: &[PersonProfile],
        resolved_at: DateTime<Utc>,
    ) -> Result<(), Report> {
        let mut state = self.0.lock().unwrap();
        if state.fail_store {
            return Err(rootcause::report!("database unavailable"));
        }
        for profile in profiles {
            state
                .stored
                .retain(|(p, _)| p.email_address != profile.email_address);
            state.stored.push((profile.clone(), resolved_at));
        }
        Ok(())
    }
}

#[derive(Clone)]
struct FakeResolver {
    calls: Arc<Mutex<Vec<Vec<String>>>>,
    answer: fn(&str) -> Option<PersonProfile>,
    available: bool,
}

impl FakeResolver {
    fn new(answer: fn(&str) -> Option<PersonProfile>) -> Self {
        Self {
            calls: Arc::default(),
            answer,
            available: true,
        }
    }
    fn calls(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
    }
}

impl PersonProfileResolver for FakeResolver {
    async fn resolve(&self, addresses: &[String]) -> PersonResolution {
        self.calls.lock().unwrap().push(addresses.to_vec());
        if !self.available {
            return PersonResolution::Unavailable;
        }
        PersonResolution::Resolved(
            addresses
                .iter()
                .map(|a| (self.answer)(a).unwrap_or_else(|| PersonProfile::unmatched(a.clone())))
                .collect(),
        )
    }
}

fn profile(address: &str, headline: &str) -> PersonProfile {
    PersonProfile {
        email_address: address.to_string(),
        linkedin_url: Some(format!("https://www.linkedin.com/in/{headline}")),
        headline: Some(headline.to_string()),
        ..PersonProfile::default()
    }
}

fn ada_only(address: &str) -> Option<PersonProfile> {
    (address == "ada@example.com").then(|| profile(address, "engineer"))
}

fn everyone(address: &str) -> Option<PersonProfile> {
    Some(profile(address, "person"))
}

fn thread_receipt(entity_type: EntityType) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
        THREAD,
        entity_type,
    )
}

fn repo_with(participants: &[&str], own: &[&str]) -> FakeRepo {
    let repo = FakeRepo::default();
    {
        let mut state = repo.0.lock().unwrap();
        state.participants = participants.iter().map(|s| s.to_string()).collect();
        state.own = own.iter().map(|s| s.to_string()).collect();
    }
    repo
}

#[tokio::test]
async fn a_new_contact_is_looked_up_once_and_then_served_from_the_cache() {
    let repo = repo_with(
        &["owner@example.com", "ada@example.com"],
        &["owner@example.com"],
    );
    let resolver = FakeResolver::new(ada_only);
    let service = PersonProfileService::new(repo.clone(), Some(resolver.clone()));

    let first = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();
    let second = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();

    assert_eq!(first, vec![profile("ada@example.com", "engineer")]);
    assert_eq!(second, first);
    assert_eq!(resolver.calls(), vec![vec!["ada@example.com".to_string()]]);
}

#[tokio::test]
async fn misses_are_cached_and_not_returned() {
    let repo = repo_with(&["ada@example.com", "noreply@example.com"], &[]);
    let resolver = FakeResolver::new(ada_only);
    let service = PersonProfileService::new(repo.clone(), Some(resolver.clone()));

    for _ in 0..2 {
        let profiles = service
            .thread_profiles(thread_receipt(EntityType::EmailThread))
            .await
            .unwrap();
        assert_eq!(profiles, vec![profile("ada@example.com", "engineer")]);
    }
    assert_eq!(resolver.calls().len(), 1);
    assert!(
        repo.0
            .lock()
            .unwrap()
            .stored
            .iter()
            .any(|(p, _)| p == &PersonProfile::unmatched("noreply@example.com".to_string()))
    );
}

#[tokio::test]
async fn entries_older_than_the_refresh_window_are_looked_up_again() {
    let repo = repo_with(&["ada@example.com"], &[]);
    repo.0.lock().unwrap().stored.push((
        profile("ada@example.com", "old"),
        Utc::now() - REFRESH_AFTER - TimeDelta::days(1),
    ));
    let resolver = FakeResolver::new(ada_only);
    let service = PersonProfileService::new(repo, Some(resolver.clone()));

    let profiles = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();

    assert_eq!(profiles, vec![profile("ada@example.com", "engineer")]);
    assert_eq!(resolver.calls().len(), 1);
}

#[tokio::test]
async fn one_read_looks_up_at_most_one_batch_in_thread_order() {
    let participants: Vec<String> = (0..MAX_LOOKUPS_PER_READ + 3)
        .map(|i| format!("p{i:02}@example.com"))
        .collect();
    let refs: Vec<&str> = participants.iter().map(String::as_str).collect();
    let repo = repo_with(&refs, &[]);
    let resolver = FakeResolver::new(everyone);
    let service = PersonProfileService::new(repo, Some(resolver.clone()));

    let first = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();
    let second = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();

    assert_eq!(first.len(), MAX_LOOKUPS_PER_READ);
    assert_eq!(first[0].email_address, "p00@example.com");
    assert_eq!(second.len(), participants.len());
    assert_eq!(
        resolver.calls(),
        vec![
            participants[..MAX_LOOKUPS_PER_READ].to_vec(),
            participants[MAX_LOOKUPS_PER_READ..].to_vec(),
        ]
    );
}

#[tokio::test]
async fn the_viewers_own_addresses_are_never_looked_up() {
    let repo = repo_with(&["owner@example.com"], &["owner@example.com"]);
    let resolver = FakeResolver::new(everyone);
    let service = PersonProfileService::new(repo.clone(), Some(resolver.clone()));

    let profiles = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();

    assert!(profiles.is_empty());
    assert!(resolver.calls().is_empty());
    assert!(repo.0.lock().unwrap().stored_queries.is_empty());
}

#[tokio::test]
async fn an_unavailable_provider_stores_nothing_so_the_next_read_retries() {
    let repo = repo_with(&["ada@example.com"], &[]);
    let mut resolver = FakeResolver::new(ada_only);
    resolver.available = false;
    let service = PersonProfileService::new(repo.clone(), Some(resolver.clone()));

    for _ in 0..2 {
        let profiles = service
            .thread_profiles(thread_receipt(EntityType::EmailThread))
            .await
            .unwrap();
        assert!(profiles.is_empty());
    }
    assert_eq!(resolver.calls().len(), 2);
    assert!(repo.0.lock().unwrap().stored.is_empty());
}

#[tokio::test]
async fn a_failed_store_still_answers_the_read() {
    let repo = repo_with(&["ada@example.com"], &[]);
    repo.0.lock().unwrap().fail_store = true;
    let service = PersonProfileService::new(repo, Some(FakeResolver::new(ada_only)));

    let profiles = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();

    assert_eq!(profiles, vec![profile("ada@example.com", "engineer")]);
}

#[tokio::test]
async fn without_a_resolver_only_stored_profiles_are_served() {
    let repo = repo_with(&["ada@example.com", "bob@example.com"], &[]);
    repo.0
        .lock()
        .unwrap()
        .stored
        .push((profile("bob@example.com", "designer"), Utc::now()));
    let service = PersonProfileService::<_, FakeResolver>::new(repo, None);

    let profiles = service
        .thread_profiles(thread_receipt(EntityType::EmailThread))
        .await
        .unwrap();

    assert_eq!(profiles, vec![profile("bob@example.com", "designer")]);
}

#[tokio::test]
async fn non_user_and_non_thread_receipts_are_rejected() {
    let resolver = FakeResolver::new(everyone);
    let service =
        PersonProfileService::new(repo_with(&["ada@example.com"], &[]), Some(resolver.clone()));
    let internal = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
        THREAD,
        EntityType::EmailThread,
    );
    assert!(matches!(
        service.thread_profiles(internal).await,
        Err(PersonProfileError::Unauthorized)
    ));
    assert!(matches!(
        service
            .thread_profiles(thread_receipt(EntityType::Document))
            .await,
        Err(PersonProfileError::Unauthorized)
    ));
    assert!(resolver.calls().is_empty());
}
