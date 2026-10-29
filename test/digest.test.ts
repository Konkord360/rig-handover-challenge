import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readNight } from '../src/digest/types.js';

const virtual = vi.hoisted(() => ({ files: new Map<string, string | Error>() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (path: string, encoding: BufferEncoding) => {
      if (!path.startsWith('/virtual-runs/')) return actual.readFileSync(path, encoding);
      const value = virtual.files.get(path);
      if (value instanceof Error) throw value;
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return value;
    },
  };
});

function file(night: string, lines: string): void {
  virtual.files.set(`/virtual-runs/${night}.jsonl`, lines);
}

describe('readNight', () => {
  beforeEach(() => virtual.files.clear());

  it('reads the real night, keeping its bad line and null owner', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest).not.toBeNull();
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
      lastError: null, firstTime: '2026-10-29T05:41:09+01:00', lastTime: '2026-10-29T05:41:09+01:00',
    });
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes a missing file from an empty file and rejects traversal', () => {
    file('empty', '');
    expect(readNight('/virtual-runs', 'missing')).toBeNull();
    expect(readNight('/virtual-runs', '../secret')).toBeNull();
    expect(readNight('/virtual-runs', 'empty')).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON, invalid records, and blank lines without dropping valid rows', () => {
    file('bad', [
      '{', 'null', '[]', '{}',
      '{"at":"2026-10-29T01:00:00","job":"a","status":"ok","owner":null}',
      '{"at":"2026-02-30T01:00:00Z","job":"a","status":"ok","owner":null}',
      '{"at":"2026-10-29T01:00:00Z","job":"a","status":"unknown","owner":null}',
      '{"at":"2026-10-29T01:00:00Z","job":"a","status":"ok"}',
      '{"at":"2026-10-29T01:00:00Z","job":"a","status":"ok","owner":null,"error":42}',
      '',
      '{"at":"2026-10-29T01:00:00Z","job":"a","status":"ok","owner":null}',
      '',
    ].join('\n'));
    const digest = readNight('/virtual-runs', 'bad');
    expect(digest?.badLines).toBe(10);
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('orders events by instant, preserving original offsets and the most recent reported error', () => {
    file('offsets', [
      '{"at":"2026-10-29T02:00:00+02:00","job":"z","status":"ok","owner":"first"}',
      '{"at":"2026-10-28T23:30:00-01:00","job":"z","status":"retry","owner":null,"error":"new"}',
      '{"at":"2026-10-29T00:15:00Z","job":"z","status":"fail","owner":"middle","error":"old"}',
      '{"at":"2026-10-29T01:00:00+01:00","job":"a","status":"ok","owner":"owner"}',
      '{"at":"2026-10-29T01:30:00+01:00","job":"z","status":"ok","owner":"tie"}',
    ].join('\n'));
    const digest = readNight('/virtual-runs', 'offsets');
    expect(digest?.rows.map((row) => row.job)).toEqual(['a', 'z']);
    expect(digest?.rows[1]).toEqual({
      job: 'z', owner: 'tie', runs: 4, retries: 1, lastStatus: 'ok', lastError: 'new',
      firstTime: '2026-10-29T02:00:00+02:00', lastTime: '2026-10-29T01:30:00+01:00',
    });
  });

  it('does not hide filesystem errors other than missing files', () => {
    virtual.files.set('/virtual-runs/denied.jsonl', Object.assign(new Error('denied'), { code: 'EACCES' }));
    expect(() => readNight('/virtual-runs', 'denied')).toThrow('denied');
  });
});
