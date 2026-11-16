(* expect: contacts.search_people *)
let request = Macro_sdk.Contacts.(search_people ~query:"ada" ())
