use super::*;
use std::cell::Cell;

struct Scope {
    context: wire::CompatHostContext,
    calls: Cell<u32>,
}
impl CallbackScope for Scope {
    fn context(&self) -> wire::CompatHostContext {
        self.context
    }
    fn call(
        &self,
        request: wire::CompatCallbackRequest,
    ) -> Result<wire::CompatCallbackReply, Error> {
        let wire::CompatCallbackRequest::CompatCallbackReserveKeys { count } = request else {
            return Err(Error::Invariant("unexpected test operation"));
        };
        self.calls.set(self.calls.get() + 1);
        if count != 0 {
            return Err(Error::Invariant("test has no allocator"));
        }
        Ok(wire::CompatCallbackReply::CompatCallbackReservation {
            reservation: wire::CompatKeyReservation {
                editor_id: self.context.editor_id,
                reservation_id: 1,
                keys: vec![],
            },
        })
    }
}

#[test]
fn exact_callback_scopes_restore_after_nested_transport_and_expire() -> Result<(), Error> {
    let outer = Scope {
        context: wire::CompatHostContext {
            host_slot: 1,
            scope_id: next_scope_id()?,
            editor_id: 11,
            update_id: 4,
            version: 8,
            mutation_epoch: 2,
            access: wire::CompatHostAccess::Mutable,
        },
        calls: Cell::new(0),
    };
    let inner = Scope {
        context: wire::CompatHostContext {
            host_slot: 2,
            scope_id: next_scope_id()?,
            editor_id: 12,
            access: wire::CompatHostAccess::SourceRead,
            ..outer.context
        },
        calls: Cell::new(0),
    };
    let request = wire::CompatHostRequest {
        context: outer.context,
        selection: wire::CompatSelectionData::CompatNoSelection {},
        selections: vec![],
        selection_bindings: vec![],
        dirty_leaves: vec![],
        dirty_elements: vec![],
        dirty_type: 0,
        composition: wire::ForeignOptionalKey {
            present: false,
            key: wire::ForeignKey {
                index: 0,
                generation: 0,
            },
        },
        delta: wire::CompatRecordDelta {
            records: vec![],
            removed_keys: vec![],
            invalidate_root_text: false,
        },
        call: wire::CompatHostCall::CompatHostState {
            call_id: 7,
            call: wire::ForeignStateCall {
                config_id: 3,
                operation: wire::ForeignStateOperation::IsEqual,
                left: wire::ForeignOpaqueValue::ForeignUndefined {},
                right: wire::ForeignOpaqueValue::ForeignNull {},
            },
        },
    };
    let mut encoded = vec![];
    wire::CompatCallbackRequest::CompatCallbackReserveKeys { count: 0 }
        .serialize(&mut encoded)
        .map_err(|error| Error::invariant(error.to_string()))?;
    assert!(callback_call(1, outer.context.scope_id, &encoded).is_err());
    let reply = invoke_with(&outer, &request, |slot, _| {
        assert_eq!(slot, 1);
        assert!(callback_call(2, outer.context.scope_id, &encoded).is_err());
        assert!(callback_call(1, outer.context.scope_id + 1, &encoded).is_err());
        callback_call(1, outer.context.scope_id, &encoded)?;
        let nested = wire::CompatHostRequest {
            context: inner.context,
            ..request.clone()
        };
        invoke_with(&inner, &nested, |_, _| {
            assert!(callback_call(1, outer.context.scope_id, &encoded).is_err());
            callback_call(2, inner.context.scope_id, &encoded)?;
            crate::bytes(&wire::CompatHostReply {
                host_slot: 2,
                scope_id: inner.context.scope_id,
                result: wire::CompatHostResult::CompatHostThrown {
                    error: wire::ForeignOpaqueValue::ForeignUndefined {},
                },
            })
            .map_err(|error| Error::invariant(error.to_string()))
        })?;
        callback_call(1, outer.context.scope_id, &encoded)?;
        crate::bytes(&wire::CompatHostReply {
            host_slot: 1,
            scope_id: outer.context.scope_id,
            result: wire::CompatHostResult::CompatHostStateAck {
                ack: wire::CompatStateAck {
                    call_id: 7,
                    config_id: 3,
                    operation: wire::ForeignStateOperation::IsEqual,
                    result: wire::ForeignHookResult::ForeignReturned {
                        value: wire::ForeignCallbackValue::ForeignBooleanArgument { value: false },
                    },
                    value_patches: vec![],
                },
            },
        })
        .map_err(|error| Error::invariant(error.to_string()))
    })?;
    assert!(matches!(
        reply.result,
        wire::CompatHostResult::CompatHostStateAck { .. }
    ));
    assert_eq!(outer.calls.get(), 2);
    assert_eq!(inner.calls.get(), 1);
    assert!(callback_call(1, outer.context.scope_id, &encoded).is_err());
    assert!(callback_call(2, inner.context.scope_id, &encoded).is_err());

    let invalid = wire::CompatHostRequest {
        context: inner.context,
        ..request.clone()
    };
    assert!(invoke_with(&outer, &invalid, |_, _| panic!(
        "context must validate before dispatch"
    ))
    .is_err());
    let unknown = wire::CompatHostRequest {
        call: wire::CompatHostCall::Unknown,
        ..request.clone()
    };
    assert!(invoke_with(&outer, &unknown, |_, _| panic!(
        "invocation must validate before dispatch"
    ))
    .is_err());
    let invalid_dirty = wire::CompatHostRequest {
        dirty_type: 3,
        ..request.clone()
    };
    assert!(invoke_with(&outer, &invalid_dirty, |_, _| panic!(
        "dirty type validates before dispatch"
    ))
    .is_err());
    let failure: Result<wire::CompatHostReply, Error> = invoke_with(&outer, &request, |_, _| {
        Err(Error::Invariant("transport failed"))
    });
    assert!(failure.is_err());
    assert!(callback_call(1, outer.context.scope_id, &encoded).is_err());
    Ok(())
}

