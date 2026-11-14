exception Call_failed of string * string

let call request body =
  let environment name =
    match Sys.getenv_opt name with Some value -> value | None -> raise (Call_failed ("internal", name ^ " is not set"))
  in
  let meth, path =
    match String.index_opt request ' ' with
    | Some i -> (String.sub request 0 i, String.sub request (i + 1) (String.length request - i - 1))
    | None -> raise (Call_failed ("internal", "bad request " ^ request))
  in
  let url = environment "MACRO_SDK_PROXY_URL" ^ "/api" ^ path in
  let bearer = environment "MACRO_SDK_RUN_TOKEN" in
  let body = match body with `Null -> None | body -> Some (Yojson.Safe.to_string body) in
  match Macro_sdk_http.request ~meth ~url ~bearer ?body () with
  | Error message -> raise (Call_failed ("internal", message))
  | Ok { status; body } -> (
      let reply = try Yojson.Safe.from_string body with Yojson.Json_error _ -> `Null in
      if status >= 200 && status < 300 then reply
      else
        match reply with
        | `Assoc [ ("error", `Assoc error) ] ->
            let field name = match List.assoc_opt name error with Some (`String text) -> text | _ -> "" in
            raise (Call_failed (field "code", field "message"))
        | _ -> raise (Call_failed ("failed", Printf.sprintf "HTTP %d" status)))
