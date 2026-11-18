//! Nightly conformance checks, without credentials or automatic issue creation.
use crate::workflows::lexical_conformance;
use gh_workflow::{Event, Level, Permissions, Schedule, Workflow};
/// Run the currently implemented gates with the nightly property-test budget.
pub fn lexical_nightly() -> Workflow {
    Workflow::new("Lexical nightly")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().add_schedule(Schedule::new("17 3 * * *")))
        .add_job("native", lexical_conformance::native(true))
        .add_job("wasm", lexical_conformance::wasm())
        .add_job("fixtures", lexical_conformance::fixtures(true))
        .add_job("session", lexical_conformance::session())
}
