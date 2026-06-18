const { execSync } = require('child_process');
const path = require('path');

const LOG = 'C:\\tmp\\post-pipeline.log';
const DIR = __dirname;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    require('fs').appendFileSync(LOG, line + '\n');
}

async function run(label, cmd) {
    log(`START: ${label}`);
    try {
        execSync(cmd, { cwd: DIR, stdio: 'inherit' });
        log(`DONE: ${label}`);
    } catch (e) {
        log(`ERROR: ${label} — ${e.message}`);
        process.exit(1);
    }
}

(async () => {
    log('Post-pipeline chainer started');
    await run('Deduplication', 'node run-dedup-only.js');
    await run('Guidance trackers', 'node run-trackers-only.js');
    log('All done. Check insights tab count manually.');
})();
