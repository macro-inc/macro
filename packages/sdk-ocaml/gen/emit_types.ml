(* IR definitions -> type declarations, JSON codecs and [make_] functions. *)
open Ppxlib
open Syntax
open Ir

let decoder_name name = name ^ "_of_yojson"
let encoder_name name = "yojson_of_" ^ name
let make_name name = "make_" ^ name

let rec core_type = function
  | Prim String -> [%type: string]
  | Prim Int -> [%type: int]
  | Prim Int64 -> [%type: int64]
  | Prim Float -> [%type: float]
  | Prim Bool -> [%type: bool]
  | Named n -> tconstr n
  | List t -> [%type: [%t core_type t] list]
  | Map t -> [%type: (string * [%t core_type t]) list]
  | Option t -> [%type: [%t core_type t] option]
  | Json -> [%type: Yojson.Safe.t]

let field_type field =
  if field_is_option field then Option field.ty else field.ty

let rec decoder = function
  | Prim String -> [%expr Json.string]
  | Prim Int -> [%expr Json.int]
  | Prim Int64 -> [%expr Json.int64]
  | Prim Float -> [%expr Json.float]
  | Prim Bool -> [%expr Json.bool]
  | Named n -> evar (decoder_name n)
  | List t -> [%expr Json.list [%e decoder t]]
  | Map t -> [%expr Json.map [%e decoder t]]
  | Option t -> [%expr Json.option [%e decoder t]]
  | Json -> [%expr Json.json]

(* [qualify] names the module that defines the types, for code outside it. *)
let rec encoder ?(qualify = Fun.id) = function
  | Prim String -> [%expr Json.of_string]
  | Prim Int -> [%expr Json.of_int]
  | Prim Int64 -> [%expr Json.of_int64]
  | Prim Float -> [%expr Json.of_float]
  | Prim Bool -> [%expr Json.of_bool]
  | Named n -> evar (qualify (encoder_name n))
  | List t -> [%expr Json.of_list [%e encoder ~qualify t]]
  | Map t -> [%expr Json.of_map [%e encoder ~qualify t]]
  | Option t -> [%expr Json.of_option [%e encoder ~qualify t]]
  | Json -> [%expr Json.of_json]

(* ---------- type declarations ---------- *)

let label_declarations fields =
  List.map
    (fun field ->
      let declaration =
        B.label_declaration ~name:(name field.ml_name) ~mutable_:Immutable
          ~type_:(core_type (field_type field))
      in
      { declaration with pld_attributes = doc_attributes field.doc })
    fields

let constructor ?(doc = None) ctor_name args =
  let declaration =
    B.constructor_declaration ~name:(name ctor_name) ~args ~res:None
  in
  { declaration with pcd_attributes = doc_attributes doc }

let unknown_string =
  constructor ~doc:(Some "A value this SDK version does not know.") "Unknown"
    (Pcstr_tuple [ [%type: string] ])

let unknown_json =
  constructor ~doc:(Some "A case this SDK version does not know, as received.")
    "Unknown"
    (Pcstr_tuple [ [%type: Yojson.Safe.t] ])

let type_declaration def =
  let kind, manifest =
    match def.kind with
    | Record fields -> (Ptype_record (label_declarations fields), None)
    | Enum values ->
        ( Ptype_variant
            (List.map (fun (_, c) -> constructor c (Pcstr_tuple [])) values
            @ [ unknown_string ]),
          None )
    | Tagged { cases; _ } ->
        let case c =
          let args =
            match c.payload with
            | No_payload -> Pcstr_tuple []
            | Fields fields -> Pcstr_record (label_declarations fields)
            | Same_object ty -> Pcstr_tuple [ core_type ty ]
          in
          constructor ~doc:c.case_doc c.case_name args
        in
        (Ptype_variant (List.map case cases @ [ unknown_json ]), None)
    | External cases ->
        let case c =
          let args =
            match c.value with
            | None -> Pcstr_tuple []
            | Some ty -> Pcstr_tuple [ core_type ty ]
          in
          constructor ~doc:c.ext_doc c.ext_name args
        in
        (Ptype_variant (List.map case cases @ [ unknown_json ]), None)
    | Untagged cases ->
        let case c =
          constructor ~doc:c.untagged_doc c.untagged_name
            (Pcstr_tuple [ core_type c.member ])
        in
        (Ptype_variant (List.map case cases @ [ unknown_json ]), None)
    | Alias ty -> (Ptype_abstract, Some (core_type ty))
  in
  let declaration =
    B.type_declaration ~name:(name def.name) ~params:[] ~cstrs:[] ~kind
      ~private_:Public ~manifest
  in
  { declaration with ptype_attributes = doc_attributes def.doc }

