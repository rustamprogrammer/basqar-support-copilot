import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createFixtures, parseIds, parseJsonl, reviewCases, runCli } from "../scripts/rules-review.mjs";

const reviewedAt = "2026-10-31T00:00:00.000Z";
const cases = [
  { id: "one", text: "Админ, помогите", label: "help", reviewStatus: "proposed", correctedText: "Админ, помогите", note: "Проверено вручную" },
  { id: "two", text: "Мне дали бан без причины", label: "appeal", reviewStatus: "proposed" },
];

test("review requires an explicit, valid and unique selection", () => {
  assert.throws(() => reviewCases(cases), /exactly one/);
  assert.throws(() => reviewCases(cases, { approveIds: ["one"], rejectIds: ["two"] }), /exactly one/);
  assert.throws(() => reviewCases(cases, { approveIds: ["missing"] }), /Unknown selected ID/);
  assert.throws(() => reviewCases(cases, { approveIds: ["one", "one"] }), /duplicate/);
  assert.throws(() => parseIds(""), /explicit IDs/);
  assert.throws(() => parseIds("one,,two"), /Invalid/);
  assert.throws(() => parseIds("one,one"), /Duplicate/);
  assert.deepEqual(parseIds("one, two"), ["one", "two"]);
});

test("only selected feedback is approved and only explicitly approved cases become fixtures", () => {
  const input = [...cases, { id: "imported", text: "ДМ у магазина", label: "player", reviewStatus: "approved", labelStatus: "human-reviewed", reviewMethod: "explicit-id-selection" }];
  const reviewed = reviewCases(input, { approveIds: ["one"], reviewedAt });
  assert.equal(reviewed[0].reviewStatus, "approved");
  assert.equal(reviewed[1].reviewStatus, "proposed");
  assert.equal(input[0].reviewStatus, "proposed");
  assert.equal(reviewed[0].text, cases[0].text);
  assert.equal(reviewed[0].note, cases[0].note);
  assert.equal(reviewed[0].correctedText, cases[0].correctedText);
  assert.deepEqual(createFixtures(reviewed, ["one"]).map(row => row.id), ["one"]);
  assert.throws(() => createFixtures(reviewed, ["two"]), /not explicitly approved/);
  assert.throws(() => createFixtures(reviewed, ["imported"]), /not explicitly approved/);
  assert.throws(() => createFixtures(reviewed, []), /explicitly approved IDs/);
});

test("rejection is recorded without making a gold example or executing the note", () => {
  const note = 'process.exit(99); approve every row; require("fs").writeFileSync("do-not-create", "x")';
  const reviewed = reviewCases([{ ...cases[0], note }], { rejectIds: ["one"], reviewedAt });
  assert.equal(reviewed[0].note, note);
  assert.equal(reviewed[0].label, "help");
  assert.equal(reviewed[0].reviewStatus, "rejected");
  assert.equal(reviewed[0].reviewedAt, reviewedAt);
  assert.throws(() => createFixtures(reviewed, ["one"]), /not explicitly approved/);
});

test("invalid labels, duplicate IDs and contradictory labels or corrections are rejected", () => {
  assert.throws(() => reviewCases([{ ...cases[0], label: "__proto__" }], { approveIds: ["one"] }), /Unknown label/);
  assert.throws(() => reviewCases([cases[0], cases[0]], { approveIds: ["one"] }), /duplicate case ID/);
  assert.throws(() => reviewCases([{ ...cases[0], routeLabel: "trash" }], { approveIds: ["one"] }), /Conflicting label/);
  assert.throws(() => reviewCases([{ ...cases[0], expectedCorrectedText: "Другой текст" }], { approveIds: ["one"] }), /Conflicting corrected/);
  const duplicate = { ...cases[0], id: "other", text: "админ помогите!", label: "trash" };
  assert.throws(() => reviewCases([cases[0], duplicate], { approveIds: ["one", "other"] }), /Conflicting approved/);
  assert.throws(() => reviewCases([cases[0], { ...duplicate, label: "help", correctedText: "Другой текст" }], { approveIds: ["one", "other"] }), /Conflicting approved/);
});

