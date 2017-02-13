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

class Output {
    constructor(content) {
        this.content = content;
    }

    str() {
        return this.content;
    }

    print() {
        return this.str();
    }

    items() {
        return [this];
    }
}

class RawOutput extends Output {
}

class TextOutput extends Output {
    print() {
        return escapeHTML(this.content);
    }

    items() {
        return this.content.split('\n').map(e => new TextOutput(e));
    }
}

class ArrayOutput extends Output {
    str() {
        return this.content.map(e => e.str()).join('\n');
    }

    print() {
        // TODO: formatted print
        return this.content.map(e => e.print()).join('\n');
    }

    items() {
        return this.content;
    }
}

class ObjectOutput extends Output {
    str() {
        return String(this.content);
    }

    // TODO: formatted print
}

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
        this.tty = false;

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

        let res = this.onExecute.apply(this, args);

        if (typeof res === 'number')
            this.exit(res);
    }

    eof() {
        if (this.state !== RUNNING)
            return;
        this.onEOF();
    }

    interrupt() {
        if (this.state !== RUNNING)
            return;
        this.onInterrupt();
    }

    exit(code = 0) {
        if (this.state !== RUNNING)
            return;

        this.state = TERMINATED;
        this.inputEnabled = false;

        for (let child of this.children)
            child.exit();

        this.stdout.eof();
        this.stderr.eof();

        if (!this.parent) {
            term.stdout = null;
            return;
        }

        if (this.commandReturned()) {
            // return control to first process in pipeline
            let first = this.parent.siblings[0];
            first.stdin.stdout = first;
            first.stdin.updateInput();
        }

        // update and notify parent process
        this.parent.children.delete(this);
        if (this.parent.state === RUNNING)
            this.parent.onReturn(this, code);
    }

    write(content) {
        if (this.state !== RUNNING || !this.inputEnabled)
            return;
        this.onInput(content);
    }

    writeRaw(content) {
        this.write(new RawOutput(content));
    }

    writeText(msg) {
        this.write(new TextOutput(msg));
    }

    writeHistory(prompt, input) {
        // ignore
    }

    clearInput() {
        // ignore
    }

    updateInput() {
        // ignore
    }

    commandReturned() {
        return this.siblings.every(e => e.state === TERMINATED)
    }

    onExecute() {
        // ignore
    }

    onEOF() {
        if (this.inputEnabled)
            this.exit();
    }

    onInterrupt() {
        if (this.parent)
            this.parent.interrupt();
        this.exit(130);
    }

    onInput(msg) {
        // ignore
    }

    onReturn(prog, code) {
        // ignore
    }
}

class Term extends Program {
    constructor() {
        super();
        this.inputEnabled = true;
        this.tty = true;

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
                        '*'.repeat(this.inputContent.length) :
                        this.inputContent;
                    this.writeHistory(prog.prompt, content);
                }

                let content = this.inputContent;

                prog.writeText(this.inputContent);

                // remove duplicate history and add new entry
                if (!prog.password && content.trim()) {
                    let idx = prog.history.indexOf(content);
                    if (idx !== -1)
                        prog.history.splice(idx, 1);
                    prog.history.push(content);
                }

