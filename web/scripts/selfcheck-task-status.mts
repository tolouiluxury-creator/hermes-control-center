// Self-check for TasksPage status derivation + sorting (Optimierung 4).
// Run: node --experimental-strip-types web/scripts/selfcheck-task-status.mts
// (The calls to taskStatus/sortTasks are side-effect-free; describeCron etc. untouched.)
import type { CronJobSummary } from '../src/lib/hermesTypes.ts';

function taskStatus(job: CronJobSummary): 'failed' | 'running' | 'paused' {
  if (job.paused) return 'paused';
  return job.lastStatus !== null && job.lastStatus !== 'ok' ? 'failed' : 'running';
}
const statusOrder: Record<'failed' | 'running' | 'paused', number> = { failed: 0, running: 1, paused: 2 };
function sortTasks(jobs: CronJobSummary[]): CronJobSummary[] {
  return [...jobs].sort((a, b) => {
    const byStatus = statusOrder[taskStatus(a)] - statusOrder[taskStatus(b)];
    if (byStatus !== 0) return byStatus;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}

const job = (id: string, paused: boolean, lastStatus: string | null, name?: string): CronJobSummary => ({
  id, name: name ?? id, schedule: null, paused, nextRun: null, lastRun: null,
  lastStatus, lastError: null, profile: null, prompt: null, deliver: null,
});

const cases: Array<[CronJobSummary, 'failed' | 'running' | 'paused']> = [
  [job('a', false, null), 'running'],        // never ran, enabled -> running
  [job('b', false, 'ok'), 'running'],        // ran fine
  [job('c', true, 'ok'), 'paused'],          // paused wins over lastStatus
  [job('d', false, 'error'), 'failed'],      // live but last run failed
  [job('e', true, 'error'), 'paused'],       // paused beats failed
  [job('f', true, null), 'paused'],
];
for (const [j, want] of cases) {
  const got = taskStatus(j);
  if (got !== want) { console.error('FAIL taskStatus', j.id, 'want', want, 'got', got); process.exit(1); }
}
console.log('taskStatus:', cases.length, 'cases ok');

const unsorted = [
  job('z-paused', true, null, 'Aaa'),
  job('y-failed', false, 'error', 'Bbb'),
  job('x-running', false, 'ok', 'Ccc'),
  job('w-running-null', false, null, 'Ddd'),
  job('v-paused-2', true, null, 'Eee'),
];
const sorted = sortTasks(unsorted);
const wantOrder = ['y-failed', 'x-running', 'w-running-null', 'z-paused', 'v-paused-2'];
const gotOrder = sorted.map((j) => j.id);
if (JSON.stringify(gotOrder) !== JSON.stringify(wantOrder)) {
  console.error('FAIL sort', gotOrder, 'want', wantOrder); process.exit(1);
}
console.log('sortTasks: failed->running->paused, name tiebreak ok');

// Determinism: re-sorting twice gives the same order.
if (JSON.stringify(sortTasks(unsorted).map((j) => j.id)) !== JSON.stringify(gotOrder)) {
  console.error('FAIL sort determinism'); process.exit(1);
}
console.log('sortTasks determinism ok');
console.log('ALL CHECKS PASSED');