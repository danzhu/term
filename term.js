'use strict';

function span(str, cls) {
    return '<span class="' + cls + '">' + str + '</span>';
}

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const READY = Symbol('ready');
const RUNNING = Symbol('running');
const TERMINATED = Symbol('terminated');

class Program {
    constructor(parent = null) {
        this.prompt = '';
        this.exitInput = '';
        this.inputEnabled = false;
        this.echo = true;
        this.password = false;
        this.history = [];
        this.historyIndex = 0;
        this.parent = parent;
        this.children = new Set();
        this.siblings = [this];
        this.variables = parent ? new Map(parent.variables) : new Map();

        this.state = READY;

        this.stdin = term;
        this.stdout = term;
        this.stderr = termErr;
    }

    execute(args = []) {
        if (this.state !== READY)
            return;

        this.state = RUNNING;
        this.args = args;

        if (this === this.siblings[0])
            term.stdout = this;

        if (this.parent)
            this.parent.children.add(this);

        let res = this.onRun.apply(this, args);

        if (typeof res === 'number')
            this.exit(res);
    }

    exit(code = 0) {
        if (this.state !== RUNNING)
            return;

        for (let child of this.children)
            child.exit();

        this.state = TERMINATED;
        this.inputEnabled = false;

        this.stdout.onEOF();
        this.stderr.onEOF();

        if (!this.parent) {
            term.stdout = null;
            return;
        }

        // update and notify parent process
        this.parent.children.delete(this);
        this.parent.onReturn(this, code);

        if (this.siblings.every(e => e.state === TERMINATED)) {
            // return control to first process in pipeline
            term.stdout = this.parent.siblings[0];
            term.updateInput();
        }
    }

    onRun() {
        // ignore
    }

    onEOF() {
        if (this.inputEnabled)
            this.exit();
    }

    onTerminate() {
        this.exit(130);
    }

    onInput(msg) {
        // ignore
    }

    onReturn(prog, code) {
        // ignore
    }

    write(content) {
        if (this.state !== RUNNING || !this.inputEnabled)
            return;
        this.onInput(content);
    }

    writeText(msg) {
        this.write(msg);
    }

    writeHistory(prompt, input) {
        // ignore
    }

    changeOutput(msg) {
        // TODO: somehow throw
    }

    clearInput() {
        // ignore
    }

    updateInput() {
        // ignore
    }
}