                this.clearInput();
            } else {
                this.inputNewest = this.inputContent =
                    this.inputContent.substr(0, this.inputCursor) +
                    String.fromCharCode(e.which) +
                    this.inputContent.substr(this.inputCursor);
                ++this.inputCursor;
            }

            prog.historyIndex = prog.history.length;
            this.updateInput();

            if (this.scrollOnInput)
                this.termElement.scrollTop = this.termElement.scrollHeight;
        });

        document.addEventListener('keydown', e => {
            let prog = this.stdout;

            if (!prog)
                return;

            // ctrl + c always works, even when input is disabled
            if (e.ctrlKey && e.key == 'c') {
                this.clearInput();

                prog.interrupt();

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
                        if (this.inputContent !== '')
                            break;

                        // echo termination input if available
                        if (prog.echo || prog.exitInput)
                            this.writeHistory(prog.prompt, prog.exitInput);

                        prog.eof();
                        break;
                }

                this.updateInput();
                e.preventDefault();
                return;
            }

            switch (e.key) {
                case 'ArrowLeft':
                    if (this.inputCursor > 0) {
                        --this.inputCursor;
                        this.updateInput();
                    }
                    break;

                case 'ArrowRight':
                    if (this.inputCursor < this.inputContent.length) {
                        ++this.inputCursor;
                        this.updateInput();
                    }
                    break;

                case 'ArrowUp':
                    if (prog.historyIndex > 0) {
                        --prog.historyIndex;
                        this.inputContent = prog.history[prog.historyIndex];
                        this.inputCursor = this.inputContent.length;
                        this.updateInput();
                    }
                    break;

                case 'ArrowDown':
                    if (prog.historyIndex < prog.history.length) {
                        ++prog.historyIndex;
                        this.inputContent =
                            prog.historyIndex === prog.history.length ?
                            this.inputNewest :
                            prog.history[prog.historyIndex];
                        this.inputCursor = this.inputContent.length;
                        this.updateInput();
                    }
                    break;

                case 'Backspace':
                    if (this.inputCursor > 0) {
                        this.inputNewest = this.inputContent =
                            this.inputContent.substr(0, this.inputCursor - 1) +
                            this.inputContent.substr(this.inputCursor);
                        --this.inputCursor;
                        this.updateInput();
                    }
                    break;

                case 'Delete':
                    if (this.inputCursor < this.inputContent.length) {
                        this.inputNewest = this.inputContent =
                            this.inputContent.substr(0, this.inputCursor) +
                            this.inputContent.substr(this.inputCursor + 1);
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

            if (this.scrollOnInput)
                this.termElement.scrollTop = this.termElement.scrollHeight;
        });

    }

    onExecute(shell) {
        this.sh = new shell();
        this.sh.execute(['-']);
        this.updateInput();
    }

    onEOF() {
        // ignore
    }

    onInput(content) {
        let div = document.createElement('pre');
        div.innerHTML = content.print();
        this.outputElement.appendChild(div);

        // FIXME: always scroll if at bottom
        if (this.scrollOnOutput)
            this.termElement.scrollTop = this.termElement.scrollHeight;
    }

    writeHistory(prompt, input) {
        this.writeRaw(
            span(prompt, 'prompt') +
            span(escapeHTML(input), 'input')
        );
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
        this.tty = true;
    }

    onEOF() {
        // ignore
    }

    onInput(content) {
        this.stdout.writeRaw(span(content.print(), 'error'));
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

    onExecute() {
        this.stdout.writeText(this.content);
        return 0;
    }
}

class Caller extends Program {
    constructor(parent, fn) {
        super(parent);
        this.fn = fn;
    }

    onExecute() {
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

        this.commandRunning = false;
        this.commands = [];
    }

    onExecute(script) {
        if (!this.stdin.tty)
            return;

        this.stdout.writeText('Term v0.2');
    }

    onInput(content) {
        for (let line of content.str().split('\n')) {
            this.queueCommand(line);
        }

        this.executeNext();
    }

    onEOF() {
        // ignore when there's still command running
        if (!this.commandRunning)
            super.onEOF();
    }

    onInterrupt() {
        if (!this.stdin.tty) {
            super.onInterrupt();
        }
    }

    onReturn(prog, code) {
        // ignore all but last program
        if (prog === prog.siblings[prog.siblings.length - 1]) {
            this.setPrompt(code);
        }

        if (prog.commandReturned()) {
            this.commandRunning = false;
            this.executeNext();

            // exit when last command ended, and no more input
            if (this.commands.length === 0 && this.stdin.state === TERMINATED)
                this.exit();
        }
    }

