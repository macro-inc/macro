(* JSON Schema -> IR types and definitions. Every schema lands in exactly one
   case below or raises [Spec.Unsupported]. *)
open Ir

type ctx = {
  spec : Spec.t;
  component_types : (string, string) Hashtbl.t;
      (** component -> OCaml type name *)
  types : Naming.namespace;
  lifted : (string, string) Hashtbl.t;
      (** JSON pointer of an inline schema -> type name *)
  mutable defs : def list;  (** newest first *)
  mutable untyped : (string * string) list;
}

let create spec =
  let ctx =
    {
      spec;
      component_types = Hashtbl.create 256;
      types = Naming.namespace ();
      lifted = Hashtbl.create 256;
      defs = [];
      untyped = [];
    }
  in
  List.iter
    (fun (name, _) ->
      Hashtbl.replace ctx.component_types name
        (Naming.fresh ctx.types (Naming.type_name name)))
    spec.components;
  ctx

let component_pointer name = "#/components/schemas/" ^ name
let ( / ) at key = at ^ "/" ^ key

let untyped ctx ~at reason =
  ctx.untyped <- (at, reason) :: ctx.untyped;
  Json

let nullable = function Option _ as ty -> ty | ty -> Option ty

(* Keys that give a schema a shape; a schema with none of them is any JSON. *)
let structural_keys =
  [
    "type";
    "$ref";
    "oneOf";
    "anyOf";
    "allOf";
    "properties";
    "enum";
    "const";
    "items";
    "additionalProperties";
  ]

let description = Spec.string "description"

(* Where a member of a union or allOf really lives, so a schema reached
   through a $ref is lifted once under its own pointer. *)
let target ctx ~at member =
  match Spec.string "$ref" member with
  | Some reference ->
      let name = Spec.ref_name ~at reference in
      (component_pointer name, Spec.resolve ctx.spec ~at member)
  | None -> (at, member)

let rec ty_of ctx ~at ~hint (schema : Spec.json) : ty =
  match schema with
  | `Bool true -> untyped ctx ~at "schema `true` allows any value"
  | `Assoc fields
    when not
           (List.exists (fun key -> List.mem_assoc key fields) structural_keys)
    ->
      untyped ctx ~at "the spec gives no type (serde_json::Value)"
  | `Assoc _ -> ty_of_shaped ctx ~at ~hint schema
  | _ -> Spec.unsupported ~at "schema is not an object"

and ty_of_shaped ctx ~at ~hint schema =
  match Spec.string "$ref" schema with
  | Some reference -> (
      let name = Spec.ref_name ~at reference in
      match Hashtbl.find_opt ctx.component_types name with
      | Some ty -> Named ty
      | None -> Spec.unsupported ~at "dangling reference %s" reference)
  | None -> (
      match Spec.member "type" schema with
      | Some (`List types) -> ty_of_type_list ctx ~at ~hint schema types
      | _ -> (
          match Spec.union_members schema with
          | Some members -> ty_of_union ctx ~at ~hint schema members
          | None -> ty_of_plain ctx ~at ~hint schema))

(* 3.1 nullability: "type": ["string", "null"]. *)
and ty_of_type_list ctx ~at ~hint schema types =
  let non_null = List.filter (( <> ) (`String "null")) types in
  match non_null with
  | [ single ] ->
      let rest = List.remove_assoc "type" (Spec.fields schema) in
      let ty = ty_of_shaped ctx ~at ~hint (`Assoc (("type", single) :: rest)) in
      if List.length non_null < List.length types then nullable ty else ty
  | _ -> Spec.unsupported ~at "a schema with several non-null types"

and ty_of_union ctx ~at ~hint schema members =
  let nulls, others = List.partition Spec.is_null_schema members in
  let ty =
    match others with
    | [] -> Spec.unsupported ~at "a union of only null"
    | [ only ] ->
        let key = if Spec.has "oneOf" schema then "oneOf" else "anyOf" in
        let index = Option.get (List.find_index (fun m -> m == only) members) in
        ty_of ctx ~at:(at / key / string_of_int index) ~hint only
    | _ ->
        let without_null =
          ("oneOf", `List others)
          :: List.filter
               (fun (k, _) -> k <> "oneOf" && k <> "anyOf")
               (Spec.fields schema)
        in
        Named (lift ctx ~at ~hint (`Assoc without_null))
  in
  if nulls = [] then ty else nullable ty

