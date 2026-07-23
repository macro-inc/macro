//! GraphQL inbound adapter for capability-oriented mutations shared across
//! canonical entity types.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// Capability-oriented entity mutation inputs, outputs, and resolvers.
mod mutations;

pub use mutations::{
    ChannelSharePolicyInput, DuplicateEntityInput, EntityMutationPayload, EntityMutationRoot,
    EntityRefInput, EntitySharePolicyInput, GraphqlEntityMutationError,
    GraphqlEntityMutationErrorCode, GraphqlEntityMutationRef, GraphqlEntityMutationResult,
    GraphqlSharePolicyOperation, MoveEntityInput, RenameEntityInput, UpdateEntitySharePolicyInput,
};
