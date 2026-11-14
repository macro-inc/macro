(* What generated cases.ml builds for each operation: the request on the
   wire, and a way to run a reply through the operation's decoders and
   encode the result back to JSON. *)

open Macro_sdk

type reply = Json_reply of Yojson.Safe.t | Text_reply of string | Empty_reply

type outcome =
  | Reply of reply
  | Api_error of Yojson.Safe.t
  | Http_error
  | Decode_error of string

type t = {
  spec : string;
  operation_id : string;
  path : string;
      (** the path template, which identifies the operation with the method *)
  wire : Request.wire;
  outcome : status:int -> string -> outcome;
}

let config =
  Config.create ~env:Prod ~auth:(Config.Auth.user_token "test-token") ()

let make ~spec ~operation_id ~path request ~reply ~error =
  {
    spec;
    operation_id;
    path;
    wire = Request.prepare config request;
    outcome =
      (fun ~status body ->
        match Request.interpret request ~status body with
        | Ok value -> Reply (reply value)
        | Error (Error.Api { error = e; _ }) -> Api_error (error e)
        | Error (Error.Http _) -> Http_error
        | Error (Error.Decode { message; _ }) -> Decode_error message
        | Error (Error.Transport exn) -> raise exn);
  }
