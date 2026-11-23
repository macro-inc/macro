use super::super::*;
use crate::domain::mailbox::catalog::InboxAddressLookup;
use models_email::gmail::inbox_sync::{GooglePublicKeys, JwkKey, JwtVerificationError, KeyMap};
use models_email::service::link::UserProvider;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(super) const LINK: Uuid = Uuid::from_u128(7);

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub(super) enum Fault {
    #[error("read failed")]
    Read,
    #[error("write failed")]
    Write,
    #[error("fetch failed")]
    Fetch,
    #[error("lookup failed")]
    Lookup,
    #[error("queue failed")]
    Queue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Call {
    Read,
    Fetch,
    Write(Vec<String>, u64),
    Verify(String, Vec<String>),
    Authenticate(Option<String>),
    Lookup(String, String),
    Queue(Uuid, u64),
}

pub(super) struct Data {
    pub calls: Vec<Call>,
    pub cached: Option<Result<Option<KeyMap>, Fault>>,
    pub fetched: VecDeque<Result<GooglePublicKeys, Fault>>,
    pub verified: VecDeque<Result<(), JwtVerificationError>>,
    pub fail_write: bool,
    pub auth_error: Option<PushAuthenticationError>,
    pub link: Option<Uuid>,
    pub fail_lookup: bool,
    pub fail_queue: bool,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            calls: Vec::new(),
            cached: Some(Ok(Some(keys("cached")))),
            fetched: VecDeque::from([Ok(public_keys("fresh"))]),
            verified: VecDeque::from([Ok(())]),
            fail_write: false,
            auth_error: None,
            link: Some(LINK),
            fail_lookup: false,
            fail_queue: false,
        }
    }
}

pub(super) fn keys(kid: &str) -> KeyMap {
    KeyMap::from([(
        kid.to_owned(),
        JwkKey {
            kid: kid.into(),
            alg: "RS256".into(),
            kty: "RSA".into(),
            n: "public-modulus".into(),
            e: "AQAB".into(),
            use_: None,
            use_field: None,
        },
    )])
}

pub(super) fn public_keys(kid: &str) -> GooglePublicKeys {
    GooglePublicKeys {
        max_age_seconds: 17,
        keys: keys(kid),
    }
}

fn kids(keys: &KeyMap) -> Vec<String> {
    let mut kids: Vec<_> = keys.keys().cloned().collect();
    kids.sort();
    kids
}

#[derive(Clone)]
pub(super) struct Fake(pub Arc<Mutex<Data>>);

pub(super) fn authentication(data: Data) -> (GooglePushAuthentication<Fake, Fake, Fake>, Fake) {
    let fake = Fake(Arc::new(Mutex::new(data)));
    (
        GooglePushAuthentication {
            cache: fake.clone(),
            source: fake.clone(),
            verifier: fake.clone(),
        },
        fake,
    )
}

pub(super) fn intake(
    data: Data,
    require_authentication: bool,
) -> (GmailPushService<Fake, Fake, Fake>, Fake) {
    let fake = Fake(Arc::new(Mutex::new(data)));
    (
        GmailPushService {
            authentication: fake.clone(),
            require_authentication,
            inboxes: fake.clone(),
            queue: fake.clone(),
        },
        fake,
    )
}

impl PushKeyCache for Fake {
    type Err = Fault;
    async fn read(&self) -> Result<Option<KeyMap>, Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(Call::Read);
        data.cached.take().unwrap()
    }
    async fn write(&self, keys: &GooglePublicKeys) -> Result<(), Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls
            .push(Call::Write(kids(&keys.keys), keys.max_age_seconds));
        if data.fail_write {
            Err(Fault::Write)
        } else {
            Ok(())
        }
    }
}

impl PushKeySource for Fake {
    type Err = Fault;
    async fn fetch(&self) -> Result<GooglePublicKeys, Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(Call::Fetch);
        data.fetched.pop_front().unwrap()
    }
}

impl PushTokenVerifier for Fake {
    fn verify(&self, token: &str, keys: KeyMap) -> Result<(), JwtVerificationError> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(Call::Verify(token.into(), kids(&keys)));
        data.verified.pop_front().unwrap()
    }
}

impl PushAuthentication for Fake {
    async fn authenticate(
        &self,
        authorization: Option<&str>,
    ) -> Result<(), PushAuthenticationError> {
        let mut data = self.0.lock().unwrap();
        data.calls
            .push(Call::Authenticate(authorization.map(str::to_owned)));
        match data.auth_error.take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl InboxAddressLookup for Fake {
    type Err = Fault;
    async fn by_provider_email(
        &self,
        email: &str,
        provider: UserProvider,
    ) -> Result<Option<Uuid>, Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls
            .push(Call::Lookup(email.into(), provider.as_str().into()));
        if data.fail_lookup {
            Err(Fault::Lookup)
        } else {
            Ok(data.link)
        }
    }
}

impl GmailPushQueue for Fake {
    type Err = Fault;
    async fn notify(&self, link: Uuid, history: u64) -> Result<(), Fault> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(Call::Queue(link, history));
        if data.fail_queue {
            Err(Fault::Queue)
        } else {
            Ok(())
        }
    }
}
