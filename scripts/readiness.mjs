import { stat, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredProjects = ['blankdiss', 'reports', 'treage', 'insider'];

export async function publicationReadiness({ directory = 'dist', event = 'schedule', now = new Date() } = {}) {
  const missing = [];
  for (const project of requiredProjects) {
    try {
      if (!(await stat(path.join(directory, project, 'index.html'))).isFile()) missing.push(project);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      missing.push(project);
    }
  }
  if (missing.length) return { ready: false, reason: 'Inväntar leverans: ' + missing.join(', ') };
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', hourCycle: 'h23' }).format(now));
  // Keep daytime deliveries staged until 21:00. Accept delayed night deliveries
  // through 05:59; the scheduled check or an explicit manual run can run later.
  if (event === 'push' && hour >= 6 && hour < 21) {
    return { ready: false, reason: 'Alla projekt levererade; inväntar kvällspubliceringen 21:00.' };
  }
  return { ready: true, reason: 'Alla fyra projekt har levererat; publicering kan starta.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await publicationReadiness({ event: process.env.GITHUB_EVENT_NAME || 'schedule' });
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${result.ready}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
}
