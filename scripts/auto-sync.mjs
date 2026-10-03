import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEBOUNCE_MS = Number(process.env.AUTOSYNC_DEBOUNCE_MS || 8000);
const REMOTE = process.env.AUTOSYNC_REMOTE || 'fork';
const DO_DEPLOY = !process.argv.includes('--no-deploy');
const RUN_ONCE = process.argv.includes('--once');

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.vercel', '.cache']);

const spawnRun = (command, args, useShell) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });

const git = (args) => spawnRun('git', args, false);
const shell = (commandLine) => spawnRun(commandLine, [], true);

const log = (message) => {
  const stamp = new Date().toLocaleTimeString('id-ID');
  console.log(`[autosync ${stamp}] ${message}`);
};

const changedFiles = async () => {
  const { code, stdout, stderr } = await git(['status', '--porcelain']);
  if (code !== 0) {
    log(`GAGAL membaca status git: ${stderr.trim() || `exit ${code}`}`);
    return [];
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0);
};

const buildMessage = (entries) => {
  const files = entries
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((file) => file && !file.includes(' -> '));
  const unique = [...new Set(files)];
  const stamp = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  if (unique.length === 0) return `auto-sync: ${stamp}`;
  if (unique.length <= 3) return `auto-sync: update ${unique.join(', ')}`;
  return `auto-sync: update ${unique.slice(0, 3).join(', ')} +${unique.length - 3} file lain`;
};

let busy = false;
let pending = false;

async function syncOnce() {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;

  try {
    const entries = await changedFiles();
    if (entries.length === 0) {
      log('tidak ada perubahan, dilewati');
      return;
    }

    log(`${entries.length} file berubah, menjalankan lint + build...`);

    const lint = await shell('npm run lint');
    if (lint.code !== 0) {
      log('GAGAL: lint error, commit & deploy dibatalkan');
      log(lint.stdout.split('\n').filter((l) => l.includes('error')).slice(0, 5).join('\n'));
      return;
    }

    const build = await shell('npm run build');
    if (build.code !== 0) {
      log('GAGAL: build error, commit & deploy dibatalkan');
      log(build.stdout.split('\n').slice(-12).join('\n'));
      return;
    }
    log('lint + build OK');

    await git(['add', '-A']);
    const message = buildMessage(entries);
    const commit = await git(['commit', '-m', message]);
    if (commit.code !== 0) {
      log('GAGAL: commit gagal');
      log(commit.stdout || commit.stderr);
      return;
    }
    const short = (commit.stdout.match(/\[main ([0-9a-f]+)\]/) || [])[1] || '?';
    log(`commit ${short} dibuat: ${message}`);

    const push = await git(['push', REMOTE, 'main']);
    if (push.code !== 0) {
      log(`GAGAL: push ke ${REMOTE} ditolak`);
      log(push.stderr.split('\n').slice(0, 3).join('\n'));
    } else {
      log(`push ke ${REMOTE} berhasil`);
    }

    if (DO_DEPLOY) {
      log('deploy ke Vercel production, tunggu...');
      const deploy = await shell('vercel --prod --yes');
      const output = deploy.stdout + deploy.stderr;
      const productionUrl = (output.match(/Aliased\s+(https:\/\/\S+)/) || [])[1]
        || 'https://lapak-berkah-buntulia.vercel.app';
      if (deploy.code === 0 && /Ready in|Deployment completed|✓ Ready/.test(output)) {
        log(`deploy sukses: ${productionUrl}`);
      } else {
        log(`GAGAL: deploy Vercel (exit ${deploy.code})`);
        log(output.split('\n').slice(-10).join('\n'));
      }
    }
  } catch (error) {
    log(`ERROR: ${error.message}`);
  } finally {
    busy = false;
    if (pending) {
      pending = false;
      setTimeout(syncOnce, 1000);
    }
  }
}

const shouldIgnore = (relativePath) =>
  relativePath
    .split(path.sep)
    .some((segment) => IGNORED_DIRS.has(segment) || segment.startsWith('.env'));

let timer = null;
const schedule = (reason) => {
  if (timer) clearTimeout(timer);
  log(`perubahan terdeteksi (${reason}), menunggu ${DEBOUNCE_MS / 1000}s sampai settles...`);
  timer = setTimeout(syncOnce, DEBOUNCE_MS);
};

if (RUN_ONCE) {
  console.log('Mode --once: menjalankan satu siklus sync lalu keluar.');
  await syncOnce();
  process.exit(0);
} else {
  log(`watch aktif - debounce ${DEBOUNCE_MS / 1000}s, remote "${REMOTE}", deploy ${DO_DEPLOY ? 'ON' : 'OFF'}`);
  watch(ROOT, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const relative = path.relative(ROOT, String(filename));
    if (!relative || shouldIgnore(relative)) return;
    schedule(relative);
  });
  log('menunggu perubahan file... (Ctrl+C untuk berhenti)');
}
