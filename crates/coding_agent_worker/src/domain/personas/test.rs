use super::*;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Units {
    state: Arc<Mutex<UnitState>>,
    actions: Arc<Mutex<Vec<UnitAction>>>,
}

impl UnitController for Units {
    type Err = std::io::Error;

    async fn state(&self, name: &str) -> Result<UnitState, Self::Err> {
        if name == "broken" {
            return Err(std::io::Error::other("unavailable"));
        }
        Ok(*self.state.lock().unwrap())
    }

    async fn apply(&self, name: &str, action: UnitAction) -> Result<(), Self::Err> {
        self.actions.lock().unwrap().push(action);
        if name == "cannot-start" {
            return Err(std::io::Error::other("controller unavailable"));
        }
        Ok(())
    }
}

#[tokio::test]
async fn failed_control_attempts_back_off_and_cap_at_five_minutes() {
    let checked_at = Utc::now();
    let units = Units {
        state: Arc::new(Mutex::new(UnitState::Failed)),
        actions: Default::default(),
    };
    let health = Health(Arc::new(Mutex::new(PersonaHealth::Healthy {
        checked_at,
        last_turn_at: None,
    })));
    let mut supervisor = Supervisor::new(units.clone(), health);
    let config = Personas::from([("cannot-start".to_owned(), NonZeroU16::new(7801))]);
    let mut now = Instant::now();
    for (attempt, delay) in [5, 10, 20, 40, 80, 160, 300, 300].into_iter().enumerate() {
        let report = supervisor.snapshot(&config, now, checked_at).await;
        assert!(matches!(report.get("cannot-start"),
            Some(PersonaHealth::Unhealthy { last_error, .. }) if last_error == "could not start the brain unit"));
        assert_eq!(units.actions.lock().unwrap().len(), attempt + 1);
        supervisor
            .snapshot(&config, now + Duration::from_secs(delay - 1), checked_at)
            .await;
        assert_eq!(units.actions.lock().unwrap().len(), attempt + 1);
        now += Duration::from_secs(delay);
    }
}

#[derive(Clone)]
struct Health(Arc<Mutex<PersonaHealth>>);

