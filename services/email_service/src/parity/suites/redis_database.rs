//! Provider-global keys use nextest's exclusive per-group slot on the shared server.

mod test;

pub(super) struct RedisDatabase {
    pub uri: String,
    pub connection: redis::aio::MultiplexedConnection,
    fault_user: Option<String>,
}

impl RedisDatabase {
    pub async fn start() -> Self {
        Self::configured(false).await
    }

    /// Give only this scenario's service connections a separately controlled ACL.
    pub async fn with_fault_user() -> Self {
        Self::configured(true).await
    }

    pub fn fault_user(&self) -> Option<&str> {
        self.fault_user.as_deref()
    }

    async fn configured(fault_user: bool) -> Self {
        let (base, database) = configuration();
        let mut uri = url::Url::parse(&base).expect("REDIS_URI must be a Redis URL");
        uri.set_path(&format!("/{database}"));
        let mut connection = redis::Client::open(uri.as_str())
            .expect("scenario Redis URL")
            .get_multiplexed_async_connection()
            .await
            .expect("scenario Redis connection");
        let _: () = redis::cmd("FLUSHDB")
            .query_async(&mut connection)
            .await
            .expect("clear the exclusively assigned scenario Redis database");
        let fault_user = if fault_user {
            let user = format!("email-parity-db-{database}");
            let password = uuid::Uuid::new_v4().to_string();
            let _: () = redis::cmd("ACL")
                .arg("SETUSER")
                .arg(&user)
                .arg("reset")
                .arg("on")
                .arg(format!(">{password}"))
                .arg("~*")
                .arg("&*")
                .arg("+@all")
                .query_async(&mut connection)
                .await
                .expect("scenario-specific Redis fault user");
            uri.set_username(&user).expect("Redis fault username");
            uri.set_password(Some(&password))
                .expect("Redis fault password");
            Some(user)
        } else {
            None
        };
        Self {
            uri: uri.into(),
            connection,
            fault_user,
        }
    }

    pub async fn deny_commands(&mut self, commands: &[&str]) {
        let mut command = redis::cmd("ACL");
        command
            .arg("SETUSER")
            .arg(self.fault_user.as_ref().expect("dedicated fault user"));
        for name in commands {
            command.arg(format!("-{name}"));
        }
        let _: () = command
            .query_async(&mut self.connection)
            .await
            .expect("scenario Redis fault");
    }

    pub async fn remove_fault_user(&mut self) {
        if let Some(user) = self.fault_user.take() {
            let _: usize = redis::cmd("ACL")
                .arg("DELUSER")
                .arg(user)
                .query_async(&mut self.connection)
                .await
                .expect("remove scenario Redis fault user");
        }
    }
}

#[expect(
    clippy::disallowed_methods,
    reason = "Explicit test Redis URL and nextest's exclusive group-slot assignment"
)]
fn configuration() -> (String, u8) {
    let base =
        std::env::var("REDIS_URI").expect("provider-global parity scenarios require REDIS_URI");
    let group = std::env::var("NEXTEST_TEST_GROUP").ok();
    let slot = std::env::var("NEXTEST_TEST_GROUP_SLOT").ok();
    (base, database_index(group.as_deref(), slot.as_deref()))
}

fn database_index(group: Option<&str>, slot: Option<&str>) -> u8 {
    let group =
        group.expect("provider-global parity scenarios require nextest's email-parity group");
    assert_eq!(
        group, "email-parity",
        "provider-global parity scenarios require the email-parity test group"
    );
    let slot =
        slot.expect("provider-global parity scenarios require NEXTEST_TEST_GROUP_SLOT (0..8)");
    let slot: u8 = slot
        .parse()
        .expect("NEXTEST_TEST_GROUP_SLOT must be an integer in 0..8");
    assert!(
        slot < 8,
        "NEXTEST_TEST_GROUP_SLOT must be in 0..8, matching email-parity max-threads = 8"
    );
    slot + 1
}
