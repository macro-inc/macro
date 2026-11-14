(* Which Macro environment and service hosts to use, and how to authenticate.
   Mirrors packages/sdk/src/config.ts and packages/sdk/src/utils/client.ts. *)

type env = Dev | Prod | Local

let env_of_string = function
  | "dev" -> Dev
  | "prod" -> Prod
  | "local" -> Local
  | other ->
      invalid_arg
        (Printf.sprintf "invalid MACRO_ENV %S: expected local, dev, or prod"
           other)

(* Service base URLs per environment. `search` and `properties` are served on
   the storage host. Hand-copied from HOSTS in packages/sdk/src/config.ts; see
   .agents/rules/config-and-service-urls.md. *)
let default_host env service =
  match (env, service) with
  | Dev, "agent-harness" -> Some "https://dev-gateway.macro.com/agent-harness"
  | Dev, ("storage" | "properties" | "search") ->
      Some "https://dev-gateway.macro.com/dss"
  | Dev, "auth" -> Some "https://dev-gateway.macro.com/auth"
  | Dev, "email" -> Some "https://dev-gateway.macro.com/email"
  | Dev, "calendar" -> Some "https://dev-gateway.macro.com/calendar"
  | Dev, "cognition" -> Some "https://dev-gateway.macro.com/cognition"
  | Dev, "notification" -> Some "https://dev-gateway.macro.com/notification"
  | Dev, "scheduled-action" ->
      Some "https://dev-gateway.macro.com/scheduled-action"
  | Dev, "static-files" -> Some "https://static-file-service-dev.macro.com"
  | Dev, "connection" -> Some "https://dev-gateway.macro.com/connection-gateway"
  | Dev, "contacts" -> Some "https://dev-gateway.macro.com/contacts"
  | Dev, "unfurl" -> Some "https://dev-gateway.macro.com/unfurl"
  | Prod, "agent-harness" -> Some "https://gateway.macro.com/agent-harness"
  | Prod, ("storage" | "properties" | "search") ->
      Some "https://gateway.macro.com/dss"
  | Prod, "auth" -> Some "https://gateway.macro.com/auth"
  | Prod, "email" -> Some "https://gateway.macro.com/email"
  | Prod, "calendar" -> Some "https://gateway.macro.com/calendar"
  | Prod, "cognition" -> Some "https://gateway.macro.com/cognition"
  | Prod, "notification" -> Some "https://gateway.macro.com/notification"
  | Prod, "scheduled-action" ->
      Some "https://gateway.macro.com/scheduled-action"
  | Prod, "static-files" -> Some "https://static-file-service.macro.com"
  | Prod, "connection" -> Some "https://gateway.macro.com/connection-gateway"
  | Prod, "contacts" -> Some "https://gateway.macro.com/contacts"
  | Prod, "unfurl" -> Some "https://gateway.macro.com/unfurl"
  | Local, "agent-harness" -> Some "http://localhost:8101"
  | Local, ("storage" | "properties" | "search") -> Some "http://localhost:8086"
  | Local, "auth" -> Some "http://localhost:8080"
  | Local, "email" -> Some "http://localhost:8087"
  (* calendar_service also serves its routes under /calendar, which keeps
     local paths identical to the gateway's. *)
  | Local, "calendar" -> Some "http://localhost:8088/calendar"
  | Local, "cognition" -> Some "http://localhost:8101/cognition"
  | Local, "notification" -> Some "http://localhost:8089"
  | Local, "scheduled-action" -> Some "http://localhost:8101/scheduled-action"
  | Local, "static-files" -> Some "http://localhost:8100"
  | Local, "connection" -> Some "http://localhost:8082"
  | Local, "contacts" -> Some "http://localhost:8083"
  | Local, "unfurl" -> Some "http://localhost:8095"
  | _ -> None

module Auth = struct
  type bot_scope = User_scope | Team_scope

  (* A user has a bearer token or `mak_` key ([User_token], header picked from
     the prefix at send time) or a Settings API key of any vintage
     ([User_api_key], always sent as x-macro-user-api-key). A bot sends its
     `mbot_` token plus a scope. Token functions are called per request. *)
  type t =
    | User_token of (unit -> string)
    | User_api_key of string
    | Bot of { token : unit -> string; scope : bot_scope option }

  let user_token token = User_token (fun () -> token)
  let bot ?scope token = Bot { token = (fun () -> token); scope }
  let user_api_key_header = "x-macro-user-api-key"
  let is_bot_token = String.starts_with ~prefix:"mbot_"

  let bot_as_user () =
    invalid_arg
      "bot token passed as a user credential. Use Auth.bot or MACRO_BOT_TOKEN."

  (* Headers for one request. [has_bot_scope] is true when the operation
     already sets x-macro-bot-scope, which then wins. *)
  let headers ?requested_as ~has_bot_scope auth =
    match auth with
    | Bot { token; scope } ->
        let token = token () in
        if not (is_bot_token token) then
          invalid_arg
            "user API key passed as a bot token. Use Auth.user_token or \
             MACRO_API_KEY.";

        let scope_header =
          if has_bot_scope then []
          else
            let scope =
              match (scope, requested_as) with
              | Some User_scope, _ | None, Some _ -> "user"
              | Some Team_scope, _ | None, None -> "team"
            in
            [ ("x-macro-bot-scope", scope) ]
        in
        let acting_user =
          match requested_as with
          | Some user -> [ ("x-macro-bot-for-macro-user-id", user) ]
          | None -> []
        in
        (("x-macro-bot-token", token) :: scope_header) @ acting_user
    | User_api_key key ->
        if is_bot_token key then bot_as_user ();
        [ (user_api_key_header, key) ]
    | User_token token ->
        let token = token () in
        if is_bot_token token then bot_as_user ();
        if String.starts_with ~prefix:"mak_" token then
          [ (user_api_key_header, token) ]
        else [ ("authorization", "Bearer " ^ token) ]
end

type t = {
  env : env;
  hosts : (string * string) list;  (** per-service overrides, by spec name *)
  auth : Auth.t;
  requested_as : string option;  (** the user a bot acts for *)
}

(* An unset or empty variable is absent, as in the TypeScript SDK. *)
let getenv name =
  match Sys.getenv_opt name with Some "" | None -> None | value -> value

let no_credential () =
  failwith
    "no Macro credential. Set MACRO_API_KEY (API key or bearer token) or \
     MACRO_BOT_TOKEN, or pass ~auth."

(* The credential when none is passed: MACRO_API_KEY (user) or
   MACRO_BOT_TOKEN (bot), never both. With neither, requests fail when sent. *)
let auth_from_environment () =
  match (getenv "MACRO_API_KEY", getenv "MACRO_BOT_TOKEN") with
  | Some _, Some _ ->
      invalid_arg
        "both MACRO_API_KEY and MACRO_BOT_TOKEN are set; pass ~auth to pick one"
  | None, Some token -> Auth.bot token
  | Some key, None -> Auth.user_token key
  | None, None -> Auth.User_token no_credential

let create ?env ?(hosts = []) ?auth ?requested_as () =
  let env =
    match (env, getenv "MACRO_ENV") with
    | Some env, _ -> env
    | None, Some name -> env_of_string name
    | None, _ -> Prod
  in
  let auth =
    match auth with Some auth -> auth | None -> auth_from_environment ()
  in
  (match (requested_as, auth) with
  | Some _, (Auth.User_token _ | Auth.User_api_key _) ->
      invalid_arg
        "requested_as requires bot auth: a user token always acts as its own \
         user"
  | _ -> ());
  { env; hosts; auth; requested_as }

let host config service =
  match List.assoc_opt service config.hosts with
  | Some host -> host
  | None -> (
      match default_host config.env service with
      | Some host -> host
      | None -> invalid_arg (Printf.sprintf "no host for service %S" service))
