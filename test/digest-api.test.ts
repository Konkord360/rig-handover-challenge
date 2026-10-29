import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/types.js';

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-api-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function app() {
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
}

describe('digest JSON', () => {
  it('returns the reader digest in job order, including malformed-line counts', async () => {
    writeFileSync(join(runsDir, 'night.jsonl'), [
      '{"at":"2026-10-29T01:00:00+01:00","job":"z","status":"retry","owner":"owner","error":"failed"}',
      'not JSON',
      '{"at":"2026-10-29T02:00:00+01:00","job":"a","status":"ok","owner":null}',
      '{"at":"2026-10-29T03:00:00+01:00","job":"z","status":"fail","owner":"owner"}',
    ].join('\n'));

    const res = await app().request('/api/digest/night');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const digest = await res.json();
    expect(digest).toEqual(readNight(runsDir, 'night'));
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['a', 'z']);
    expect(digest.rows[0]).toMatchObject({ owner: null, firstTime: '2026-10-29T02:00:00+01:00' });
    expect(digest.rows[1]).toMatchObject({ runs: 2, retries: 1, lastStatus: 'fail', lastError: 'failed' });
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
  });

  it('returns an empty digest for an empty night', async () => {
    writeFileSync(join(runsDir, 'empty.jsonl'), '');
    const res = await app().request('/api/digest/empty');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('returns JSON 404 for a missing night', async () => {
    const res = await app().request('/api/digest/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'night not found' });
  });
});