impl HealthProbe for Health {
    async fn probe(&self, _: NonZeroU16, _: DateTime<Utc>) -> PersonaHealth {
        self.0.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn stopped_and_failed_units_back_off_until_health_recovers() {
    let checked_at = Utc::now();
    let units = Units {
        state: Arc::new(Mutex::new(UnitState::Stopped)),
        actions: Arc::new(Mutex::new(Vec::new())),
    };
    let health = Health(Arc::new(Mutex::new(PersonaHealth::Missing {
        checked_at,
        last_error: "not listening".to_owned(),
        last_turn_at: None,
    })));
    let mut supervisor = Supervisor::new(units.clone(), health.clone());
    let config = Personas::from([("persona".to_owned(), NonZeroU16::new(7801))]);
    let now = Instant::now();

    supervisor.snapshot(&config, now, checked_at).await;
    supervisor
        .snapshot(&config, now + Duration::from_secs(4), checked_at)
        .await;
    assert_eq!(*units.actions.lock().unwrap(), [UnitAction::Start]);
    supervisor
        .snapshot(&config, now + Duration::from_secs(5), checked_at)
        .await;
    *units.state.lock().unwrap() = UnitState::Failed;
    supervisor
        .snapshot(&config, now + Duration::from_secs(14), checked_at)
        .await;
    assert_eq!(
        *units.actions.lock().unwrap(),
        [UnitAction::Start, UnitAction::Start]
    );
    supervisor
        .snapshot(&config, now + Duration::from_secs(15), checked_at)
        .await;
    assert_eq!(
        *units.actions.lock().unwrap(),
        [UnitAction::Start, UnitAction::Start, UnitAction::Restart]
    );

    *units.state.lock().unwrap() = UnitState::Active;
    *health.0.lock().unwrap() = PersonaHealth::Healthy {
        checked_at,
        last_turn_at: Some(checked_at),
    };
    supervisor
        .snapshot(&config, now + Duration::from_secs(16), checked_at)
        .await;
    *units.state.lock().unwrap() = UnitState::Stopped;
    supervisor
        .snapshot(&config, now + Duration::from_secs(17), checked_at)
        .await;
    assert_eq!(units.actions.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn unavailable_probes_and_brain_restarts_keep_the_last_completed_turn() {
    let checked_at = Utc::now();
    let units = Units {
        state: Arc::new(Mutex::new(UnitState::Active)),
        actions: Default::default(),
    };
    let health = Health(Arc::new(Mutex::new(PersonaHealth::Healthy {
        checked_at,
        last_turn_at: Some(checked_at),
    })));
    let mut supervisor = Supervisor::new(units, health.clone());
    let config = Personas::from([("persona".to_owned(), NonZeroU16::new(7801))]);
    let now = Instant::now();
    supervisor.snapshot(&config, now, checked_at).await;
    *health.0.lock().unwrap() = PersonaHealth::Missing {
        checked_at,
        last_error: "unavailable".to_owned(),
        last_turn_at: None,
    };
    let missing = supervisor.snapshot(&config, now, checked_at).await;
    assert!(
        matches!(missing.get("persona"), Some(PersonaHealth::Missing { last_turn_at: Some(turn), .. }) if *turn == checked_at)
    );
    *health.0.lock().unwrap() = PersonaHealth::Healthy {
        checked_at,
        last_turn_at: None,
    };
    let restarted = supervisor.snapshot(&config, now, checked_at).await;
    assert_eq!(
        restarted.get("persona"),
        Some(&PersonaHealth::Healthy {
            checked_at,
            last_turn_at: Some(checked_at)
        })
    );
}

#[tokio::test]
async fn one_bad_persona_does_not_hide_the_others_or_run_unsafe_unit_names() {
    let checked_at = Utc::now();
    let units = Units {
        state: Arc::new(Mutex::new(UnitState::Active)),
        actions: Default::default(),
    };
    let health = Health(Arc::new(Mutex::new(PersonaHealth::Healthy {
        checked_at,
        last_turn_at: None,
    })));
    let mut supervisor = Supervisor::new(units.clone(), health);
    let config = Personas::from([
        ("broken".to_owned(), NonZeroU16::new(7801)),
        ("persona".to_owned(), NonZeroU16::new(7802)),
        ("invalid-port".to_owned(), None),
        ("--unsafe".to_owned(), NonZeroU16::new(7803)),
    ]);
    let report = supervisor
        .snapshot(&config, Instant::now(), checked_at)
        .await;
    assert!(matches!(
        report.get("persona"),
        Some(PersonaHealth::Healthy { .. })
    ));
    for name in ["broken", "invalid-port", "--unsafe"] {
        assert!(matches!(
            report.get(name),
            Some(PersonaHealth::Unhealthy { .. })
        ));
    }
    assert!(units.actions.lock().unwrap().is_empty());
    assert!(
        supervisor
            .snapshot(&Personas::new(), Instant::now(), checked_at)
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn systemd_restart_in_progress_and_missing_units_are_not_restarted() {
    let checked_at = Utc::now();
    let units = Units {
        state: Arc::new(Mutex::new(UnitState::Transitioning)),
        actions: Default::default(),
    };
    let health = Health(Arc::new(Mutex::new(PersonaHealth::Healthy {
        checked_at,
        last_turn_at: None,
    })));
    let mut supervisor = Supervisor::new(units.clone(), health);
    let config = Personas::from([("persona".to_owned(), NonZeroU16::new(7801))]);
    for state in [UnitState::Transitioning, UnitState::Missing] {
        *units.state.lock().unwrap() = state;
        let report = supervisor
            .snapshot(&config, Instant::now(), checked_at)
            .await;
        assert!(matches!(
            report.get("persona"),
            Some(PersonaHealth::Missing { .. })
        ));
    }
    assert!(units.actions.lock().unwrap().is_empty());
}
