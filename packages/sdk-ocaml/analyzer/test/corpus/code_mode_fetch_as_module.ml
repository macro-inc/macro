(* expect: none *)
(* The transport used as a module (a functor argument) exposes no
   operation. *)
module type Transport = sig
  type t

  val call :
    t ->
    ('reply, 'error) Macro_sdk_runtime.Request.t ->
    ('reply, 'error Macro_sdk_runtime.Error.t) result
end

module Use (T : Transport) = struct
  let call = T.call
end

module Fetch = Use (Macro_sdk_fetch)
