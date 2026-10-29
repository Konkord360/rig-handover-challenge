export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstTime: string;
  lastTime: string;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  counts: Record<DigestStatus, number>;
};

// Returns null for a missing night; an empty file returns an empty digest.
export { readNight } from './reader.js';