    queueCommand(str) {
        // TODO: parse parameters
        let params = str.split(' ').filter(e => e.length !== 0);

        // FIXME: move to execution
        // // resolve variables
        // // TODO: merge with parsing for in-line usage
        // for (let i = params.length - 1; i >= 0; --i) {
        //     if (params[i][0] === '$') {
        //         let val = this.variables.get(params[i].substr(1));
        //         params[i] = val || '';
        //     }
        // }

        // FIXME: move to execution
        // // process variable assignments
        // while (params.length > 0) {
        //     let idx = params[0].indexOf('=');
        //     if (idx === -1)
        //         break;

        //     let name = params[0].substr(0, idx);
        //     let value = params[0].substr(idx + 1);
        //     this.variables.set(name, value);
        //     params.shift();
        // }

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

        // detect pipe syntax errors
        if (programs.some(e => e.length === 0)) {
            this.stderr.writeText('sh: invalid pipe');
            this.setPrompt(1);
            return;
        }

        this.commands.push(programs);
    }

    executeNext() {
        if (this.commandRunning || this.commands.length === 0)
            return;

        this.commandRunning = true;

        let programs = this.commands.shift();
        let processes = programs.map(e => this.createProcess(e[0]));

        // detect non-existent processes
        if (processes.some(e => !e)) {
            this.setPrompt(127);
            return;
        }

        let args = programs.map(e => e.slice(1));

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

    onInput(content) {
        try {
            for (let item of content.items())
                this.stdout.write(new ObjectOutput(eval(item.str())));
        } catch (e) {
            this.stderr.writeText(e.toString());
        }
    }
}

class Cat extends Program {
    onExecute(file) {
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

    onInput(content) {
        this.stdout.write(content);
    }
}

class Tee extends Program {
    onExecute(file) {
        this.content = [];
        this.file = file;
        this.inputEnabled = true;
    }

    onInput(content) {
        this.content.push(content.str());
        this.stdout.write(content);
        localStorage.setItem(this.file, this.content.join('\n'));
    }
}

class List extends Program {
    onExecute() {
        let list = Object.keys(localStorage).map(e => new TextOutput(e));
        this.stdout.write(new ArrayOutput(list));
        return 0;
    }
}

class Remove extends Program {
    onExecute(file) {
        if (!file) {
            this.stderr.writeText('rm: missing operand');
            return 1;
        }

        localStorage.removeItem(file);
        return 0;
    }
}

class Curl extends Program {
    onExecute(url) {
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
            this.stdout.writeText(this.req.responseText);
            this.exit();
        };
        this.req.send();
    }

    onInterrupt() {
        this.req.abort();
        super.onInterrupt();
    }
}

class Head extends Program {
    onExecute(counter) {
        this.counter = Number.parseInt(counter);

        if (Number.isNaN(this.counter)) {
            this.stderr.writeText('head: invalid number of items');
            return 1;
        }

        if (this.counter <= 0)
            return 0;

        this.inputEnabled = true;
    }

    onInput(content) {
        let items = content.items().slice(0, this.counter);
        this.stdout.write(new ArrayOutput(items));
        this.counter -= items.length;

        if (this.counter === 0) {
            this.exit(0);
            return;
        }
    }
}

class Tail extends Program {
    onExecute(counter) {
        this.counter = Number.parseInt(counter);

        if (Number.isNaN(this.counter)) {
            this.stderr.writeText('tail: invalid number of items');
            return 1;
        }

        if (this.counter <= 0)
            return 0;

        this.inputEnabled = true;
        this.items = [];
    }

    onInput(content) {
        for (let item of content.items()) {
            if (this.items.length === this.counter)
                this.items.shift();

            this.items.push(item);
        }
    }

    onEOF() {
        this.stdout.write(new ArrayOutput(this.items));
        this.exit(0);
    }
}

class Sleep extends Program {
    onExecute(time) {
        let t = Number.parseFloat(time);

        if (Number.isNaN(t)) {
            this.stderr.writeText('sleep: invalid time');
            return 1;
        }

        this.handle = setTimeout(() => {
            this.exit();
        }, t * 1000);
    }

    onInterrupt() {
        clearTimeout(this.handle);
        super.onInterrupt();
    }
}

class Clear extends Program {
    onExecute() {
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