and ty_of_plain ctx ~at ~hint schema =
  match Spec.list "allOf" schema with
  | [ only ] -> ty_of ctx ~at:(at / "allOf" / "0") ~hint only
  | _ :: _ -> Named (lift ctx ~at ~hint schema)
  | [] -> (
      let has_enum = Spec.has "enum" schema || Spec.has "const" schema in
      match Spec.string "type" schema with
      | Some "string" when has_enum -> Named (lift ctx ~at ~hint schema)
      | Some "string" -> Prim String
      | Some "integer" ->
          if Spec.string "format" schema = Some "int64" then Prim Int64
          else Prim Int
      | Some "number" -> Prim Float
      | Some "boolean" -> Prim Bool
      | Some "array" -> (
          match Spec.member "items" schema with
          | Some items ->
              List (ty_of ctx ~at:(at / "items") ~hint:(hint ^ "_item") items)
          | None -> Spec.unsupported ~at "an array without items")
      | (Some "object" | None) when Spec.assoc "properties" schema <> [] ->
          Named (lift ctx ~at ~hint schema)
      | Some "object" | None -> (
          match Spec.member "additionalProperties" schema with
          | Some (`Assoc _ as values) ->
              Map
                (ty_of ctx
                   ~at:(at / "additionalProperties")
                   ~hint:(hint ^ "_value") values)
          | Some (`Bool false) -> untyped ctx ~at "an object with no properties"
          | _ -> untyped ctx ~at "a free-form object")
      | Some other -> Spec.unsupported ~at "type %S" other)

(* Give an inline schema its own definition, once per JSON pointer. *)
and lift ctx ~at ~hint schema =
  match Hashtbl.find_opt ctx.lifted at with
  | Some name -> name
  | None ->
      let name = Naming.fresh ctx.types (Naming.type_name hint) in
      Hashtbl.replace ctx.lifted at name;
      define ctx ~at ~name schema;
      name

and fields_of ctx ~at ~parent ?(skip = []) schema =
  let required = Spec.strings "required" schema in
  let names = Naming.namespace () in
  (match Spec.member "additionalProperties" schema with
  | Some (`Assoc _) | Some (`Bool true) ->
      Spec.unsupported ~at "additionalProperties beside properties"
  | _ -> ());
  Spec.assoc "properties" schema
  |> List.filter (fun (key, _) -> not (List.mem key skip))
  |> List.map (fun (key, property) ->
      let ty =
        ty_of ctx
          ~at:(at / "properties" / key)
          ~hint:(parent ^ "_" ^ key)
          property
      in
      let ty, is_nullable =
        match ty with Option inner -> (inner, true) | ty -> (ty, false)
      in
      {
        json_name = key;
        ml_name = Naming.fresh names (Naming.snake key);
        ty;
        required = List.mem key required;
        nullable = is_nullable;
        flatten = false;
        doc = description property;
      })

(* allOf: the members' fields in one record. A union member becomes a
   flattened field (serde [flatten] of an enum into a struct). *)
