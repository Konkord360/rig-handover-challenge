import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-page-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function app() {
  return createApp({ adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir });
}

describe('digest page', () => {
  it('renders sorted rows, warnings, missing fields, offsets and bad lines', async () => {
    writeFileSync(join(runsDir, 'night.jsonl'), [
      JSON.stringify({ at: '2026-10-29T02:00:00+02:00', job: 'z', status: 'fail', owner: 'Z', error: '<failed>' }),
      ...[1, 2, 3].map((n) => JSON.stringify({
        at: `2026-10-29T0${n}:00:00-01:00`, job: 'a', status: 'retry', owner: null,
      })),
      'not json',
    ].join('\n'));

    const res = await app().request('/digest/night');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<title>rig · digest · night</title>');
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('<span class="warn">3 · high retries</span>');
    expect(html).toContain('<span class="warn">fail</span>');
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('&lt;failed&gt;');
    expect(html).toContain('2026-10-29T01:00:00-01:00');
    expect(html).toContain('2026-10-29T03:00:00-01:00');
    expect(html).toContain('2026-10-29T02:00:00+02:00');
    expect(html.indexOf('<td>a</td>')).toBeLessThan(html.indexOf('<td>z</td>'));
    expect(html).not.toContain('<script');
  });

  it('returns 404 for a missing night', async () => {
    expect((await app().request('/digest/missing')).status).toBe(404);
  });

  it('says nothing ran for an empty night', async () => {
    writeFileSync(join(runsDir, 'empty.jsonl'), '');
    const res = await app().request('/digest/empty');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('reports bad lines even when no valid jobs ran', async () => {
    writeFileSync(join(runsDir, 'bad.jsonl'), 'not json\n');
    const res = await app().request('/digest/bad');
    const html = await res.text();
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 1');
  });
});
