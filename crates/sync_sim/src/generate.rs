//! Shrinking deletes abstract actions and moves numeric indices toward zero.
//! The world, rather than the generator, resolves positions against live content.
use crate::*;
use proptest::prelude::*;
use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};

mod materialize;
mod scenarios;

/// Native GenericSurface configurations; editor/session builds are pending siblings.
#[derive(Clone, Copy, Debug, Default)]
pub enum ScriptShape {
    /// Ordinary form clients with direct sockets.
    #[default]
    Forms,
    /// Two document routes sharing each browser's real RouterCore.
    Routed,
}
impl ScriptShape {
    /// GenericSurface direct sessions.
    pub fn forms() -> Self {
        Self::Forms
    }
    /// GenericSurface routed sessions.
    pub fn routed() -> Self {
        Self::Routed
    }
}
/// A shrinkable action recipe. Fields remain abstract until world execution.
#[derive(Clone, Debug)]
pub struct Action {
    pub(crate) kind: u8,
    pub(crate) client: u8,
    pub(crate) field: u16,
    pub(crate) value: u16,
    pub(crate) duration: u16,
}
/// A fully reproducible generator draw, independent of the world RNG seed.
#[derive(Clone, Debug)]
pub struct GeneratedScript {
    pub(crate) shape: ScriptShape,
    pub(crate) clients: u8,
    pub(crate) profiles: u8,
    pub(crate) read: u8,
    pub(crate) comment: u8,
    pub(crate) ai: bool,
    pub(crate) scenario: u8,
    pub(crate) actions: Vec<Action>,
}
/// Draw20–200 weighted actions and a causal scenario. Standard Vec shrinking
/// deletes actions; bounded numeric strategies shrink clients/indices/values.
pub fn script_strategy(shape: ScriptShape) -> impl Strategy<Value = GeneratedScript> {
    let action = (
        0u8..100,
        any::<u8>(),
        any::<u16>(),
        any::<u16>(),
        any::<u16>(),
    )
        .prop_map(|(kind, client, field, value, duration)| Action {
            kind,
            client,
            field,
            value,
            duration,
        });
    (
        2u8..5,
        1u8..4,
        0u8..10,
        0u8..10,
        any::<bool>(),
        0u8..20,
        proptest::collection::vec(action, 20..201),
    )
        .prop_map(
            move |(clients, profiles, read, comment, ai, scenario, actions)| GeneratedScript {
                shape,
                clients,
                profiles,
                read,
                comment,
                ai,
                scenario,
                actions,
            },
        )
}
/// Reproduce an unshrunk coverage draw without reading the environment or using
/// ambient randomness. Shrunk failures additionally print their complete literal script.
pub fn seeded_script(seed: u64, shape: ScriptShape) -> GeneratedScript {
    use proptest::strategy::ValueTree;
    seeded_tree(seed, shape).current()
}
/// Retain the standard proptest value tree when minimizing an observed coverage draw.
pub fn seeded_tree(
    seed: u64,
    shape: ScriptShape,
) -> impl proptest::strategy::ValueTree<Value = GeneratedScript> {
    let mut bytes = [0u8; 32];
    for (index, chunk) in bytes.chunks_mut(8).enumerate() {
        chunk.copy_from_slice(&seed.wrapping_add(index as u64).to_le_bytes());
    }
    let mut runner = TestRunner::new_with_rng(
        Config::default(),
        TestRng::from_seed(RngAlgorithm::ChaCha, &bytes),
    );
    script_strategy(shape)
        .new_tree(&mut runner)
        .expect("bounded strategy")
}
