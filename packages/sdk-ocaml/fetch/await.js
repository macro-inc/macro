// The JavaScript half of caml_macro_sdk_fetch_await (await.wat): a JSPI
// Suspending import. wasm_of_ocaml's --effects=jspi loader already needs
// JSPI; this fails clearly if a runtime lacks it.
//Provides: caml_macro_sdk_fetch_await_js
var caml_macro_sdk_fetch_await_js =
  globalThis.WebAssembly && globalThis.WebAssembly.Suspending
    ? new globalThis.WebAssembly.Suspending(function (promise) {
        return promise;
      })
    : function () {
        throw new Error(
          "macro_sdk_fetch needs JSPI (WebAssembly.Suspending), which this runtime lacks",
        );
      };
