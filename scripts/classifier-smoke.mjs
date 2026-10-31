import { readFileSync } from "node:fs";
import { createClassifier } from "../lib/classifier.ts";
if (!process.argv.includes("--live") || !process.env.OPENAI_API_KEY?.trim()) {
  console.error("Fill OPENAI_API_KEY in .dev.vars, then run with --live. No API calls made.");
  process.exit(1);
}
const classify = createClassifier({ prompt: readFileSync(new URL("../classifier-prompt.md", import.meta.url), "utf8"),
  apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_TRIAGE_MODEL,
  enabled: true });
// Integration examples only, not an independent evaluation of language accuracy.
for (const text of ["Менядмят в зз за прсоа так", "мени жайдан жай теуип атр", "Ishga qanday kirsa bo‘ladi?", "Banimni qayta ko‘rib chiqing, iltimos"]) {
  const run = await classify(text);
  console.log(JSON.stringify({ text, ...run }));
  if (run.source === "fallback") { process.exitCode = 1; break; }
}
