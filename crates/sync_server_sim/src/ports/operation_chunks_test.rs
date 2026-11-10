use super::*;
use futures::executor::block_on;
use sync_server_core::domain::operation_chunks::{
    CHUNK_BYTES, FORMAT_MARKER_KEY, INLINE_BYTES, chunk_key,
};

#[test]
fn chunked_pending_corruption_fails_the_complete_load() {
    block_on(async {
        for damage in ["missing", "checksum", "marker"] {
            let ports = SimPorts::new();
            let update = vec![255; INLINE_BYTES + 1];
            ports
                .put_pending_operation(&OperationId::new("large".into()), &update, None)
                .await
                .unwrap();
            let pending = ports.pending_operations().await.unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].as_ref().unwrap().update, update);
            {
                let mut state = ports.0.borrow_mut();
                match damage {
                    "missing" => {
                        state.data.values.remove(&chunk_key("o/large", 1));
                    }
                    "checksum" => {
                        state.data.values.insert(
                            chunk_key("o/large", 0),
                            Rc::new(json!(vec![254; CHUNK_BYTES])),
                        );
                    }
                    "marker" => {
                        state
                            .data
                            .values
                            .insert(FORMAT_MARKER_KEY.into(), Rc::new(json!([0])));
                    }
                    _ => unreachable!(),
                }
            }
            assert!(ports.pending_operations().await.is_err(), "{damage}");
        }
    });
}

#[test]
fn legacy_unreadable_pending_entry_retains_h8_row_error() {
    block_on(async {
        let ports = SimPorts::new();
        ports
            .0
            .borrow_mut()
            .data
            .values
            .insert("o/legacy".into(), Rc::new(json!({"unreadable": true})));
        let pending = ports.pending_operations().await.unwrap();
        assert_eq!(pending.len(), 1);
        assert!(pending[0].is_err());
    });
}
