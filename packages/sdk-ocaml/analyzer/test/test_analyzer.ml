(* Each case is a whole program and what the analyzer must answer: the exact
   operation list, or a refusal whose message contains the given text (and,
   when given, sits on the given line). *)

type expected = Operations of string list | Refused of string * int option

let duplicate_check =
  {|
let main () : Macro.Json.t =
  let title = "Fix login redirect loop" in
  let body = "Signing in from a deep link returns to the login page." in
  let similar = Macro.Json.to_list (Macro.Tasks.find_similar ~title ~body ()) in
  let duplicates =
    List.filter (fun m -> Macro.Json.to_number (Macro.Json.member "similarity" m) >= 0.85) similar
  in
  if duplicates <> [] then `Assoc [ ("created", `Null); ("duplicates", `List duplicates) ]
  else
    let task = Macro.Tasks.create ~name:title ~markdown:body () in
    `Assoc [ ("created", task); ("duplicates", `List []) ]
|}

let cases =
  [
    (* What programs may do, and the operations it costs them. *)
    ("duplicate check", duplicate_check, Operations [ "storage.create_task_handler"; "storage.task_similarity_search_handler" ]);
    ("no operations", {|let main () = `String (Printf.sprintf "%d" (List.length [1; 2]))|}, Operations []);
    ( "operation passed as a function value",
      {|let run (f : Macro.Json.t -> Macro.Json.t) = f `Null
let main () = run Macro.Document.content|},
      Operations [ "storage.get_document" ] );
    ( "partial application",
      {|let remove = Macro.Document.delete
let main () = remove `Null|},
      Operations [ "storage.delete_document" ] );
    ("open", {|open Macro
let main () = Tasks.create ~name:"a" ()|}, Operations [ "storage.create_task_handler" ]);
    ("local open", {|let main () = Macro.Tasks.(create ~name:"a" ())|}, Operations [ "storage.create_task_handler" ]);
    ("let open", {|let main () = let open Macro.Document in content `Null|}, Operations [ "storage.get_document" ]);
    ( "toplevel module alias is checked at each use",
      {|module T = Macro.Tasks
let main () = T.create ~name:"x" ()|},
      Operations [ "storage.create_task_handler" ] );
    ( "let module alias is checked at each use",
      {|let main () = let module D = Macro.Document in D.content `Null|},
      Operations [ "storage.get_document" ] );
    ( "alias nested in a structure counts the whole module",
      {|module M = struct module T = Macro.Tasks end
module N : sig module T : sig val create : name:string -> ?markdown:string -> unit -> Macro.Json.t end end = M
let main () = N.T.create ~name:"x" ()|},
      Operations [ "storage.create_task_handler"; "storage.task_similarity_search_handler" ] );
    ( "signature constraint renaming an operation",
      {|module H : sig val content : Macro.Json.t -> Macro.Json.t end = Macro.Document
let main () = H.content `Null|},
      Operations [ "storage.get_document" ] );
    ( "functor argument seen through its parameter",
      {|module F (X : sig val delete : Macro.Json.t -> Macro.Json.t end) = struct let go d = X.delete d end
module G = F (Macro.Document)
let main () = G.go `Null|},
      Operations [ "storage.delete_document" ] );
    ( "functor parameter with the whole module type",
      {|module F (X : module type of Macro.Document) = struct let go d = X.content d end
module G = F (Macro.Document)
let main () = G.go `Null|},
      Operations [ "storage.delete_document"; "storage.get_document" ] );
    ( "first-class module",
      {|module type D = sig val delete : Macro.Json.t -> Macro.Json.t end
let m = (module Macro.Document : D)
let main () = let module M = (val m : D) in M.delete `Null|},
      Operations [ "storage.delete_document" ] );
    ("include of an SDK module", {|include Macro.Document
let main () = `Null|}, Operations [ "storage.delete_document"; "storage.get_document" ]);
    ( "a local module shadowing Macro calls nothing",
      {|module Sdk = Macro
module Macro = struct
  module Json = Sdk.Json
  module Tasks = struct let create ~name:_ () = `Null end
end
let main () : Macro.Json.t = Macro.Tasks.create ~name:"x" ()|},
      Operations [] );
    ( "a local module named like an SDK module",
      {|module Tasks = struct let create = Macro.Tasks.create end
let main () = Tasks.create ~name:"x" ()|},
      Operations [ "storage.create_task_handler" ] );
    ( "reference inside a functor that is never applied",
      {|module Make (X : sig end) = struct let run () = Macro.Document.delete `Null end
let main () = `Null|},
      Operations [ "storage.delete_document" ] );
    ( "reference inside a local module",
      {|let main () = let module L = struct let go () = Macro.Document.delete `Null end in L.go ()|},
      Operations [ "storage.delete_document" ] );
    ( "let rec",
      {|let rec loop n = if n = 0 then Macro.Tasks.create ~name:"x" () else loop (n - 1)
let main () = loop 3|},
      Operations [ "storage.create_task_handler" ] );
    ( "toplevel effect outside main",
      {|let _ = Macro.Document.delete `Null
let main () = `Null|},
      Operations [ "storage.delete_document" ] );
    ( "method of an object",
      {|let o = object method go = Macro.Tasks.create ~name:"x" () end
let main () = o#go|},
      Operations [ "storage.create_task_handler" ] );
    ( "binding operator",
      {|let ( let* ) x f = f x
let main () = let* t = Macro.Tasks.create ~name:"x" () in t|},
      Operations [ "storage.create_task_handler" ] );
    ( "binding operator bound to an operation",
      {|let ( let+ ) d f = f (Macro.Document.content d)
let main () = let+ c = `Null in c|},
      Operations [ "storage.get_document" ] );
    ( "standard data structures and functors",
      {|[@@@ocaml.warning "-32"]
module S = Map.Make (String)
let main () =
  let m = S.add "a" 1 S.empty in
  let h = Hashtbl.create 4 in
  Hashtbl.replace h "k" (S.cardinal m);
  `String (String.concat "," (List.map string_of_int [ Hashtbl.find h "k" ]))|},
      Operations [] );
    ( "handling Macro.Error",
      {|let main () =
  try Macro.Document.content `Null
  with Macro.Error { code; message } -> `String (code ^ ": " ^ message)|},
      Operations [ "storage.get_document" ] );
    (* Escapes. *)
    ("external", {|external magic : 'a -> 'b = "%identity"
let main () = `Null|}, Refused ("external declarations are not allowed", Some 1));
    ( "external in a signature",
      {|module M : sig external id : int -> int = "%identity" end = struct external id : int -> int = "%identity" end
let main () = `Null|},
      Refused ("external declarations are not allowed", Some 1) );
    ("Obj.magic", {|let main () : Macro.Json.t = Obj.magic 1|}, Refused ("`Obj.magic` belongs to Obj", Some 1));
    ("Stdlib.Obj.magic", {|let main () : Macro.Json.t = Stdlib.Obj.magic 1|}, Refused ("belongs to Obj", None));
    ("Stdlib__Obj.magic", {|let main () : Macro.Json.t = Stdlib__Obj.magic 1|}, Refused ("belongs to Obj", None));
    ("alias of Obj", {|module O = Obj
let main () : Macro.Json.t = O.magic 1|}, Refused ("Obj may not be used", Some 1));
    ("open Obj", {|open Stdlib.Obj
let main () : Macro.Json.t = magic 1|}, Refused ("Obj may not be used", Some 1));
    ( "Obj as a first-class module",
      {|module type M = sig val repr : 'a -> Obj.t end
let m = (module Obj : M)
let main () = `Null|},
      Refused ("exposes `Stdlib__Obj.repr`", Some 2) );
    ("Marshal", {|let main () = `String (Marshal.to_string 1 [])|}, Refused ("belongs to Marshal", None));
    ("Sys", {|let main () = `Int (Sys.command "true")|}, Refused ("belongs to Sys", None));
    ("Unix", {|let main () = `Int (Unix.getpid ())|}, Refused ("Unbound module Unix", Some 1));
    ("Dynlink", {|let main () = Dynlink.loadfile "x"; `Null|}, Refused ("Unbound module Dynlink", None));
    ("Thread", {|let main () = ignore (Thread.self ()); `Null|}, Refused ("Unbound module Thread", None));
    ("In_channel", {|let main () = `String (In_channel.input_all stdin)|}, Refused ("belongs to In_channel", None));
    ( "Out_channel",
      {|let main () = Out_channel.output_string Out_channel.stdout "x"; `Null|},
      Refused ("belongs to Out_channel", None) );
    ("print_string", {|let main () = print_string "x"; `Null|}, Refused ("`print_string` is not in the allowed", None));
    ("open_out", {|let main () = ignore (open_out "/tmp/x"); `Null|}, Refused ("`open_out`", None));
    ("exit", {|let main () = exit 0|}, Refused ("`exit`", None));
    ("at_exit", {|let () = at_exit (fun () -> ())
let main () = `Null|}, Refused ("`at_exit`", Some 1));
    ("Printf.printf", {|let main () = Printf.printf "x"; `Null|}, Refused ("not one of the allowed Printf", None));
    ("Format.std_formatter", {|let main () = Format.fprintf Format.std_formatter "x"; `Null|}, Refused ("`Format.std_formatter`", None));
    ("Effect", {|type _ Effect.t += E : unit Effect.t
let main () = Effect.perform E; `Null|}, Refused ("belongs to Effect", None));
    ("Domain", {|let main () = ignore (Domain.spawn (fun () -> ())); `Null|}, Refused ("belongs to Domain", None));
    ("Mutex", {|let main () = ignore (Mutex.create ()); `Null|}, Refused ("belongs to Mutex", None));
    ("Callback", {|let () = Callback.register "x" 1
let main () = `Null|}, Refused ("belongs to Callback", None));
    ("CamlinternalLazy", {|let main () = CamlinternalLazy.force (lazy `Null)|}, Refused ("CamlinternalLazy", None));
    ("Array.unsafe_get", {|let main () = `Int (Array.unsafe_get [| 1 |] 5)|}, Refused ("skips bounds checks", None));
    ("Bytes.unsafe_set", {|let main () = Bytes.unsafe_set (Bytes.create 1) 9 'x'; `Null|}, Refused ("skips bounds checks", None));
    ("Float.Array.unsafe_get", {|let main () = `Float (Float.Array.unsafe_get (Float.Array.make 1 0.) 3)|}, Refused ("skips bounds checks", None));
    ( "unsafe function reached through a functor parameter",
      {|module F (X : sig val unsafe_get : string -> int -> char end) = struct let g = X.unsafe_get end
module G = F (String)
let main () = `String (String.make 1 (G.g "a" 9))|},
      Refused ("exposes `Stdlib__String.unsafe_get`", Some 2) );
    ("include String", {|include String
let main () = `Null|}, Refused ("unsafe", Some 1));
    ("include Stdlib", {|include Stdlib
let main () = `Null|}, Refused ("`Stdlib` cannot be used as a module", Some 1));
    ( "printf reached through a functor parameter",
      {|module F (X : sig val printf : ('a, out_channel, unit) format -> 'a end) = struct let p = X.printf end
module G = F (Printf)
let main () = G.p "x"; `Null|},
      Refused ("exposes `Stdlib__Printf.printf`", Some 2) );
    ( "transport named directly",
      {|let main () = Mini_transport.call "storage.delete_document" `Null|},
      Refused ("`Mini_transport.call` is SDK internals", Some 1) );
    ( "transport through an alias",
      {|module T = Mini_transport
let main () = T.call "storage.delete_document" `Null|},
      Refused ("`T.call` is SDK internals", Some 2) );
    ( "transport through open",
      {|open Mini_transport
let main () = call "storage.delete_document" `Null|},
      Refused ("`call` is SDK internals", Some 2) );
    ( "transport through a functor",
      {|module F (X : sig val call : string -> Macro.Json.t -> Macro.Json.t end) = struct let c = X.call end
module G = F (Mini_transport)
let main () = G.c "storage.delete_document" `Null|},
      Refused ("exposes `Mini_transport.call`", Some 2) );
    ( "transport through a signature constraint",
      {|module H : module type of Mini_transport = Mini_transport
let main () = H.call "storage.delete_document" `Null|},
      Refused ("exposes `Mini_transport.call`", Some 1) );
    ( "transport through a nested alias",
      {|module M = struct module T = Mini_transport end
let main () = `Null|},
      Refused ("exposes `Mini_transport.call`", Some 1) );
    ( "transport through a let module alias",
      {|let main () = let module T = Mini_transport in T.call "storage.delete_document" `Null|},
      Refused ("`T.call` is SDK internals", Some 1) );
    ( "transport alias given to a functor",
      {|module T = Mini_transport
module F (X : sig val call : string -> Macro.Json.t -> Macro.Json.t end) = struct let c = X.call end
module G = F (T)
let main () = G.c "storage.delete_document" `Null|},
      Refused ("exposes `Mini_transport.call`", Some 3) );
    ("include of a transport alias", {|module T = Mini_transport
include T
let main () = `Null|}, Refused ("exposes `Mini_transport.call`", Some 2));
    ( "transport through a recursive module",
      {|module rec R : sig val call : string -> Macro.Json.t -> Macro.Json.t end = Mini_transport
let main () = R.call "storage.delete_document" `Null|},
      Refused ("exposes `Mini_transport.call`", Some 1) );
    ( "the transport's HTTP client is hidden",
      {|let main () = ignore (Macro_sdk_http.post_json ~url:"http://x" "{}"); `Null|},
      Refused ("Unbound module Macro_sdk_http", Some 1) );
    ("Yojson is hidden", {|let main () = Yojson.Safe.from_file "/etc/passwd"|}, Refused ("Unbound module Yojson", Some 1));
    ( "forged operation attribute",
      {|let call (_ : string) = `Null [@@macro.op "storage.task_similarity_search_handler"]
let main () = call "x"|},
      Refused ("attribute [@macro.op] is not allowed", Some 1) );
    ("ppx attribute", {|let main () = `Null [@@deriving yojson]|}, Refused ("attribute [@deriving]", Some 1));
    ("extension node", {|let main () = [%sdk Document.delete]|}, Refused ("extension node [%sdk]", Some 1));
    ("missing main", {|let run () = `Null|}, Refused ("must define `let main () : Macro.Json.t", None));
    ("main of the wrong type", {|let main () = 1|}, Refused ("must define `let main () : Macro.Json.t", None));
    ( "main returning a local type named Macro.Json.t",
      {|module Macro = struct module Json = struct type t = int end end
let main () : Macro.Json.t = 1|},
      Refused ("must define `let main () : Macro.Json.t", None) );
    ( "main typed with the reserved type name",
      {|type __macro_sdk_main_result = int
let main () : __macro_sdk_main_result = 1|},
      Refused ("type name __macro_sdk_main_result is reserved", Some 1) );
    ( "the reserved type name brought in by include",
      {|include struct type __macro_sdk_main_result = int end
let main () = 1|},
      Refused ("type name __macro_sdk_main_result is reserved", Some 1) );
    ("syntax error", "let main () =\n  `Null in", Refused ("Syntax error", Some 2));
    ( "every refusal is reported",
      {|let a = Obj.magic
let b = Sys.time
let main () = `Null|},
      Refused ("belongs to Sys", Some 2) );
  ]

let describe = function
  | Ok operations -> "operations [" ^ String.concat "; " (List.map (fun (o : Macro_sdk_analyzer.Sdk.operation) -> o.name) operations) ^ "]"
  | Error errors ->
      "refused: "
      ^ String.concat " | "
          (List.map (fun (e : Macro_sdk_analyzer.Analyze.error) -> Printf.sprintf "line %d: %s" e.line e.message) errors)

let contains text fragment =
  let length = String.length fragment in
  let rec search index =
    index + length <= String.length text && (String.sub text index length = fragment || search (index + 1))
  in
  search 0

let passes expected result =
  match (expected, result) with
  | Operations names, Ok operations ->
      List.map (fun (o : Macro_sdk_analyzer.Sdk.operation) -> o.name) operations = names
  | Refused (fragment, line), Error errors ->
      List.exists
        (fun (e : Macro_sdk_analyzer.Analyze.error) ->
          contains e.message fragment && match line with Some line -> e.line = line | None -> true)
        errors
  | _ -> false

(* A compiled module in the caller's directory must not be visible. *)
let current_directory_is_not_searched sdk =
  let directory = Filename.temp_dir "analyzer-cwd" "" in
  Out_channel.with_open_bin (Filename.concat directory "stray.ml") (fun channel ->
      output_string channel "let x = 1\n");
  let previous = Sys.getcwd () in
  Sys.chdir directory;
  let compiled = Sys.command "ocamlfind ocamlc -c stray.ml" = 0 in
  let result =
    Macro_sdk_analyzer.Analyze.program sdk ~filename:"prog.ml" "let main () = `Int Stray.x"
  in
  Sys.chdir previous;
  let ok = compiled && passes (Refused ("Unbound module Stray", Some 1)) result in
  Printf.printf "%s %s\n" (if ok then "ok  " else "FAIL") "a module in the current directory is not visible";
  if not ok then Printf.printf "     got %s\n" (describe result);
  ok

let () =
  match Macro_sdk_analyzer.Sdk.locate () with
  | Error message ->
      prerr_endline message;
      exit 1
  | Ok sdk ->
      let failures =
        List.filter
          (fun (name, source, expected) ->
            let result = Macro_sdk_analyzer.Analyze.program sdk ~filename:"prog.ml" source in
            let ok = passes expected result in
            Printf.printf "%s %s\n" (if ok then "ok  " else "FAIL") name;
            if not ok then Printf.printf "     got %s\n" (describe result);
            not ok)
          cases
      in
      let cwd_ok = current_directory_is_not_searched sdk in
      let failed = List.length failures + if cwd_ok then 0 else 1 in
      Printf.printf "%d cases, %d failed\n" (List.length cases + 1) failed;
      if failed > 0 then exit 1