(* ---------- codecs ---------- *)

(* Every enum and union decodes what it does not know to [Unknown]; as a
   member of an untagged union that would accept every value, so members
   there decode strictly. *)
let rec is_open defs = function
  | Named n -> (
      match List.find_opt (fun d -> d.name = n) defs with
      | Some { kind = Enum _ | Tagged _ | External _ | Untagged _; _ } -> true
      | Some { kind = Alias ty; _ } -> is_open defs ty
      | _ -> false)
  | _ -> false

let field_decoder ~obj ~whole field =
  if field.flatten then [%expr [%e decoder field.ty] [%e whole]]
  else if field_is_option field then
    [%expr
      Json.optional [%e obj] [%e estring field.json_name] [%e decoder field.ty]]
  else
    [%expr
      Json.required [%e obj] [%e estring field.json_name] [%e decoder field.ty]]

let record_value fields ~obj ~whole =
  B.pexp_record
    (List.map (fun f -> (lid f.ml_name, field_decoder ~obj ~whole f)) fields)
    None

(* Encode a record's fields, plus any leading [extra] (a union's tag).
   Required fields are always written (a nullable one as null); optional
   ones only when set. Flattened fields merge their own object in. *)
let record_json ?(extra = []) fields ~get =
  let plain, flat = List.partition (fun f -> not f.flatten) fields in
  let entry f =
    let value = get f.ml_name in
    let encoded =
      if not f.required then [%expr Option.map [%e encoder f.ty] [%e value]]
      else [%expr Some ([%e encoder (field_type f)] [%e value])]
    in
    B.pexp_tuple [ estring f.json_name; encoded ]
  in
  let record =
    [%expr Json.record [%e B.elist (extra @ List.map entry plain)]]
  in
  match flat with
  | [] -> record
  | _ ->
      [%expr
        Json.merge
          [%e
            B.elist
              (record
              :: List.map
                   (fun f -> [%expr [%e encoder f.ty] [%e get f.ml_name]])
                   flat)]]

let decoder_body defs def =
  match def.kind with
  | Record fields ->
      [%expr
        let fields = Json.obj json in
        [%e record_value fields ~obj:[%expr fields] ~whole:[%expr json]]]
  | Enum values ->
      B.pexp_match [%expr Json.string json]
        (List.map (fun (value, c) -> case (pstring value) (ctor c)) values
        @ [
            case
              [%pat? other]
              [%expr Json.unknown [%e estring def.name] json (Unknown other)];
          ])
  | Tagged { tag; cases } ->
      let branch c =
        let arg =
          match c.payload with
          | No_payload -> None
          | Fields fields ->
              Some (record_value fields ~obj:[%expr fields] ~whole:[%expr json])
          | Same_object ty -> Some [%expr [%e decoder ty] json]
        in
        case (pstring c.tag_value) (ctor ?arg c.case_name)
      in
      [%expr
        let fields = Json.obj json in
        [%e
          B.pexp_match
            [%expr Json.tag fields [%e estring tag]]
            (List.map branch cases
            @ [
                case
                  [%pat? _]
                  [%expr Json.unknown [%e estring def.name] json (Unknown json)];
              ])]]
  | External cases ->
      let branch c =
        match c.value with
        | None ->
            case
              (pctor ~arg:(B.ppat_tuple [ pstring c.key; [%pat? None] ]) "Some")
              (ctor c.ext_name)
        | Some ty ->
            case
              (pctor
                 ~arg:(B.ppat_tuple [ pstring c.key; [%pat? Some value] ])
                 "Some")
              (ctor ~arg:[%expr [%e decoder ty] value] c.ext_name)
      in
      B.pexp_match [%expr Json.external_case json]
        (List.map branch cases
        @ [
            case
              [%pat? _]
              [%expr Json.unknown [%e estring def.name] json (Unknown json)];
          ])
  | Untagged cases ->
      let attempt c =
        let decode = [%expr [%e decoder c.member] json] in
        let decode =
          if is_open defs c.member then
            [%expr
              match [%e decode] with
              | Unknown _ -> Json.fail "unknown value"
              | known -> known]
          else decode
        in
        [%expr fun json -> [%e ctor ~arg:decode c.untagged_name]]
      in
      [%expr
        match Json.first_ok [%e B.elist (List.map attempt cases)] json with
        | Some value -> value
        | None -> Json.unknown [%e estring def.name] json (Unknown json)]
  | Alias ty -> [%expr [%e decoder ty] json]