#[test]
fn acknowledgements_reject_wrong_scope_call_kind_and_state_identity() -> Result<(), Error> {
    let context = wire::CompatHostContext {
        host_slot: 3,
        scope_id: next_scope_id()?,
        editor_id: 5,
        update_id: 2,
        version: 4,
        mutation_epoch: 6,
        access: wire::CompatHostAccess::SourceRead,
    };
    let request = wire::CompatHostRequest {
        context,
        selection: wire::CompatSelectionData::CompatNoSelection {},
        selections: vec![],
        selection_bindings: vec![],
        dirty_leaves: vec![],
        dirty_elements: vec![],
        dirty_type: 0,
        composition: wire::ForeignOptionalKey {
            present: false,
            key: wire::ForeignKey {
                index: 0,
                generation: 0,
            },
        },
        delta: wire::CompatRecordDelta {
            records: vec![],
            removed_keys: vec![],
            invalidate_root_text: false,
        },
        call: wire::CompatHostCall::CompatHostState {
            call_id: 9,
            call: wire::ForeignStateCall {
                config_id: 1,
                operation: wire::ForeignStateOperation::Parse,
                left: wire::ForeignOpaqueValue::ForeignNull {},
                right: wire::ForeignOpaqueValue::ForeignMissing {},
            },
        },
    };
    let mut reply = wire::CompatHostReply {
        host_slot: 3,
        scope_id: context.scope_id,
        result: wire::CompatHostResult::CompatHostStateAck {
            ack: wire::CompatStateAck {
                call_id: 9,
                config_id: 1,
                operation: wire::ForeignStateOperation::Parse,
                result: wire::ForeignHookResult::ForeignInherited {},
                value_patches: vec![],
            },
        },
    };
    validate_reply(&request, &reply)?;
    reply.host_slot = 4;
    assert!(validate_reply(&request, &reply).is_err());
    reply.host_slot = 3;
    reply.scope_id += 1;
    assert!(validate_reply(&request, &reply).is_err());
    reply.scope_id = context.scope_id;
    let wire::CompatHostResult::CompatHostStateAck { ack } = &mut reply.result else {
        panic!("state");
    };
    ack.config_id = 2;
    assert!(validate_reply(&request, &reply).is_err());
    reply.result = wire::CompatHostResult::CompatHostThrown {
        error: wire::ForeignOpaqueValue::ForeignSlot { slot_id: 0 },
    };
    assert!(validate_reply(&request, &reply).is_err());
    reply.result = wire::CompatHostResult::CompatHostThrown {
        error: wire::ForeignOpaqueValue::ForeignUndefined {},
    };
    validate_reply(&request, &reply)?;
    reply.result = wire::CompatHostResult::Unknown;
    assert!(validate_reply(&request, &reply).is_err());
    Ok(())
}
