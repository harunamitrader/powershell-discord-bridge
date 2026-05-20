import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import JobForm from './JobForm.js';
import { describeNext } from './cronUtils.js';
import { deleteJob, getJobsDir, listJobs, saveJob } from './jobStore.js';

const h = React.createElement;

export default function App() {
  const { exit } = useApp();
  const [jobs, setJobs] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState('list');
  const [editingJob, setEditingJob] = useState(undefined);

  const selectedJob = jobs[selectedIndex] ?? null;
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date()),
    []
  );

  useEffect(() => {
    reloadJobs();
  }, []);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (jobs.length === 0) {
        return 0;
      }

      return Math.min(current, jobs.length - 1);
    });
  }, [jobs]);

  useInput((input, key) => {
    if (mode === 'form') {
      return;
    }

    if (mode === 'confirm-delete') {
      if (input.toLowerCase() === 'y' && selectedJob) {
        deleteJob(selectedJob.name);
        reloadJobs();
        setMode('list');
        return;
      }

      if (input.toLowerCase() === 'n' || key.escape) {
        setMode('list');
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((current) => (jobs.length === 0 ? 0 : (current + jobs.length - 1) % jobs.length));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => (jobs.length === 0 ? 0 : (current + 1) % jobs.length));
      return;
    }

    if (input.toLowerCase() === 'a') {
      setEditingJob(undefined);
      setMode('form');
      return;
    }

    if (input.toLowerCase() === 'e' && selectedJob) {
      setEditingJob(selectedJob);
      setMode('form');
      return;
    }

    if (input.toLowerCase() === 'd' && selectedJob) {
      setMode('confirm-delete');
      return;
    }

    if (input === ' ' && selectedJob) {
      saveJob({
        ...selectedJob,
        active: selectedJob.active === false
      });
      reloadJobs();
      return;
    }

    if (input.toLowerCase() === 'q') {
      exit();
    }
  });

  if (mode === 'form') {
    return h(JobForm, {
      mode: editingJob ? 'edit' : 'add',
      initialJob: editingJob,
      onSave: (job) => {
        if (editingJob?.name && editingJob.name !== job.name) {
          deleteJob(editingJob.name);
        }
        saveJob(job);
        reloadJobs();
        setEditingJob(undefined);
        setMode('list');
      },
      onCancel: () => {
        setEditingJob(undefined);
        setMode('list');
      }
    });
  }

  if (mode === 'confirm-delete') {
    return h(
      Box,
      { flexDirection: 'column', borderStyle: 'round', borderColor: 'red', paddingX: 1 },
      h(Text, { color: 'redBright', bold: true }, 'ジョブ削除確認'),
      h(Text, null, selectedJob ? `${selectedJob.name} を削除しますか？` : '削除対象がありません'),
      h(Text, { color: 'gray' }, '[Y]削除  [N/Esc]キャンセル')
    );
  }

  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    h(
      Box,
      { justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'cyanBright' }, 'Discord Bridge Cron'),
      h(Text, { color: 'gray' }, todayLabel)
    ),
    h(Text, { color: 'gray' }, `保存先: ${getJobsDir()}`),
    h(Text, { color: 'gray' }, 'ジョブ一覧'),
    jobs.length === 0
      ? h(Text, { color: 'yellow' }, 'ジョブはまだありません。A で追加してください。')
      : jobs.map((job, index) =>
          h(JobRow, {
            key: `${job.name}-${job.cron}-${job.slot}`,
            job,
            selected: index === selectedIndex
          })
        ),
    h(Text, { color: 'gray' }, '[A]追加  [E]編集  [D]削除  [Space]ON/OFF  [Q]終了')
  );

  function reloadJobs() {
    setJobs(listJobs());
  }
}

function JobRow({ job, selected }) {
  const active = job.active !== false;
  const description = active ? describeNext(job.cron) : '停止中';

  return h(
    Text,
    { color: selected ? 'cyanBright' : undefined },
    `${selected ? '▶' : ' '} [${active ? '✓' : ' '}] ${pad(job.name, 16)} ${pad(job.cron, 13)} slot:${job.slot} ${description}`
  );
}

function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? `${text.slice(0, width - 1)}…` : text.padEnd(width, ' ');
}
