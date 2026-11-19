(** The contract between a code-mode OCaml program and code mode's trusted
    bootstrap: the OCaml counterpart of a JavaScript program's
    [export async function main({ macro, session, execution })].

    {[
      let () =
        Code_mode.run @@ fun { macro; session_id; _ } ->
        let reply = Macro_sdk_fetch.call_exn macro (Macro_sdk.Contacts.get_contacts ()) in
        `Assoc
          [
            ("contacts", `Int (List.length reply.contacts));
            ("session", match session_id with Some id -> `String id | None -> `Null);
          ]
    ]}

    A program calls {!run} once, at top level. It is compiled to WebAssembly
    with [--effects=jspi] and linked against the prebuilt bundle
    ([CODE_MODE_OCAML_DIR]); see the package README.

    {b The bootstrap's side.} Before the program's loader runs, the
    bootstrap sets [globalThis.__macroCodeMode] to an object with:
    - [context]: a JSON string,
      [{"token", "hosts", "webAppUrl", "sessionId", "executionId"}], the
      fields of the JavaScript bootstrap's context of the same names
      ([token] and [hosts] required; the others may be absent or [null]);
    - [finish(frame)]: called once with the final frame as a JSON string,
      [{"type":"result","value":...}] or [{"type":"error","message":...}],
      the frames JavaScript programs end with. The bootstrap applies its
      result size limit to [value] and emits it.

    The program's HTTP goes through [globalThis.fetch] ({!Macro_sdk_fetch}),
    so the bootstrap's fetch wrapper (headers, dry-run gate) applies. *)

type ctx = {
  macro : Macro_sdk_fetch.t;
      (** A client with the run's token and every service host. *)
  session_id : string option;  (** The agent session running the program. *)
  execution_id : string option;  (** This execution, within the session. *)
  web_app_url : string option;  (** The web app's origin, for links. *)
}

val run : (ctx -> Yojson.Safe.t) -> unit
(** [run main] reads the context, calls [main] and hands the bootstrap the
    final frame: [result] with the value [main] returns, or [error] with the
    message of the exception it raised (or of an unreadable context, or a
    value with no JSON form, such as [nan]). Never raises. Without a
    bootstrap (no [globalThis.__macroCodeMode]) it prints why to stderr and
    exits with status 2. *)
