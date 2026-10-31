import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizedHash } from './adversarial-evaluation.mjs';

test('hybrid skips a trusted FAQ and reviews payment, while AI-only always scores raw decisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'basqar-hybrid-runner-'));
  const source = path.join(directory, 'fixtures.jsonl'), manifest = path.join(directory, 'manifest.json');
  const rows = [
    { id: 'faq', ticket: { kind: 'report', messages: [{ role: 'player', text: 'Что такое ДМ?' }] }, expected: { category: 'report.question', priority: 'p2', lang: 'ru', needs_human: false }, challenge_tags: ['faq'] },
    { id: 'payment', ticket: { kind: 'report', messages: [{ role: 'player', text: 'Оплатил донат, деньги не пришли' }] }, expected: { category: 'report.payment', priority: 'p0', lang: 'ru', needs_human: true }, challenge_tags: ['payment'] },
  ];
  const raw = rows.map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(source, raw);
  fs.writeFileSync(manifest, JSON.stringify({ datasetSha256Lf: normalizedHash(raw), total: rows.length, ids: rows.map(row => row.id) }));
  for (const mode of ['hybrid', 'ai']) {
    const output = path.join(directory, `${mode}.local.json`), ledger = path.join(directory, `${mode}-ledger.local.json`);
    fs.writeFileSync(ledger, JSON.stringify({ reservedUsd: 0, measuredUsd: 0, calls: 0, unknownCostCalls: 0 }));
    const script = fileURLToPath(new URL('./evaluate-adversarial.mjs', import.meta.url));
    const args = ['--mode', mode, '--in', source, '--out', output, '--manifest', manifest, '--ledger', ledger, '--budget-usd', '2'];
    const code = `import assert from 'node:assert/strict';
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(init.body), input = JSON.parse(request.input[1].content);
        assert.equal(input.language_hint, 'und');
        assert.equal('expected' in input, false); assert.equal('category' in input, false);
        return Response.json({ status: 'completed', service_tier: 'default', model: 'gpt-6-luna',
          usage: { input_tokens: 500, output_tokens: 80, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ lang: 'ru', category: 'report.payment', priority: 'p0', draft: 'Укажите дату и номер операции. Платёж проверит поддержка.', citation_ids: [], needs_human: true, reason: 'Проверка платежа.' }) }] }] });
      };
      process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key-123456789';
      process.argv = [process.execPath, ${JSON.stringify(script)}, ...${JSON.stringify(args)}];
      await import(${JSON.stringify(new URL('./evaluate-adversarial.mjs', import.meta.url).href)});`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.state, 'completed');
    if (mode === 'hybrid') {
      assert.equal(report.results[0].gate.review, false); assert.equal(report.results[0].providerCalls, 0);
      assert.equal(report.results[1].gate.review, true); assert.equal(report.results[1].providerCalls, 1);
      assert.equal(report.results[1].finalResult.meta.mode, 'rules+ai');
      assert.equal(report.results[1].finalSupportResult.processing.route, 'help');
      assert.equal(report.metrics.modelOutcomes.skippedByPolicy, 1);
    } else {
      assert.ok(report.results.every(row => row.localResult === null && row.gate === null && row.finalResult === null));
      assert.equal(report.results[0].prediction.category, 'report.payment');
      assert.equal(report.metrics.costs.providerCalls, 2);
    }
    assert.equal(fs.existsSync(ledger + '.lock'), false);
  }
});