class Term extends Program {
    constructor() {
        super();
        this.inputEnabled = true;

        this.inputContent = '';
        this.inputNewest = '';
        this.inputCursor = 0;

        this.scrollOnInput = true;
        this.scrollOnOutput = true;

        this.termElement = document.getElementById('term');
        this.promptElement = document.getElementById('prompt');
        this.inputElement = document.getElementById('input');
        this.outputElement = document.getElementById('output');

        document.addEventListener('keypress', e => {
            let prog = this.stdout;

            if (!prog || !prog.inputEnabled)
                return;

            if (e.keyCode === 13) { // Enter key
                if (prog.echo) {
                    let content = prog.password ?
                        '*'.repeat(term.inputContent.length) :
                        term.inputContent;
                    this.writeHistory(prog.prompt, content);
                }

                let content = term.inputContent;

                prog.write(term.inputContent);

                // remove duplicate history and add new entry
                if (!prog.password && content.trim()) {
                    let idx = prog.history.indexOf(content);
                    if (idx !== -1)
                        prog.history.splice(idx, 1);
                    prog.history.push(content);
                }

                this.clearInput();
            } else {
                term.inputNewest = term.inputContent =
                    term.inputContent.substr(0, term.inputCursor) +
                    String.fromCharCode(e.which) +
                    term.inputContent.substr(term.inputCursor);
                ++term.inputCursor;
            }

            prog.historyIndex = prog.history.length;
            this.updateInput();

            if (term.scrollOnInput)
                term.termElement.scrollTop = term.termElement.scrollHeight;
        });

        document.addEventListener('keydown', e => {
            let prog = this.stdout;

            if (!prog)
                return;

            // ctrl + c always works, even when input is disabled
            if (e.ctrlKey && e.key == 'c') {
                this.clearInput();

                prog.onTerminate();

                this.updateInput();
                e.preventDefault();
                return;
            }

            if (!prog.inputEnabled)
                return;

            if (e.ctrlKey) {
                switch (e.key) {
                    case 'd':
                        // prevent EOF when not on empty line
                        if (term.inputContent !== '')
                            break;

                        // echo termination input if available
                        if (prog.echo || prog.exitInput)
                            this.writeHistory(prog.prompt, prog.exitInput);

                        prog.onEOF();
                        break;
                }

                this.updateInput();
                e.preventDefault();
                return;
            }

            switch (e.key) {
                case 'ArrowLeft':
                    if (term.inputCursor > 0) {
                        --term.inputCursor;
                        this.updateInput();
                    }
                    break;

                case 'ArrowRight':
                    if (term.inputCursor < term.inputContent.length) {
                        ++term.inputCursor;
                        this.updateInput();
                    }
                    break;

                case 'ArrowUp':
                    if (prog.historyIndex > 0) {
                        --prog.historyIndex;
                        term.inputContent = prog.history[prog.historyIndex];
                        term.inputCursor = term.inputContent.length;
                        this.updateInput();
                    }
                    break;

                case 'ArrowDown':
                    if (prog.historyIndex < prog.history.length) {
                        ++prog.historyIndex;
                        term.inputContent =
                            prog.historyIndex === prog.history.length ?
                            term.inputNewest :
                            prog.history[prog.historyIndex];
                        term.inputCursor = term.inputContent.length;
                        this.updateInput();
                    }
                    break;

                case 'Backspace':
                    if (term.inputCursor > 0) {
                        term.inputNewest = term.inputContent =
                            term.inputContent.substr(0, term.inputCursor - 1) +
                            term.inputContent.substr(term.inputCursor);
                        --term.inputCursor;
                        this.updateInput();
                    }
                    break;

                case 'Delete':
                    if (term.inputCursor < term.inputContent.length) {
                        term.inputNewest = term.inputContent =
                            term.inputContent.substr(0, term.inputCursor) +
                            term.inputContent.substr(term.inputCursor + 1);
                        this.updateInput();
                    }
                    break;

                case 'Tab':
                    // TODO: completion
                    break;

                default:
                    // don't prevent other keys from functioning
                    return;
            }

            e.preventDefault();

            if (term.scrollOnInput)
                term.termElement.scrollTop = term.termElement.scrollHeight;
        });

    }

    onRun(shell) {
        this.sh = new shell();
        this.sh.execute(['-']);
        this.updateInput();
    }

    onEOF() {
        // ignore
    }

    onInput(msg) {
        if (typeof msg !== 'string')
            msg = escapeHTML(msg.toString());

        if (!msg)
            msg = '\n';

        let div = document.createElement('pre');
        div.innerHTML = msg;
        this.outputElement.appendChild(div);

        // FIXME: always scroll if at bottom
        if (this.scrollOnOutput)
            this.termElement.scrollTop = this.termElement.scrollHeight;
    }

    writeText(msg) {
        this.write(escapeHTML(msg));
    }

    writeHistory(prompt, input) {
        this.write(
            span(prompt, 'prompt') +
            span(escapeHTML(input), 'input')
        );
    }

    changeOutput(msg) {
        this.outputElement.lastChild.innerHTML = msg;
    }

    clearInput() {
        let prog = this.stdout;

        this.inputNewest = this.inputContent = '';
        this.inputCursor = 0;
        if (prog)
            prog.historyIndex = prog.history.length;
    }

    updateInput() {
        let prog = this.stdout;

        this.promptElement.innerHTML = prog ? prog.prompt : '';

        let content = this.inputContent;

        // password mask
        if (prog && prog.password)
            content = '*'.repeat(content.length);

        // disabled input
        if (!prog || !prog.inputEnabled) {
            this.inputElement.innerHTML = content;
            return;
        }

        let cursor = '<span id="cursor">' +
            escapeHTML(content.substr(this.inputCursor, 1) || ' ') +
            '</span>';

        this.inputElement.innerHTML =
            escapeHTML(content.substr(0, this.inputCursor)) +
            cursor +
            escapeHTML(content.substr(this.inputCursor + 1));
    }
}

