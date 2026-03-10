// ============================================================================
// Minimal vscode mock — provides stubs for APIs used in tests.
// Only used when running tests outside VS Code extension host.
// ============================================================================

const EventEmitter = require('events');

class MockUri {
    constructor(fsPath) {
        this.fsPath = fsPath;
        this.scheme = 'file';
        this.path = fsPath;
    }
    static parse(str) { return new MockUri(str.replace('file://', '')); }
    static file(fsPath) { return new MockUri(fsPath); }
    static joinPath(base, ...segments) {
        const path = require('path');
        return new MockUri(path.join(base.fsPath, ...segments));
    }
    toString() { return `file://${this.fsPath}`; }
}

class MockPosition {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class MockRange {
    constructor(startLineOrPos, startColOrEndPos, endLine, endCol) {
        if (startLineOrPos instanceof MockPosition) {
            this.start = startLineOrPos;
            this.end = startColOrEndPos;
        } else {
            this.start = new MockPosition(startLineOrPos, startColOrEndPos);
            this.end = new MockPosition(endLine, endCol);
        }
    }
}

const ExtensionMode = { Production: 1, Development: 2, Test: 3 };

const commands = {
    executeCommand: async () => { },
    registerCommand: () => ({ dispose: () => { } }),
};

const window = {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: (cb) => ({ dispose: () => { } }),
    onDidChangeTextEditorSelection: (cb) => ({ dispose: () => { } }),
    showInformationMessage: async () => { },
    showWarningMessage: async () => { },
    showErrorMessage: async () => { },
    createTerminal: () => ({ show: () => { }, sendText: () => { }, dispose: () => { } }),
    createTextEditorDecorationType: () => ({ dispose: () => { } }),
    showTextDocument: async (doc) => doc,
    showQuickPick: async () => null,
    registerWebviewViewProvider: () => ({ dispose: () => { } }),
    createStatusBarItem: () => ({
        text: '', tooltip: '', command: '', show: () => { }, hide: () => { }, dispose: () => { },
    }),
};

const workspace = {
    getConfiguration: (section) => ({
        get: (key, defaultValue) => defaultValue,
    }),
    workspaceFolders: [],
    findFiles: async () => [],
    fs: {
        readFile: async (uri) => Buffer.from(''),
        writeFile: async (uri, data) => { },
        readDirectory: async (uri) => [],
        delete: async (uri) => { },
    },
    openTextDocument: async (uri) => ({
        uri,
        getText: () => '',
        languageId: 'typescript',
    }),
    asRelativePath: (uri) => uri.fsPath || uri.toString(),
};

const languages = {
    registerCodeLensProvider: () => ({ dispose: () => { } }),
};

const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };

module.exports = {
    Uri: MockUri,
    ExtensionMode,
    commands,
    window,
    workspace,
    languages,
    FileType,
    Position: MockPosition,
    Range: MockRange,
    EventEmitter: class VscodeEventEmitter {
        constructor() { this._emitter = new EventEmitter(); }
        get event() { return (listener) => { this._emitter.on('event', listener); return { dispose: () => this._emitter.removeListener('event', listener) }; }; }
        fire(data) { this._emitter.emit('event', data); }
        dispose() { this._emitter.removeAllListeners(); }
    },
};