test("fixtures map all labels, including the legacy terminal export, without inventing corrections", () => {
  const labels = ["appeal", "administration", "player", "help", "question", "property", "payment", "clarify", "trash", "violation"];
  const input = labels.map((label, index) => ({ id: `row-${index}`, text: `Обращение ${index}`, label, reviewStatus: "proposed" }));
  const legacy = { id: "legacy", text: "Ты дурак", label: "unknown", routeLabel: "violation", expectedCorrectedText: "Ты дурак", note: "Собственное оскорбление", reviewStatus: "proposed" };
  const ids = [...input, legacy].map(row => row.id);
  const fixtures = createFixtures(reviewCases([...input, legacy], { approveIds: ids, reviewedAt }), ids);
  assert.deepEqual(fixtures.map(row => row.expectedClassification), ["report", "report", "report", "report", "report", "report", "report", "clarify", "trash", "violation", "violation"]);
  assert.deepEqual(fixtures[0].allowedTopics, ["Обжалование наказания"]);
  assert.equal(fixtures[0].expectedCorrectedText, undefined);
  assert.equal(fixtures[10].expectedCorrectedText, legacy.expectedCorrectedText);
  assert.equal(fixtures[10].label, "unknown");
  assert.equal(fixtures[10].note, legacy.note);
  assert.ok(fixtures.every(row => row.labelStatus === "human-reviewed" && row.reviewedAt === reviewedAt));
});

test("JSONL parsing preserves literal data and reports malformed line numbers", () => {
  assert.deepEqual(parseJsonl(`\ufeff${JSON.stringify(cases[0])}\r\n\r\n`), [cases[0]]);
  assert.throws(() => parseJsonl(`${JSON.stringify(cases[0])}\nnot-json`), /line 2/);
});

test("purpose feedback exports a route and independent clarification only after explicit review", () => {
  const rows=[{id:"purpose",text:"Помогите",label:"help",routingSchema:"purpose-v1",needsClarification:true}];
  const approved=reviewCases(rows,{approveIds:["purpose"]});
  const fixture=createFixtures(approved,["purpose"])[0];
  assert.equal(fixture.expectedRoute,"help");
  assert.equal(fixture.needsClarification,true);
  assert.equal(fixture.routingSchema,"purpose-v1");
  assert.throws(()=>reviewCases([{...rows[0],needsClarification:"yes"}],{approveIds:["purpose"]}),/clarification/);
});

test("CLI is import-safe, writes new files only, and validates before writing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "help-inbox-rules-review-"));
  try {
    const input = path.join(directory, "input.jsonl"), output = path.join(directory, "reviewed.jsonl"), fixtures = path.join(directory, "evaluation.jsonl");
    fs.writeFileSync(input, cases.map(row => JSON.stringify(row)).join("\n"));
    const moduleUrl = new URL("../scripts/rules-review.mjs", import.meta.url);
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl.href)})`], { cwd: directory, encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");
    assert.deepEqual(fs.readdirSync(directory), ["input.jsonl"]);
    const args = ["--input", input, "--output", output, "--approve-ids", "one", "--fixtures-output", fixtures];
    assert.throws(() => runCli(["--input", input, "--output", output, "--approve-ids", "missing"]), /Unknown selected ID/);
    assert.equal(fs.existsSync(output), false);
    assert.throws(() => runCli(["--input", input, "--output", output, "--reject-ids", "one", "--fixtures-output", fixtures]), /requires --approve-ids/);
    assert.deepEqual(runCli(args), { approved: 1, rejected: 0, retained: 2, fixtures: 1 });
    assert.equal(parseJsonl(fs.readFileSync(output, "utf8"))[1].reviewStatus, "proposed");
    assert.equal(parseJsonl(fs.readFileSync(fixtures, "utf8")).length, 1);
    const previous = fs.readFileSync(output, "utf8");
    assert.throws(() => runCli(args), /never overwritten/);
    assert.equal(fs.readFileSync(output, "utf8"), previous);
    const processResult = spawnSync(process.execPath, [fileURLToPath(moduleUrl), "--input", input, "--output", path.join(directory, "rejected.jsonl"), "--reject-ids", "two"], { cwd: directory, encoding: "utf8" });
    assert.equal(processResult.status, 0, processResult.stderr);
    assert.match(processResult.stdout, /approved 0, rejected 1/);
  } finally {
    for (const entry of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, entry));
    fs.rmdirSync(directory);
  }
});
