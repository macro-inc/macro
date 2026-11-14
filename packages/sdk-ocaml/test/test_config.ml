(* Client configuration: auth headers as packages/sdk/src/utils/client.ts
   sends them, environment fallbacks, and the host table against
   packages/sdk/src/config.ts. *)

open Macro_sdk_runtime
module Auth = Config.Auth

let failures = ref 0

let check name condition =
  if not condition then begin
    incr failures;
    Printf.printf "FAIL %s\n" name
  end

let raises name f =
  match f () with
  | _ -> check (name ^ ": raises") false
  | exception (Invalid_argument _ | Failure _) -> ()

let headers ?requested_as ?(has_bot_scope = false) auth =
  Auth.headers ?requested_as ~has_bot_scope auth

let with_env assignments f =
  let saved = List.map (fun (k, _) -> (k, Sys.getenv_opt k)) assignments in
  let set (k, v) = Unix.putenv k (Option.value v ~default:"") in
  List.iter set assignments;
  Fun.protect f ~finally:(fun () -> List.iter set saved)

(* HOSTS in config.ts: "  dev: {" opens an environment, "    key: 'url'," is an entry. *)
let typescript_hosts () =
  let root = Sys.getenv "DUNE_SOURCEROOT" in
  let lines =
    In_channel.with_open_text
      (Filename.concat root "../sdk/src/config.ts")
      In_channel.input_lines
  in
  let unquote s =
    String.trim s |> fun s ->
    if String.length s >= 2 && (s.[0] = '\'' || s.[0] = '"') then
      String.sub s 1 (String.length s - 2)
    else s
  in
  let rec scan env inside acc = function
    | [] -> List.rev acc
    | line :: rest -> (
        let trimmed = String.trim line in
        if String.starts_with ~prefix:"export const HOSTS" trimmed then
          scan env true acc rest
        else if not inside then scan env inside acc rest
        else if trimmed = "};" then List.rev acc
        else
          match
            List.find_opt
              (fun e -> trimmed = e ^ ": {")
              [ "dev"; "prod"; "local" ]
          with
          | Some e -> scan (Some e) inside acc rest
          | None -> (
              match (env, String.index_opt trimmed ':') with
              | Some e, Some i
                when (not (String.starts_with ~prefix:"//" trimmed))
                     && trimmed <> "}," ->
                  let key = unquote (String.sub trimmed 0 i) in
                  let value =
                    String.sub trimmed (i + 1) (String.length trimmed - i - 1)
                  in
                  let value =
                    unquote
                      (if String.ends_with ~suffix:"," value then
                         String.sub value 0 (String.length value - 1)
                       else value)
                  in
                  scan env inside ((e, key, value) :: acc) rest
              | _ -> scan env inside acc rest))
  in
  scan None false [] lines

let () =
  (* User credentials pick their header from the prefix. *)
  check "bearer"
    (headers (Auth.user_token "jwt") = [ ("authorization", "Bearer jwt") ]);
  check "mak_ key"
    (headers (Auth.user_token "mak_123")
    = [ ("x-macro-user-api-key", "mak_123") ]);
  check "api key"
    (headers (Auth.User_api_key "old") = [ ("x-macro-user-api-key", "old") ]);
  raises "bot token as user" (fun () -> headers (Auth.user_token "mbot_1"));
  raises "bot token as api key" (fun () -> headers (Auth.User_api_key "mbot_1"));

  (* Bots: scope defaults to team, or user when acting for someone. *)
  check "bot team"
    (headers (Auth.bot "mbot_1")
    = [ ("x-macro-bot-token", "mbot_1"); ("x-macro-bot-scope", "team") ]);
  check "bot for user"
    (headers ~requested_as:"macro|u" (Auth.bot "mbot_1")
    = [
        ("x-macro-bot-token", "mbot_1");
        ("x-macro-bot-scope", "user");
        ("x-macro-bot-for-macro-user-id", "macro|u");
      ]);
  check "explicit scope"
    (headers (Auth.bot ~scope:User_scope "mbot_1")
    = [ ("x-macro-bot-token", "mbot_1"); ("x-macro-bot-scope", "user") ]);
  check "operation scope wins"
    (headers ~has_bot_scope:true (Auth.bot "mbot_1")
    = [ ("x-macro-bot-token", "mbot_1") ]);
  raises "user key as bot" (fun () -> headers (Auth.bot "mak_1"));
  raises "requested_as needs a bot" (fun () ->
      Config.create ~auth:(Auth.user_token "t") ~requested_as:"u" ());

  (* Environment fallbacks. *)
  with_env
    [
      ("MACRO_ENV", Some "dev");
      ("MACRO_API_KEY", Some "mak_env");
      ("MACRO_BOT_TOKEN", None);
    ]
    (fun () ->
      let config = Config.create () in
      check "MACRO_ENV" (config.env = Dev);
      check "MACRO_API_KEY"
        (headers config.auth = [ ("x-macro-user-api-key", "mak_env") ]));
  with_env
    [
      ("MACRO_ENV", None);
      ("MACRO_API_KEY", None);
      ("MACRO_BOT_TOKEN", Some "mbot_env");
    ]
    (fun () ->
      let config = Config.create () in
      check "prod by default" (config.env = Prod);
      check "MACRO_BOT_TOKEN"
        (List.mem ("x-macro-bot-token", "mbot_env") (headers config.auth)));
  with_env
    [ ("MACRO_API_KEY", Some "a"); ("MACRO_BOT_TOKEN", Some "mbot_b") ]
    (fun () -> raises "both credentials" (fun () -> Config.create ()));
  with_env
    [ ("MACRO_API_KEY", None); ("MACRO_BOT_TOKEN", None) ]
    (fun () ->
      let config = Config.create () in
      raises "no credential fails when sending" (fun () -> headers config.auth));
  with_env
    [ ("MACRO_ENV", Some "staging") ]
    (fun () -> raises "bad MACRO_ENV" (fun () -> Config.create ()));

  (* Hosts: overrides win; the table matches the TypeScript SDK's. *)
  let config =
    Config.create ~env:Dev ~auth:(Auth.user_token "t")
      ~hosts:[ ("storage", "http://localhost:9999") ]
      ()
  in
  check "override" (Config.host config "storage" = "http://localhost:9999");
  check "search on the storage host"
    (Config.host config "search" = "https://dev-gateway.macro.com/dss");
  let typescript = List.sort compare (typescript_hosts ()) in
  let env_name = function
    | Config.Dev -> "dev"
    | Prod -> "prod"
    | Local -> "local"
  in
  let ocaml =
    List.sort compare
      (List.concat_map
         (fun (env, hosts) ->
           List.map (fun (service, url) -> (env_name env, service, url)) hosts)
         Config.hosts)
  in
  check "parsed config.ts" (List.length typescript = 42);
  List.iter
    (fun (env, service, url) ->
      if not (List.mem (env, service, url) ocaml) then
        check
          (Printf.sprintf "OCaml host table lacks %s %s %s" env service url)
          false)
    typescript;
  List.iter
    (fun (env, service, url) ->
      if not (List.mem (env, service, url) typescript) then
        check
          (Printf.sprintf "OCaml host %s %s %s is not in config.ts" env service
             url)
          false)
    ocaml;

  if !failures > 0 then exit 1;
  print_endline "config: all checks passed"