class TermError extends Program {
    constructor() {
        super();
        this.inputEnabled = true;
    }

    onEOF() {
        // ignore
    }

    onInput(content) {
        this.stdout.write(span(content, 'error'));
    }
}

class Monitor extends Program {
    constructor(parent, callback, eof = null) {
        super(parent);
        this.callback = callback;
        this.eof = eof;
        this.inputEnabled = true;
    }

    onEOF() {
        if (this.eof)
            this.eof(this);
        else
            super.onEOF();
    }

    onInput(str) {
        this.callback(this, str);
    }
}

class Printer extends Program {
    constructor(parent, content) {
        super(parent);
        this.content = content;
    }

    onRun() {
        this.stdout.writeText(this.content);
        return 0;
    }
}

class Caller extends Program {
    constructor(parent, fn) {
        super(parent);
        this.fn = fn;
    }

    onRun() {
        this.fn(this);
        return 0;
    }
}

class Shell extends Program {
    constructor(parent) {
        super(parent);
        this.exitInput = 'exit';
        this.inputEnabled = true;
        this.setPrompt(0);
    }

    onRun(script) {
        this.stdout.writeText('Term v0.1');
    }

    onInput(str) {
        str = str.trim();

        // TODO: multiline

        // TODO: parse parameters
        let params = str.split(' ').filter(e => e.length !== 0);

        // resolve variables
        // TODO: merge with parsing for in-line usage
        for (let i = params.length - 1; i >= 0; --i) {
            if (params[i][0] === '$') {
                let val = this.variables.get(params[i].substr(1));
                params[i] = val || '';
            }
        }

        // process variable assignments
        while (params.length > 0) {
            let idx = params[0].indexOf('=');
            if (idx === -1)
                break;

            let name = params[0].substr(0, idx);
            let value = params[0].substr(idx + 1);
            this.variables.set(name, value);
            params.shift();
        }

        if (params.length === 0)
            return;

        let programs = [[]];

        for (let i = 0; i < params.length; ++i) {
            if (params[i] === '|') {
                programs.push([]);
                continue;
            }

            programs[programs.length - 1].push(params[i]);
        }

        // detect pipe errors
        if (programs.some(e => e.length === 0)) {
            this.stderr.writeText('sh: invalid pipe');
            this.setPrompt(1);
            return;
        }

        let processes = programs.map(e => this.createProcess(e[0]));

        // detect non-existent processes
        if (processes.some(e => !e)) {
            this.setPrompt(127);
            return;
        }

        let args = programs.map(e => e.slice(1));

        this.last = processes[processes.length - 1];

        for (let i = 0; i < processes.length; ++i) {
            processes[i].siblings = processes;
            if (i > 0)
                processes[i].stdin = processes[i - 1];
            if (i < processes.length - 1)
                processes[i].stdout = processes[i + 1];
        }

        // execute in reverse order so that input can be received
        for (let i = processes.length - 1; i >= 0; --i) {
            processes[i].execute(args[i]);
        }
    }

    onTerminate() {
        // ignore
    }

    onReturn(prog, code) {
        // ignore all but last program
        if (prog === this.last)
            this.setPrompt(code);
    }

    setPrompt(code) {
        this.variables.set('?', code);
        this.prompt = code ? span('$ ', 'error') : '$ ';
    }

    createProcess(cmd) {
        switch (cmd) {
            case 'history':
                return new Printer(this, this.history.join('\n'));

            case 'read':
                return new Monitor(this, (proc, str) => {
                    this.variables.set(proc.args[0], str);
                    proc.exit();
                });

            case 'echo':
                return new Caller(this, (proc) => {
                    proc.stdout.writeText(proc.args.join(' '));
                });

            case 'exit':
                return new Caller(this, (proc) => {
                    let code = Number.parseInt(proc.args[0]);
                    if (Number.isNaN(code)) {
                        proc.stderr.writeText('sh: exit: ' +
                            proc.args[0] + ': numeric argument required');
                        code = 2;
                    }
                    this.exit(code);
                });
        }

        if (!bin[cmd]) {
            this.stderr.writeText('sh: command not found: ' + cmd);
            return;
        }

        return new bin[cmd](this);
    }
}

