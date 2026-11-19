(* Why a call failed. ['e] is the operation's declared error body type
   ([Request.no_error] when it declares none). *)
type 'e t =
  | Api of { status : int; error : 'e; body : string }
      (** A status the operation declares, with its decoded JSON body. *)
  | Http of { status : int; body : string }
      (** Any other non-2xx status, or a declared error body that did not decode. *)
  | Decode of { status : int; message : string; body : string }
      (** A 2xx reply whose body does not match the spec. *)
  | Transport of exn  (** Connection, TLS or protocol failure. *)

let to_string = function
  | Api { status; body; _ } | Http { status; body } ->
      Printf.sprintf "HTTP %d: %s" status body
  | Decode { status; message; _ } ->
      Printf.sprintf "HTTP %d reply did not decode: %s" status message
  | Transport exn -> "transport error: " ^ Printexc.to_string exn

let status = function
  | Api { status; _ } | Http { status; _ } | Decode { status; _ } -> Some status
  | Transport _ -> None

exception Macro_error of { status : int option; message : string }

let raise_error error =
  raise (Macro_error { status = status error; message = to_string error })
