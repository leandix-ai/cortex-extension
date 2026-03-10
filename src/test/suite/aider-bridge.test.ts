// ============================================================================
// Aider Guard & Bridge Unit Tests
// Tests the lazy binary check, command builder, and output parser.
// ============================================================================

import * as assert from 'assert';
import {
    buildAiderCommand,
    parseEditedFiles,
    AiderRequest,
} from '../../aider/bridge';

suite('Aider Bridge', () => {

    test('buildAiderCommand includes required flags', () => {
        const req: AiderRequest = {
            message: 'Refactor the pricing module',
            files: ['src/pricing.ts', 'src/utils.ts'],
            model: 'claude-sonnet-4-20250514',
            workspaceRoot: '/project',
            envVars: {},
            aiderPath: 'aider',
            timeout: 120,
        };

        const args = buildAiderCommand(req);

        assert.ok(args.includes('--message'), 'Should include --message flag');
        assert.ok(args.includes('Refactor the pricing module'), 'Should include message text');
        assert.ok(args.includes('--yes'), 'Should include --yes flag');
        assert.ok(args.includes('--no-auto-commits'), 'Should include --no-auto-commits');
        assert.ok(args.includes('--no-pretty'), 'Should include --no-pretty');
        assert.ok(args.includes('--no-git'), 'Should include --no-git');
        assert.ok(args.includes('--env-file'), 'Should include --env-file');
        assert.ok(args.includes('--model'), 'Should include --model flag');
        assert.ok(args.includes('claude-sonnet-4-20250514'), 'Should include model name');
    });

    test('buildAiderCommand includes file flags', () => {
        const req: AiderRequest = {
            message: 'Fix bug',
            files: ['src/a.ts', 'src/b.ts'],
            model: 'claude-sonnet-4-20250514',
            workspaceRoot: '/project',
            envVars: {},
            aiderPath: 'aider',
            timeout: 120,
        };

        const args = buildAiderCommand(req);

        // Each file should be preceded by --file
        const fileFlags = args.filter(a => a === '--file');
        assert.strictEqual(fileFlags.length, 2, 'Should have 2 --file flags');

        assert.ok(args.includes('src/a.ts'), 'Should include first file');
        assert.ok(args.includes('src/b.ts'), 'Should include second file');
    });

    test('buildAiderCommand with empty files', () => {
        const req: AiderRequest = {
            message: 'Do something',
            files: [],
            model: 'gpt-4o',
            workspaceRoot: '/project',
            envVars: {},
            aiderPath: 'aider',
            timeout: 60,
        };

        const args = buildAiderCommand(req);
        const fileFlags = args.filter(a => a === '--file');
        assert.strictEqual(fileFlags.length, 0, 'Should have no --file flags');
    });

    test('parseEditedFiles extracts file paths from Aider output', () => {
        const output = `
Some initial output
Wrote src/pricing.ts
Wrote src/utils.ts
Done.
`;
        const files = parseEditedFiles(output);
        assert.deepStrictEqual(files, ['src/pricing.ts', 'src/utils.ts']);
    });

    test('parseEditedFiles returns empty array for no writes', () => {
        const output = 'No changes made.';
        const files = parseEditedFiles(output);
        assert.deepStrictEqual(files, []);
    });

    test('parseEditedFiles handles single file', () => {
        const output = 'Wrote src/app.ts\n';
        const files = parseEditedFiles(output);
        assert.deepStrictEqual(files, ['src/app.ts']);
    });

    test('parseEditedFiles ignores non-matching lines', () => {
        const output = `
I wrote the code.
Wrote src/main.ts
Writing complete.
`;
        const files = parseEditedFiles(output);
        assert.deepStrictEqual(files, ['src/main.ts']);
    });
});