and all_of_fields ctx ~at ~parent members =
  let flat_names = Naming.namespace () in
  let rec member_fields_at member_at member =
    let target_at, resolved = target ctx ~at:member_at member in
    let nulls, non_null =
      List.partition Spec.is_null_schema
        (Option.value (Spec.union_members resolved) ~default:[])
    in
    if nulls <> [] && List.length non_null = 1 then
      (* serde flatten of an Option<struct>: its fields, all optional. *)
      let index = List.length nulls in
      List.map
        (fun f -> { f with required = false })
        (member_fields_at
           (target_at / "oneOf" / string_of_int index)
           (List.hd non_null))
    else if Spec.list "allOf" resolved <> [] then
      List.concat
        (List.mapi
           (fun i m ->
             member_fields_at (target_at / "allOf" / string_of_int i) m)
           (Spec.list "allOf" resolved))
    else if Spec.union_members resolved <> None then begin
      let base =
        match Spec.string "$ref" member with
        | Some reference -> Naming.snake (Spec.ref_name ~at reference)
        | None -> "variant"
      in
      match ty_of ctx ~at:member_at ~hint:(parent ^ "_variant") member with
      | Named _ as ty ->
          [
            {
              json_name = "";
              ml_name = Naming.fresh flat_names base;
              ty;
              required = true;
              nullable = false;
              flatten = true;
              doc = description member;
            };
          ]
      | _ ->
          Spec.unsupported ~at:member_at
            "a flattened union must be a named union"
    end
    else if
      Spec.assoc "properties" resolved <> []
      || Spec.string "type" resolved = Some "object"
    then fields_of ctx ~at:target_at ~parent resolved
    else
      Spec.unsupported ~at:member_at
        "an allOf member that is neither an object nor a union"
  in
  let all =
    List.concat
      (List.mapi
         (fun i m -> member_fields_at (at / "allOf" / string_of_int i) m)
         members)
  in
  (* A property listed by several members appears once; it is required if
     any member requires it. Field names stay unique across members. *)
  let names = Naming.namespace () in
  let seen = Hashtbl.create 16 in
  List.filter_map
    (fun field ->
      if field.flatten then
        Some { field with ml_name = Naming.fresh names field.ml_name }
      else
        match Hashtbl.find_opt seen field.json_name with
        | Some _ -> None
        | None ->
            let required =
              List.exists
                (fun f -> f.json_name = field.json_name && f.required)
                all
            in
            Hashtbl.add seen field.json_name ();
            Some
              {
                field with
                required;
                ml_name = Naming.fresh names field.ml_name;
              })
    all

and define ctx ~at ~name schema =
  let kind =
    match Spec.union_members schema with
    | Some members -> union_kind ctx ~at ~name schema members
    | None when List.length (Spec.list "allOf" schema) > 1 ->
        Record (all_of_fields ctx ~at ~parent:name (Spec.list "allOf" schema))
    | None
      when Spec.string "type" schema = Some "string"
           && (Spec.has "enum" schema || Spec.has "const" schema) ->
        enum_kind ~at [ schema ]
    | None when Spec.assoc "properties" schema <> [] ->
        Record (fields_of ctx ~at ~parent:name schema)
    | None -> Alias (ty_of ctx ~at ~hint:name schema)
  in
  ctx.defs <- { name; kind; doc = description schema } :: ctx.defs

and enum_kind ~at schemas =
  let names = Naming.namespace () in
  let values =
    List.concat_map
      (fun schema ->
        match Spec.member "const" schema with
        | Some (`String value) -> [ value ]
        | Some _ -> Spec.unsupported ~at "a non-string const"
        | None ->
            List.map
              (function
                | `String value -> value
                | _ -> Spec.unsupported ~at "a non-string enum value")
              (Spec.list "enum" schema))
      schemas
  in
  Enum
    (List.map
       (fun value -> (value, Naming.fresh names (Naming.constructor value)))
       values)

and union_kind ctx ~at ~name schema members =
  let nulls, members = List.partition Spec.is_null_schema members in
  if nulls <> [] then
    (* A nullable union of several members: the union gets its own name. *)
    Alias
      (nullable
         (Named
            (lift ctx ~at:(at / "nonNull") ~hint:(name ^ "_value")
               (`Assoc [ ("oneOf", `List members) ]))))
  else
    match Spec.member "discriminator" schema with
    | Some discriminator -> discriminated ctx ~at ~name discriminator members
    | None -> (
        match tag_key ctx ~at members with
        | Some tag -> tagged ctx ~at ~name tag members
        | None -> (
            let resolved = List.map (Spec.resolve ctx.spec ~at) members in
            let is_string_enum m =
              Spec.string "type" m = Some "string"
              && (Spec.has "enum" m || Spec.has "const" m)
            in
            if List.for_all is_string_enum resolved then enum_kind ~at resolved
            else
              match external_cases ctx ~at ~name members with
              | Some cases -> External cases
              | None -> untagged ctx ~at ~name members))

