import { toXml } from "@macro-inc/lexical-core/transformers/xml";

const json = await Bun.stdin.text();
const state = JSON.parse(json);
process.stdout.write(toXml(state) + "\n");
