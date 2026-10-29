import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
const tempDirs: string[] = [];

function tempRuns(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-status-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    vi.stubEnv('LANE_MARKER', 'TEST-MARKER');
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok: 10 / retry: 4 / fail: 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok: 7 / retry: 0 / fail: 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
  });

  it('counts valid events per night, including retries, and shows empty nights', async () => {
    const runsDir = tempRuns();
    writeFileSync(join(runsDir, '2026-01-02.jsonl'), [
      '{"at":"2026-01-02T01:00:00Z","job":"a","status":"retry","owner":null}',
      '{"at":"2026-01-02T01:01:00Z","job":"a","status":"ok","owner":null}',
      '{"at":"2026-01-02T01:02:00Z","job":"b","status":"fail","owner":null}',
      'not json',
    ].join('\n'));
    writeFileSync(join(runsDir, '2026-01-01.jsonl'), '');
    writeFileSync(join(runsDir, 'ignored.jsonl'), '');

    const res = await createApp({ ...config, runsDir }).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-01-02">2026-01-02</a> · ok: 1 / retry: 1 / fail: 1');
    expect(html).toContain('<a href="/digest/2026-01-01">2026-01-01</a> · ok: 0 / retry: 0 / fail: 0');
    expect(html).not.toContain('ignored');
  });

  it('shows a message when there are no nights', async () => {
    const res = await createApp({ ...config, runsDir: tempRuns() }).request('/');
    expect(await res.text()).toContain('nothing in runs/');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
