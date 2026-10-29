import type { NightDigest } from '../digest/types.js';

export function DigestPage({ night, digest }: { night: string; digest: NightDigest }) {
  return (
    <>
      <h1>digest · {night}</h1>
      {digest.badLines > 0 && <p class="warn">bad lines: {digest.badLines}</p>}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th><th>owner</th><th>runs</th><th>retries</th>
              <th>last status</th><th>last error</th><th>first time</th><th>last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td>{row.retries >= 3 ? <span class="warn">{row.retries} · high retries</span> : row.retries}</td>
                <td>{row.lastStatus === 'fail' ? <span class="warn">fail</span> : row.lastStatus}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstTime}</td>
                <td>{row.lastTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
