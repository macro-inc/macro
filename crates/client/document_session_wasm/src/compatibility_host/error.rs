//! Opaque callback failures keep their original JS owner through model boundaries.
use super::{wire, Error};

/// An original JS thrown value owned by a numeric host namespace, not a JS object.
#[derive(Debug, thiserror::Error)]
#[error("compatibility host callback threw")]
pub struct HostThrown {
    host_slot: u32,
    value: wire::ForeignOpaqueValue,
}
impl HostThrown {
    /// Preserve a valid thrown value, including explicit undefined and null.
    pub fn new(host_slot: u32, value: wire::ForeignOpaqueValue) -> Result<Self, Error> {
        if host_slot == 0
            || matches!(
                value,
                wire::ForeignOpaqueValue::Unknown
                    | wire::ForeignOpaqueValue::ForeignMissing {}
                    | wire::ForeignOpaqueValue::ForeignSlot { slot_id: 0 }
            )
        {
            return Err(Error::Invariant("invalid compatibility thrown value"));
        }
        Ok(Self { host_slot, value })
    }
    /// Original host namespace; slots from different hosts are unrelated.
    pub fn host_slot(&self) -> u32 {
        self.host_slot
    }
    /// Original opaque thrown value without JSON coercion or stringification.
    pub fn value(&self) -> &wire::ForeignOpaqueValue {
        &self.value
    }
    /// Carry the cause through existing fallible model callbacks.
    pub fn into_model_error(self) -> Error {
        Error::Extension(Box::new(self))
    }
    /// Recover the cause after infallible predicates defer it at a read boundary.
    pub fn from_model_error(error: &Error) -> Option<&Self> {
        match error {
            Error::Extension(cause) => cause.downcast_ref(),
            Error::ForeignReadFailed(cause) => Self::from_model_error(cause),
            _ => None,
        }
    }
}

pub(crate) fn returned(reply: wire::CompatHostReply) -> Result<wire::CompatHostReply, Error> {
    if let wire::CompatHostResult::CompatHostThrown { error } = reply.result {
        return Err(HostThrown::new(reply.host_slot, error)?.into_model_error());
    }
    Ok(reply)
}

#[cfg(test)]
mod test {
    use super::*;
    use lexical_model::ForeignReadOperation;
    #[test]
    fn opaque_owner_and_value_survive_deferred_model_failure() -> Result<(), Error> {
        let reply = wire::CompatHostReply {
            host_slot: 41,
            scope_id: 7,
            result: wire::CompatHostResult::CompatHostThrown {
                error: wire::ForeignOpaqueValue::ForeignSlot { slot_id: 19 },
            },
        };
        let error = returned(reply).expect_err("original thrown value");
        let cause = HostThrown::from_model_error(&error).expect("typed cause");
        assert_eq!(cause.host_slot(), 41);
        assert_eq!(
            *cause.value(),
            wire::ForeignOpaqueValue::ForeignSlot { slot_id: 19 }
        );
        let operation = ForeignReadOperation::begin()?;
        ForeignReadOperation::defer(error)?;
        let deferred = operation
            .finish(Ok::<(), Error>(()))
            .expect_err("deferred cause");
        let cause = HostThrown::from_model_error(&deferred).expect("same typed cause");
        assert_eq!(cause.host_slot(), 41);
        assert_eq!(
            *cause.value(),
            wire::ForeignOpaqueValue::ForeignSlot { slot_id: 19 }
        );
        assert!(ForeignReadOperation::check().is_ok());
        let undefined = HostThrown::new(42, wire::ForeignOpaqueValue::ForeignUndefined {})?;
        let null = HostThrown::new(42, wire::ForeignOpaqueValue::ForeignNull {})?;
        assert_ne!(undefined.value(), null.value());
        assert!(HostThrown::new(0, wire::ForeignOpaqueValue::ForeignNull {}).is_err());
        assert!(HostThrown::new(42, wire::ForeignOpaqueValue::Unknown).is_err());
        assert!(HostThrown::new(42, wire::ForeignOpaqueValue::ForeignMissing {}).is_err());
        assert!(HostThrown::new(42, wire::ForeignOpaqueValue::ForeignSlot { slot_id: 0 }).is_err());
        Ok(())
    }
}
