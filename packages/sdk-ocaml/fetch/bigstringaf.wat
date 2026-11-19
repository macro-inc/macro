;; bigstringaf's C stubs for wasm_of_ocaml (the package ships only a
;; js_of_ocaml runtime.js). Each forwards to the wasm_of_ocaml runtime's
;; bigstring primitive; uri parses with angstrom, which blits through these.
;; Runtime functions are imported from "env": build-runtime merges user
;; files first, so an import naming the defining file ("bigstring") stays
;; unresolved and instantiation fails.
(module
   (import "env" "caml_bigstring_blit_ba_to_bytes"
      (func $ba_to_bytes (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))))
   (import "env" "caml_bigstring_blit_ba_to_ba"
      (func $ba_to_ba (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))))
   (import "env" "caml_bigstring_blit_bytes_to_ba"
      (func $bytes_to_ba (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))))
   (import "env" "caml_bigstring_memcmp"
      (func $memcmp (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))))
   (import "env" "caml_bigstring_memcmp_string"
      (func $memcmp_string (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))))
   (import "env" "caml_bigstring_memchr"
      (func $memchr (param (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))))

   (func (export "bigstringaf_blit_to_bytes")
      (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))
      (return_call $ba_to_bytes (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4)))
   (func (export "bigstringaf_blit_to_bigstring")
      (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))
      (return_call $ba_to_ba (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4)))
   (func (export "bigstringaf_blit_from_bytes")
      (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))
      (return_call $bytes_to_ba (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4)))
   (func (export "bigstringaf_memcmp_bigstring")
      (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))
      (return_call $memcmp (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4)))
   (func (export "bigstringaf_memcmp_string")
      (param (ref eq) (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))
      (return_call $memcmp_string (local.get 0) (local.get 1) (local.get 2) (local.get 3) (local.get 4)))
   ;; bigstringaf: (ba, off, chr, len); the runtime: (ba, chr, off, len).
   (func (export "bigstringaf_memchr")
      (param (ref eq) (ref eq) (ref eq) (ref eq)) (result (ref eq))
      (return_call $memchr (local.get 0) (local.get 2) (local.get 1) (local.get 3)))
)
