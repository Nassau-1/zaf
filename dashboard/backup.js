// ZAF backup engine — TKT-ZAF-0057.
// Produces dated archive snapshots of ZAF persistent state under a configurable backup root
// (default C:/Users/LENOVO/Workspace/02_Runtime/zaf-backups) and enforces a Grandfather–
// Father–Son retention policy.
//
// Backup set (per PERSISTENCE.md):
//   - dashboard/config.json
//   - dashboard/audit-log.jsonl
//   - dashboard/runs/                  (all *.prompt.md + *.output.*)
//   - <repo>/WIP/tickets/ACTIVE/       (every repo discovered under REPOS_ROOT)
//   - <repo>/WIP/tickets/ARCHIVED/
//   - <repo>/WIP/tickets/TICKETS.md
//   - <repo>/WIP/programmes/
//
// Retention:
//   - Daily snapshots:   keep the latest 7
//   - Weekly snapshots:  keep the latest 5   (taken on Mondays)
//   - Monthly snapshots: keep the latest 12  (taken on the 1st of the month)

const fs = require('fs');
const path = require('path');

const DASHBOARD_DIR = __dirname;
const REPOS_ROOT = process.env.ZAF_REPOS_ROOT || path.resolve(DASHBOARD_DIR, '..', '..');
const BACKUP_ROOT = process.env.ZAF_BACKUP_ROOT
  || path.resolve(DASHBOARD_DIR, '..', '..', '..', '02_Runtime', 'zaf-backups');

const RETENTION = {
  daily:   7,
  weekly:  5,
  monthly: 12,
};

function ts() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function classify(now = new Date()) {
  // Monday + 1st of month satisfy multiple tiers.
  const tiers = ['daily'];
  if (now.getDay() === 1) tiers.push('weekly');
  if (now.getDate() === 1) tiers.push('monthly');
  return tiers;
}

function copyFileSafe(src, destDir) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, path.basename(src)));
  return true;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) n += copyDirRecursive(sp, dp);
    else { fs.copyFileSync(sp, dp); n++; }
  }
  return n;
}

function listRepos() {
  if (!fs.existsSync(REPOS_ROOT)) return [];
  return fs.readdirSync(REPOS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(REPOS_ROOT, d.name))
    .filter(p => fs.existsSync(path.join(p, 'WIP')));
}

function runBackup(opts = {}) {
  const stamp = opts.stamp || ts();
  const tiers = opts.tiers || classify(new Date());
  const manifest = { stamp, tiers, files: 0, repos: [], errors: [] };

  for (const tier of tiers) {
    const tierRoot = path.join(BACKUP_ROOT, tier, stamp);
    try {
      // Dashboard state
      if (copyFileSafe(path.join(DASHBOARD_DIR, 'config.json'),     path.join(tierRoot, 'dashboard'))) manifest.files++;
      if (copyFileSafe(path.join(DASHBOARD_DIR, 'audit-log.jsonl'), path.join(tierRoot, 'dashboard'))) manifest.files++;
      manifest.files += copyDirRecursive(path.join(DASHBOARD_DIR, 'runs'), path.join(tierRoot, 'dashboard', 'runs'));

      // Per-repo WIP/
      for (const repoPath of listRepos()) {
        const slug = path.basename(repoPath);
        const wipSrc  = path.join(repoPath, 'WIP');
        const wipDest = path.join(tierRoot, 'repos', slug, 'WIP');
        const n = copyDirRecursive(wipSrc, wipDest);
        manifest.files += n;
        manifest.repos.push({ slug, files: n });
      }

      fs.writeFileSync(path.join(tierRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    } catch (e) {
      manifest.errors.push({ tier, error: e.message });
    }
  }

  // Rotation: purge oldest beyond retention for each tier.
  for (const tier of Object.keys(RETENTION)) {
    const tierDir = path.join(BACKUP_ROOT, tier);
    if (!fs.existsSync(tierDir)) continue;
    const snapshots = fs.readdirSync(tierDir)
      .filter(n => fs.statSync(path.join(tierDir, n)).isDirectory())
      .sort();
    while (snapshots.length > RETENTION[tier]) {
      const oldest = snapshots.shift();
      try { fs.rmSync(path.join(tierDir, oldest), { recursive: true, force: true }); }
      catch (e) { manifest.errors.push({ tier, prune: oldest, error: e.message }); }
    }
  }

  return manifest;
}

function latestSnapshot() {
  const dailyDir = path.join(BACKUP_ROOT, 'daily');
  if (!fs.existsSync(dailyDir)) return null;
  const snaps = fs.readdirSync(dailyDir)
    .filter(n => fs.statSync(path.join(dailyDir, n)).isDirectory())
    .sort();
  if (!snaps.length) return null;
  return path.join(dailyDir, snaps[snaps.length - 1]);
}

function restoreLatest() {
  const snap = latestSnapshot();
  if (!snap) throw new Error('No daily snapshot found to restore from');
  const report = { snapshot: snap, restored: [] };

  // Restore dashboard files
  const dashSnap = path.join(snap, 'dashboard');
  if (fs.existsSync(path.join(dashSnap, 'config.json'))) {
    fs.copyFileSync(path.join(dashSnap, 'config.json'), path.join(DASHBOARD_DIR, 'config.json'));
    report.restored.push('dashboard/config.json');
  }
  if (fs.existsSync(path.join(dashSnap, 'audit-log.jsonl'))) {
    fs.copyFileSync(path.join(dashSnap, 'audit-log.jsonl'), path.join(DASHBOARD_DIR, 'audit-log.jsonl'));
    report.restored.push('dashboard/audit-log.jsonl');
  }
  // Restore per-repo WIP/ (only into repos that already exist locally — never auto-create repos)
  const reposSnap = path.join(snap, 'repos');
  if (fs.existsSync(reposSnap)) {
    for (const slug of fs.readdirSync(reposSnap)) {
      const wipSrc = path.join(reposSnap, slug, 'WIP');
      const repoLocal = path.join(REPOS_ROOT, slug);
      if (!fs.existsSync(repoLocal)) { report.restored.push(`skip ${slug} (repo not present locally)`); continue; }
      const wipDest = path.join(repoLocal, 'WIP');
      copyDirRecursive(wipSrc, wipDest);
      report.restored.push(`repos/${slug}/WIP`);
    }
  }
  return report;
}

module.exports = { runBackup, restoreLatest, BACKUP_ROOT, RETENTION };

// CLI: `node backup.js` runs a backup. `node backup.js restore` restores latest daily.
if (require.main === module) {
  const cmd = process.argv[2] || 'backup';
  if (cmd === 'restore') {
    console.log(JSON.stringify(restoreLatest(), null, 2));
  } else {
    console.log(JSON.stringify(runBackup(), null, 2));
  }
}
