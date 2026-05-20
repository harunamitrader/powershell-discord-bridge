import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRON_JOBS_DIR = process.env.CRON_JOBS_DIR ?? path.join(__dirname, '../../cron-jobs');

mkdirSync(CRON_JOBS_DIR, { recursive: true });

export function getJobsDir() {
  return CRON_JOBS_DIR;
}

export function listJobs() {
  return readdirSync(CRON_JOBS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(path.join(CRON_JOBS_DIR, entry.name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function saveJob(job) {
  const filePath = path.join(CRON_JOBS_DIR, `${job.name}.json`);
  writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
}

export function deleteJob(name) {
  rmSync(path.join(CRON_JOBS_DIR, `${name}.json`), { force: true });
}