let encoder_body def =
  match def.kind with
  | Record fields ->
      record_json fields ~get:(fun f -> B.pexp_field [%expr value] (lid f))
  | Enum values ->
      B.pexp_match [%expr value]
        (List.map
           (fun (v, c) -> case (pctor c) [%expr `String [%e estring v]])
           values
        @ [ case [%pat? Unknown other] [%expr `String other] ])
  | Tagged { tag; cases } ->
      let tag_entry c =
        B.pexp_tuple
          [ estring tag; [%expr Some (`String [%e estring c.tag_value])] ]
      in
      let branch c =
        match c.payload with
        | No_payload ->
            case (pctor c.case_name)
              [%expr Json.record [%e B.elist [ tag_entry c ]]]
        | Fields fields ->
            case
              (pctor ~arg:[%pat? case] c.case_name)
              (record_json
                 ~extra:[ tag_entry c ]
                 fields
                 ~get:(fun f -> B.pexp_field [%expr case] (lid f)))
        | Same_object ty ->
            case
              (pctor ~arg:[%pat? inner] c.case_name)
              [%expr
                Json.with_tag [%e estring tag] [%e estring c.tag_value]
                  ([%e encoder ty] inner)]
      in
      B.pexp_match [%expr value]
        (List.map branch cases @ [ case [%pat? Unknown json] [%expr json] ])
  | External cases ->
      let branch c =
        match c.value with
        | None -> case (pctor c.ext_name) [%expr `String [%e estring c.key]]
        | Some ty ->
            case
              (pctor ~arg:[%pat? inner] c.ext_name)
              [%expr
                Json.external_value [%e estring c.key] ([%e encoder ty] inner)]
      in
      B.pexp_match [%expr value]
        (List.map branch cases @ [ case [%pat? Unknown json] [%expr json] ])
  | Untagged cases ->
      B.pexp_match [%expr value]
        (List.map
           (fun c ->
             case
               (pctor ~arg:[%pat? inner] c.untagged_name)
               [%expr [%e encoder c.member] inner])
           cases
        @ [ case [%pat? Unknown json] [%expr json] ])
  | Alias ty -> [%expr [%e encoder ty] value]

let codec_bindings defs def =
  let t = tconstr def.name in
  let decode =
    B.value_binding
      ~pat:
        (B.ppat_constraint
           (pvar (decoder_name def.name))
           [%type: Yojson.Safe.t -> [%t t]])
      ~expr:[%expr fun json -> [%e decoder_body defs def]]
  in
  let encode =
    B.value_binding
      ~pat:
        (B.ppat_constraint
           (pvar (encoder_name def.name))
           [%type: [%t t] -> Yojson.Safe.t])
      ~expr:[%expr fun value -> [%e encoder_body def]]
  in
  (decode, encode)

(* ---------- make functions ---------- *)

(* [make_x ~required ?optional ()] so callers spell out only what they set. *)
let make_parameters fields body =
  let parameter f acc =
    if field_is_option f && not f.flatten then
      fun_ (Optional f.ml_name) (pvar f.ml_name) acc
    else
      fun_ (Labelled f.ml_name)
        (B.ppat_constraint (pvar f.ml_name) (core_type f.ty))
        acc
  in
  List.fold_right parameter fields [%expr fun () -> [%e body]]

let make_signature fields result =
  let parameter f acc =
    if field_is_option f && not f.flatten then
      B.ptyp_arrow (Optional f.ml_name) (core_type f.ty) acc
    else B.ptyp_arrow (Labelled f.ml_name) (core_type f.ty) acc
  in
  List.fold_right parameter fields [%type: unit -> [%t result]]

let record_of_names fields =
  B.pexp_record
    (List.map (fun f -> (lid f.ml_name, evar f.ml_name)) fields)
    None

(* make functions: one per record, and one per inline-record case. *)
let makes def =
  match def.kind with
  | Record fields ->
      [
        ( make_name def.name,
          def.doc,
          make_parameters fields
            (B.pexp_constraint (record_of_names fields) (tconstr def.name)),
          make_signature fields (tconstr def.name) );
      ]
  | Tagged { cases; _ } ->
      List.filter_map
        (fun c ->
          match c.payload with
          | Fields fields ->
              Some
                ( make_name (def.name ^ "_" ^ String.lowercase_ascii c.case_name),
                  c.case_doc,
                  make_parameters fields
                    (B.pexp_constraint
                       (ctor ~arg:(record_of_names fields) c.case_name)
                       (tconstr def.name)),
                  make_signature fields (tconstr def.name) )
          | _ -> None)
        cases
  | _ -> []

(* ---------- strongly connected components (Tarjan) ---------- *)

let references def =
  let found = ref [] in
  let rec visit = function
    | Named n -> found := n :: !found
    | List t | Map t | Option t -> visit t
    | Prim _ | Json -> ()
  in
  let fields = List.iter (fun f -> visit f.ty) in
  (match def.kind with
  | Record fs -> fields fs
  | Tagged { cases; _ } ->
      List.iter
        (fun c ->
          match c.payload with
          | Fields fs -> fields fs
          | Same_object t -> visit t
          | No_payload -> ())
        cases
  | External cases -> List.iter (fun c -> Option.iter visit c.value) cases
  | Untagged cases -> List.iter (fun c -> visit c.member) cases
  | Alias t -> visit t
  | Enum _ -> ());
  !found

(* Definitions grouped so each group only refers to itself and earlier groups. *)
let groups defs =
  let by_name = Hashtbl.create 256 in
  List.iter (fun d -> Hashtbl.replace by_name d.name d) defs;
  let index = Hashtbl.create 256
  and low = Hashtbl.create 256
  and on_stack = Hashtbl.create 256 in
  let stack = ref [] and counter = ref 0 and result = ref [] in
  let rec visit v =
    Hashtbl.replace index v !counter;
    Hashtbl.replace low v !counter;
    incr counter;
    stack := v :: !stack;
    Hashtbl.replace on_stack v ();
    List.iter
      (fun w ->
        if not (Hashtbl.mem by_name w) then
          failwith ("reference to undefined type " ^ w)
        else if not (Hashtbl.mem index w) then begin
          visit w;
          Hashtbl.replace low v (min (Hashtbl.find low v) (Hashtbl.find low w))
        end
        else if Hashtbl.mem on_stack w then
          Hashtbl.replace low v
            (min (Hashtbl.find low v) (Hashtbl.find index w)))
      (List.rev (references (Hashtbl.find by_name v)));
    if Hashtbl.find low v = Hashtbl.find index v then begin
      let rec pop group =
        match !stack with
        | w :: rest ->
            stack := rest;
            Hashtbl.remove on_stack w;
            if w = v then w :: group else pop (w :: group)
        | [] -> group
      in
      result := List.map (Hashtbl.find by_name) (pop []) :: !result
    end
  in
  List.iter (fun d -> if not (Hashtbl.mem index d.name) then visit d.name) defs;
  List.rev !result

let is_recursive = function
  | [ def ] -> List.mem def.name (references def)
  | _ -> true

(* ---------- structure and signature ---------- *)

let structure defs =
  List.concat_map
    (fun group ->
      let flag = if is_recursive group then Recursive else Nonrecursive in
      let codecs = List.map (codec_bindings defs) group in
      let make_items =
        List.concat_map
          (fun def ->
            List.map
              (fun (fn, _, expr, _) ->
                B.pstr_value Nonrecursive
                  [ B.value_binding ~pat:(pvar fn) ~expr ])
              (makes def))
          group
      in
      [
        B.pstr_type flag (List.map type_declaration group);
        B.pstr_value flag (List.concat_map (fun (d, e) -> [ d; e ]) codecs);
      ]
      @ make_items)
    (groups defs)

let value_description ?doc fn ty =
  let description = B.value_description ~name:(name fn) ~type_:ty ~prim:[] in
  B.psig_value { description with pval_attributes = doc_attributes doc }

let signature defs =
  List.concat_map
    (fun group ->
      let flag = if is_recursive group then Recursive else Nonrecursive in
      let vals =
        List.concat_map
          (fun def ->
            let t = tconstr def.name in
            [
              value_description (decoder_name def.name)
                [%type: Yojson.Safe.t -> [%t t]];
              value_description (encoder_name def.name)
                [%type: [%t t] -> Yojson.Safe.t];
            ]
            @ List.map
                (fun (fn, doc, _, ty) -> value_description ?doc fn ty)
                (makes def))
          group
      in
      B.psig_type flag (List.map type_declaration group) :: vals)
    (groups defs)

(* Every value name a definition adds, to check for clashes. *)
let value_names def =
  [ decoder_name def.name; encoder_name def.name ]
  @ List.map (fun (fn, _, _, _) -> fn) (makes def)
