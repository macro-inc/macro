# axum 0.8.9, patched

Upstream instantiates its whole handler stack (`HandlerService`, `MapIntoResponse`,
`MapFuture`, `CloneService`) once per route. Each instantiation asks rustc to prove
the handler satisfies `Handler`, which walks the handler's whole async state machine,
about 8 times per handler with nothing shared between the proofs. In a service
with hundreds of routes that was most of the monomorphization collector, which
runs inside metadata generation, so everything depending on the crate waits for it.

`BoxedIntoRoute::from_handler` now erases the handler behind `ErasedHandler`, so
the stack compiles once per state. `Handler::call_boxed` lets it call a handler
without projecting `Handler::Future`, and without boxing a function handler's
future twice. Routing and handler behaviour are unchanged; each route's call
goes through one more `Arc<dyn Fn>`.

Keep this patch when refreshing the copy, and drop the copy if upstream erases
handlers itself. The patch is confined to `src/boxed.rs` and `src/handler/mod.rs`.
