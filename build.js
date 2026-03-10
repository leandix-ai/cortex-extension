const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Check if typescript is available
try {
    const outDir = path.join(__dirname, 'out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    if (isWatch) {
        console.log('[build] Watch mode...');
        execSync('npx tsc --watch --noEmitOnError false', { stdio: 'inherit' });
    } else {
        console.log('[build] Compiling TypeScript...');
        execSync('npx tsc --noEmitOnError', { stdio: 'inherit' });
        console.log('[build] Done.');
    }
} catch (e) {
    // tsc already printed errors
    process.exit(1);
}