(* The parts a union member's properties come from. *)
and member_parts ctx ~at member =
  let resolved = Spec.resolve ctx.spec ~at member in
  match Spec.list "allOf" resolved with
  | [] -> [ resolved ]
  | parts -> List.map (Spec.resolve ctx.spec ~at) parts

(* A property every member requires and pins to a different single string. *)
and tag_key ctx ~at members =
  let tag_value key member =
    List.find_map
      (fun part ->
        match List.assoc_opt key (Spec.assoc "properties" part) with
        | Some property when List.mem key (Spec.strings "required" part) ->
            Spec.single_value property
        | _ -> None)
      (member_parts ctx ~at member)
  in
  let candidates =
    match members with
    | [] -> []
    | first :: _ ->
        List.concat_map
          (fun part -> List.map fst (Spec.assoc "properties" part))
          (member_parts ctx ~at first)
        |> List.sort_uniq compare
  in
  let works key =
    let values = List.map (tag_value key) members in
    List.for_all Option.is_some values
    && List.length (List.sort_uniq compare values) = List.length values
  in
  let preferred =
    List.filter (fun key -> List.mem key candidates) [ "type"; "kind" ]
  in
  List.find_opt works (preferred @ candidates)

and tagged ctx ~at ~name tag members =
  let names = Naming.namespace () in
  let cases =
    List.mapi
      (fun index member ->
        let member_at = at / "oneOf" / string_of_int index in
        let parts = member_parts ctx ~at:member_at member in
        let tag_part =
          List.find
            (fun p -> List.mem_assoc tag (Spec.assoc "properties" p))
            parts
        in
        let tag_value =
          Option.get
            (Spec.single_value
               (List.assoc tag (Spec.assoc "properties" tag_part)))
        in
        let case_hint = name ^ "_" ^ tag_value in
        let resolved = Spec.resolve ctx.spec ~at:member_at member in
        let payload =
          if Spec.has "$ref" member then
            Same_object (ty_of ctx ~at:member_at ~hint:case_hint member)
          else
            match Spec.list "allOf" resolved with
            | [] -> (
                match
                  fields_of ctx ~at:member_at ~parent:case_hint ~skip:[ tag ]
                    resolved
                with
                | [] -> No_payload
                | fields -> Fields fields)
            | all_of -> (
                let tag_only p =
                  Spec.assoc "properties" p
                  |> List.for_all (fun (k, _) -> k = tag)
                in
                let others =
                  List.filteri
                    (fun _ p -> not (tag_only (Spec.resolve ctx.spec ~at p)))
                    all_of
                in
                match others with
                | [ other ] when List.length all_of = 2 ->
                    let other_index =
                      if
                        tag_only (Spec.resolve ctx.spec ~at (List.nth all_of 0))
                      then 1
                      else 0
                    in
                    Same_object
                      (ty_of ctx
                         ~at:(member_at / "allOf" / string_of_int other_index)
                         ~hint:case_hint other)
                | _ ->
                    Fields
                      (List.filter
                         (fun f -> f.json_name <> tag)
                         (all_of_fields ctx ~at:member_at ~parent:case_hint
                            all_of)))
        in
        {
          tag_value;
          case_name = Naming.fresh names (Naming.constructor tag_value);
          payload;
          case_doc = description member;
        })
      members
  in
  Tagged { tag; cases }

and discriminated ctx ~at ~name discriminator members =
  let tag =
    match Spec.string "propertyName" discriminator with
    | Some tag -> tag
    | None -> Spec.unsupported ~at "a discriminator without propertyName"
  in
  let mapping = Spec.assoc "mapping" discriminator in
  let names = Naming.namespace () in
  let cases =
    List.mapi
      (fun index member ->
        let member_at = at / "oneOf" / string_of_int index in
        let reference =
          match Spec.string "$ref" member with
          | Some reference -> reference
          | None ->
              Spec.unsupported ~at:member_at
                "a discriminated member that is not a $ref"
        in
        let tag_value =
          match
            List.find_opt
              (fun (_, target) -> target = `String reference)
              mapping
          with
          | Some (value, _) -> value
          | None -> Spec.ref_name ~at reference
        in
        (* A plain object member becomes an inline record without the tag,
           so callers never write it twice. *)
        let target_at, resolved = target ctx ~at:member_at member in
        let hint = name ^ "_" ^ tag_value in
        let payload =
          if
            Spec.assoc "properties" resolved <> []
            && Spec.list "allOf" resolved = []
            && Spec.union_members resolved = None
          then
            match
              fields_of ctx ~at:target_at ~parent:hint ~skip:[ tag ] resolved
            with
            | [] -> No_payload
            | fields -> Fields fields
          else Same_object (ty_of ctx ~at:member_at ~hint member)
        in
        {
          tag_value;
          case_name = Naming.fresh names (Naming.constructor tag_value);
          payload;
          case_doc = description member;
        })
      members
  in
  Tagged { tag; cases }

(* serde's externally tagged enums: a string per unit variant, a single-key
   object per variant with data. *)
and external_cases ctx ~at ~name members =
  let shape member =
    let resolved = Spec.resolve ctx.spec ~at member in
    let properties = Spec.assoc "properties" resolved in
    if Spec.string "type" resolved = Some "string" && Spec.has "enum" resolved
    then `Units (Spec.strings "enum" resolved)
    else
      match (properties, Spec.strings "required" resolved) with
      | [ (key, value) ], [ required ]
        when key = required
             && Spec.member "additionalProperties" resolved <> Some (`Bool true)
        ->
          `Object (key, value)
      | _ -> `Other
  in
  let shapes = List.map shape members in
  let has_object =
    List.exists (function `Object _ -> true | _ -> false) shapes
  in
  if (not has_object) || List.mem `Other shapes then None
  else
    let names = Naming.namespace () in
    let cases =
      List.concat
        (List.mapi
           (fun index (member, shape) ->
             let member_at = at / "oneOf" / string_of_int index in
             match shape with
             | `Units values ->
                 List.map
                   (fun key ->
                     {
                       key;
                       ext_name = Naming.fresh names (Naming.constructor key);
                       value = None;
                       ext_doc = description member;
                     })
                   values
             | `Object (key, value) ->
                 let value_at =
                   fst (target ctx ~at:member_at member) / "properties" / key
                 in
                 [
                   {
                     key;
                     ext_name = Naming.fresh names (Naming.constructor key);
                     value =
                       Some
                         (ty_of ctx ~at:value_at ~hint:(name ^ "_" ^ key) value);
                     ext_doc =
                       (match description member with
                       | Some d -> Some d
                       | None -> description value);
                   };
                 ]
             | `Other -> [])
           (List.combine members shapes))
    in
    let keys = List.map (fun c -> c.key) cases in
    if List.length (List.sort_uniq compare keys) = List.length keys then
      Some cases
    else None

and untagged ctx ~at ~name members =
  let names = Naming.namespace () in
  let cases =
    List.mapi
      (fun index member ->
        let member_at = at / "oneOf" / string_of_int index in
        let member_ty =
          ty_of ctx ~at:member_at
            ~hint:(Printf.sprintf "%s_%d" name (index + 1))
            member
        in
        let base =
          match (member_ty, Spec.string "$ref" member) with
          | _, Some reference ->
              Naming.constructor (Spec.ref_name ~at reference)
          | Prim String, _ -> "String"
          | Prim Int, _ -> "Int"
          | Prim Int64, _ -> "Int64"
          | Prim Float, _ -> "Float"
          | Prim Bool, _ -> "Bool"
          | List _, _ -> "List"
          | Map _, _ -> "Map"
          | Named n, _ -> Naming.constructor n
          | Option _, _ ->
              Spec.unsupported ~at:member_at
                "a nullable member inside an untagged union"
          | Json, _ -> "Json"
        in
        {
          untagged_name = Naming.fresh names base;
          member = member_ty;
          untagged_doc = description member;
        })
      members
  in
  Untagged cases

(* Define every component, in spec order. *)
let define_components ctx =
  List.iter
    (fun (component, schema) ->
      let at = component_pointer component in
      if not (Hashtbl.mem ctx.lifted at) then begin
        Hashtbl.replace ctx.lifted at
          (Hashtbl.find ctx.component_types component);
        define ctx ~at ~name:(Hashtbl.find ctx.component_types component) schema
      end)
    ctx.spec.components
