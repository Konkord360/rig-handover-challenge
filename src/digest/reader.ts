import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest } from './types.js';

type Event = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function validTime(at: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(at);
  if (!match || !Number.isFinite(Date.parse(at))) return false;
  const [, y, m, d, h, min, sec] = match;
  const year = Number(y);
  const month = Number(m);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && Number(d) >= 1 && Number(d) <= days[month - 1] &&
    Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59;
}

function parseEvent(line: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.at !== 'string' ||
    !validTime(event.at) ||
    typeof event.job !== 'string' || event.job.length === 0 ||
    (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') ||
    (typeof event.owner !== 'string' && event.owner !== null) ||
    (event.error !== undefined && typeof event.error !== 'string')
  ) return null;
  return {
    at: event.at,
    job: event.job,
    status: event.status,
    owner: event.owner,
    ...(typeof event.error === 'string' ? { error: event.error } : {}),
  };
}

export function readNight(runsDir: string, night: string): NightDigest | null {
  // A route parameter must not escape the runs directory.
  if (!night || night === '.' || night === '..' || /[/\\\0]/.test(night)) return null;

  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const result: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; first: number; last: number; errorAt: number }>();
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const event = parseEvent(line);
    if (!event) {
      result.badLines++;
      continue;
    }
    result.counts[event.status]++;
    const at = Date.parse(event.at);
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        row: {
          job: event.job, owner: event.owner, runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status, lastError: event.error ?? null,
          firstTime: event.at, lastTime: event.at,
        },
        first: at, last: at, errorAt: event.error === undefined ? -Infinity : at,
      });
      continue;
    }
    const { row } = existing;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (at < existing.first) {
      existing.first = at;
      row.firstTime = event.at;
    }
    if (at >= existing.last) {
      existing.last = at;
      row.lastTime = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && at >= existing.errorAt) {
      existing.errorAt = at;
      row.lastError = event.error;
    }
  }
  result.rows = [...jobs.values()].map(({ row }) => row).sort((a, b) =>
    a.job < b.job ? -1 : a.job > b.job ? 1 : 0,
  );
  return result;
}
