import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function app() {
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
}

function writeNight(night: string, lines: string[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
}

function event(at: string, job: string, status: 'ok' | 'retry' | 'fail', owner: string | null, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

// Match body rows only, leaving header markup and presentation outside the contract.
function tableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => /<td\b/i.test(row));
}

function cellTexts(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
}

function retryColumn(html: string): number {
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
  return headers.findIndex((header) => /^retr(?:y|ies)$/i.test(header));
}

function isMarked(row: string): boolean {
  return /class=["'][^"']*\bwarn\b[^"']*["']/i.test(row);
}

describe('digest routes', () => {
  it('renders the same ordered jobs and values as JSON, marking failures and three or more retries', async () => {
    writeNight('night', [
      event('2026-10-29T02:00:00+02:00', 'z-fail', 'fail', 'zoe', 'disk full'),
      event('2026-10-29T01:00:00+01:00', 'b-retries', 'retry', 'bea', 'timeout'),
      event('2026-10-29T01:01:00+01:00', 'b-retries', 'retry', 'bea'),
      event('2026-10-29T01:02:00+01:00', 'b-retries', 'retry', 'bea'),
      event('2026-10-29T01:03:00+01:00', 'b-retries', 'ok', 'bea'),
      event('2026-10-29T01:00:00-03:00', 'a-empty', 'ok', null),
      event('2026-10-29T01:00:00Z', 'c-two', 'retry', 'cy'),
      event('2026-10-29T01:01:00Z', 'c-two', 'retry', 'cy'),
      event('2026-10-29T01:02:00Z', 'c-two', 'ok', 'cy'),
    ]);

    const instance = app();
    const page = await instance.request('/digest/night');
    const json = await instance.request('/api/digest/night');
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(json.headers.get('content-type')).toContain('application/json');

    const html = await page.text();
    const digest = await json.json() as NightDigest;
    const rows = tableRows(html);
    const retryIndex = retryColumn(html);
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(digest.rows.map((row) => row.job)).toEqual(['a-empty', 'b-retries', 'c-two', 'z-fail']);
    expect(rows.map((row) => cellTexts(row)[0])).toEqual(digest.rows.map((row) => row.job));
    expect(digest.rows[0]).toEqual({
      job: 'a-empty', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
      firstTime: '2026-10-29T01:00:00-03:00', lastTime: '2026-10-29T01:00:00-03:00',
    });
    expect(digest.rows[1]).toEqual({
      job: 'b-retries', owner: 'bea', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'timeout',
      firstTime: '2026-10-29T01:00:00+01:00', lastTime: '2026-10-29T01:03:00+01:00',
    });
    expect(digest.rows[3]).toEqual({
      job: 'z-fail', owner: 'zoe', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full',
      firstTime: '2026-10-29T02:00:00+02:00', lastTime: '2026-10-29T02:00:00+02:00',
    });
    for (const [index, digestRow] of digest.rows.entries()) {
      const cells = cellTexts(rows[index]);
      for (const value of [digestRow.owner ?? '—', String(digestRow.runs),
        digestRow.lastStatus, digestRow.lastError ?? '—', digestRow.firstTime, digestRow.lastTime]) {
        expect(cells).toContain(value);
      }
      const retries = String(digestRow.retries);
      expect(digestRow.retries >= 3 ? [retries, `${retries} · high retries`] : [retries]).toContain(cells[retryIndex]);
      expect(cells).not.toContain('');
    }
    expect(cellTexts(rows[0]).filter((text) => text === '—')).toHaveLength(2);
    expect(cellTexts(rows[0])).toContain('2026-10-29T01:00:00-03:00');
    expect(cellTexts(rows[1])).toContain('2026-10-29T01:00:00+01:00');
    expect(cellTexts(rows[1])).toContain('2026-10-29T01:03:00+01:00');
    expect(cellTexts(rows[3])).toContain('disk full');
    expect(rows.map(isMarked)).toEqual([false, true, false, true]);
    expect(html).not.toMatch(/<script\b/i);
    expect(digest.badLines).toBe(0);
    expect(digest.counts).toEqual({ ok: 3, retry: 5, fail: 1 });
  });

  it('returns 404 for a missing night on both routes', async () => {
    const instance = app();
    expect((await instance.request('/digest/missing')).status).toBe(404);
    expect((await instance.request('/api/digest/missing')).status).toBe(404);
  });

  it('returns an empty digest rather than 404 for an empty file', async () => {
    writeNight('empty', []);
    const instance = app();
    const page = await instance.request('/digest/empty');
    const json = await instance.request('/api/digest/empty');
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    expect(html.toLowerCase()).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
    expect(await json.json()).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('keeps valid jobs when a line is malformed and counts the bad line', async () => {
    writeNight('bad', [
      event('2026-10-29T01:00:00+01:00', 'z-valid', 'ok', 'zoe'),
      '{broken',
      event('2026-10-29T01:00:00+01:00', 'a-valid', 'fail', null, 'failed'),
    ]);
    const instance = app();
    const page = await instance.request('/digest/bad');
    const json = await instance.request('/api/digest/bad');
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    const digest = await json.json() as NightDigest;
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
    expect(digest.rows.map((row) => row.job)).toEqual(['a-valid', 'z-valid']);
    expect(tableRows(html).map((row) => cellTexts(row)[0])).toEqual(digest.rows.map((row) => row.job));
  });
});
