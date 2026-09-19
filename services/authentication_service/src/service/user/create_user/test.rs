use std::sync::Mutex;

use macro_env_var::optional_read_env_var;

use super::{LOCAL_STRIPE_SECRET_STUB, is_local_stripe_stub, local_stripe_customer_id};

/// Tests mutate the process env, which is process-global; serialize them so
/// they can't interleave.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Restores the saved `STRIPE_SECRET_KEY` on drop, so a panicking test body
/// can't leak its value into later tests.
struct RestoreStripeKey(Option<String>);

impl Drop for RestoreStripeKey {
    fn drop(&mut self) {
        match self.0.take() {
            Some(saved) => unsafe { std::env::set_var("STRIPE_SECRET_KEY", saved) },
            None => unsafe { std::env::remove_var("STRIPE_SECRET_KEY") },
        }
    }
}

fn with_stripe_key(key: Option<&str>, f: impl FnOnce()) {
    let _guard = ENV_LOCK.lock().unwrap();
    let _restore = RestoreStripeKey(optional_read_env_var("STRIPE_SECRET_KEY").ok().flatten());
    match key {
        Some(key) => unsafe { std::env::set_var("STRIPE_SECRET_KEY", key) },
        None => unsafe { std::env::remove_var("STRIPE_SECRET_KEY") },
    };
    f();
}

#[test]
fn local_stub_key_is_detected() {
    with_stripe_key(Some(LOCAL_STRIPE_SECRET_STUB), || {
        assert!(is_local_stripe_stub());
    });
}

#[test]
fn real_key_is_not_detected_as_stub() {
    with_stripe_key(Some("sk_live_real_key"), || {
        assert!(!is_local_stripe_stub());
    });
}

#[test]
fn missing_key_is_not_detected_as_stub() {
    with_stripe_key(None, || {
        assert!(!is_local_stripe_stub());
    });
}

#[test]
fn local_stripe_customer_id_is_unique_per_email() {
    let alice = local_stripe_customer_id("alice@seed.macro.local");
    let bob = local_stripe_customer_id("bob@seed.macro.local");
    assert_ne!(alice, bob);
    assert!(alice.contains("alice@seed.macro.local"));
}
