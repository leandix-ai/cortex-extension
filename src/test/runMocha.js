// ============================================================================
// Direct Mocha Runner — runs tests without VS Code test host.
// Usage: node src/test/runMocha.js
// ============================================================================

const Mocha = require('mocha');
const path = require('path');
const { glob } = require('glob');

async function main() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 10000,
    });

    // Mock the 'vscode' module for tests that import it
    const Module = require('module');
    const originalResolveFilename = Module._resolveFilename;
    const mockPath = path.resolve(__dirname, 'vscode-mock.js');
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (request === 'vscode') {
            return mockPath;
        }
        return originalResolveFilename.call(this, request, parent, isMain, options);
    };

    // Look for compiled test files in out/test/suite/
    const testsRoot = path.resolve(__dirname, '../../out/test/suite');
    const files = await glob('**/*.test.js', { cwd: testsRoot });

    if (files.length === 0) {
        console.error('No test files found. Run "npm run compile" first.');
        process.exit(1);
    }

    console.log(`Found ${files.length} test file(s):\n${files.map(f => '  - ' + f).join('\n')}\n`);

    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    mocha.run((failures) => {
        if (failures > 0) {
            console.error(`\n${failures} test(s) failed.`);
            process.exit(1);
        } else {
            console.log('\nAll tests passed!');
        }
    });
}

main().catch((err) => {
    console.error('Runner error:', err);
    process.exit(1);
});
