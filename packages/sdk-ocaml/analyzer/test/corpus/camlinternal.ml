(* expect: cannot analyze: belongs to CamlinternalLazy @ 2 *)
let x = CamlinternalLazy.force_lazy_block (lazy 1)