class Interpreter extends Program {
    constructor(parent) {
        super(parent);
        this.prompt = '> '
        this.inputEnabled = true;
    }

    onInput(str) {
        try {
            this.stdout.writeText(String(eval(str)));
        } catch (e) {
            this.stderr.writeText(e.toString());
        }
    }
}

class Cat extends Program {
    onRun(file) {
        if (!file) {
            this.inputEnabled = true;
            return;
        }

        let content = localStorage.getItem(file);
        if (content === null) {
            this.stderr.writeText('cat: ' + file + ': no such file');
            return 1;
        }

        this.stdout.writeText(content);
        return 0;
    }

    onInput(str) {
        this.stdout.writeText(str);
    }
}

class Tee extends Program {
    onRun(file) {
        this.content = [];
        this.file = file;
        this.inputEnabled = true;
    }

    onInput(str) {
        this.content.push(str);
        this.stdout.writeText(str);
        localStorage.setItem(this.file, this.content.join('\n'));
    }
}

class List extends Program {
    onRun() {
        let list = [];
        for (let name in localStorage)
            list.push(name);

        for (let l of list)
            this.stdout.writeText(l);
        return 0;
    }
}

class Remove extends Program {
    onRun(file) {
        if (!file) {
            this.stderr.writeText('rm: missing operand');
            return 1;
        }

        localStorage.removeItem(file);
        return 0;
    }
}

class Curl extends Program {
    onRun(url) {
        if (!url) {
            this.stderr.writeText('curl: missing url');
            return 1;
        }

        this.req = new XMLHttpRequest();
        this.req.open('GET', url, true);
        this.req.onreadystatechange = () => {
            if (this.req.readyState !== 4)
                return;

            if (this.req.status != 200) {
                this.exit(1);
                return;
            }
            let lines = this.req.responseText.split('\n');
            for (let line of lines)
                this.stdout.writeText(line);
            this.exit();
        };
        this.req.send();
    }

    onTerminate() {
        this.req.abort();
        super.onTerminate();
    }
}

class Head extends Program {
    onRun(counter) {
        this.counter = Number.parseInt(counter);

        if (Number.isNaN(this.counter)) {
            this.stderr.writeText('head: invalid number of lines');
            return 1;
        }

        if (this.counter <= 0)
            return 0;

        this.inputEnabled = true;
    }

    onInput(str) {
        this.stdout.writeText(str);
        --this.counter;

        if (this.counter === 0) {
            this.exit(0);
            return;
        }
    }
}

class Tail extends Program {
    onRun(counter) {
        this.counter = Number.parseInt(counter);

        if (Number.isNaN(this.counter)) {
            this.stderr.writeText('tail: invalid number of lines');
            return 1;
        }

        if (this.counter <= 0)
            return 0;

        this.inputEnabled = true;
        this.lines = [];
    }

    onInput(str) {
        if (this.lines.length === this.counter)
            this.lines.shift();

        this.lines.push(str);
    }

    onEOF() {
        for (let line of this.lines)
            this.stdout.writeText(line);
        this.exit(0);
    }
}

class Sleep extends Program {
    onRun(time) {
        if (!time) {
            this.stderr.writeText('sleep: missing operand');
            return 1;
        }

        setTimeout(() => {
            this.exit();
        }, Number.parseFloat(time) * 1000);
    }
}

class Clear extends Program {
    onRun() {
        const output = document.getElementById('output');
        while (output.lastChild)
            output.removeChild(output.lastChild);

        return 0;
    }
}

const bin = {
    'sh': Shell,
    'js': Interpreter,
    'cat': Cat,
    'tee': Tee,
    'ls': List,
    'rm': Remove,
    'curl': Curl,
    'head': Head,
    'tail': Tail,
    'sleep': Sleep,
    'clear': Clear
};

let term = null;
let termErr = null;

term = new Term();
termErr = new TermError();

termErr.execute();
term.execute([Shell]);
