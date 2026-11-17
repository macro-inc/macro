;; caml_macro_sdk_fetch_await: block on a JavaScript promise. The import is a
;; JSPI Suspending function (await.js), so a call suspends the whole Wasm
;; stack, entered through the loader's WebAssembly.promising, until the
;; promise settles; a rejection comes back as a JavaScript exception, which
;; OCaml sees as Js_of_ocaml.Js_error.Exn. Runtime functions are imported
;; from "env" (see bigstringaf.wat).
(module
   (import "env" "wrap" (func $wrap (param anyref) (result (ref eq))))
   (import "env" "unwrap" (func $unwrap (param (ref eq)) (result anyref)))
   (import "js" "caml_macro_sdk_fetch_await_js"
      (func $await_js (param anyref) (result anyref)))
   (func (export "caml_macro_sdk_fetch_await") (param (ref eq)) (result (ref eq))
      (return_call $wrap (call $await_js (call $unwrap (local.get 0)))))
)
