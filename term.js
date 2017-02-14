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
        let pre = document.createElement('pre');
        pre.textContent = this.content || '\n';
        return pre;
    }

    items() {
        return [this];
    }
}

class RawOutput extends Output {
    print() {
        let pre = document.createElement('pre');
        pre.innerHTML = this.str();
        return pre;
    }

    items() {
        return this.content.split('\n').map(e => new RawOutput(e));
    }
}

class TextOutput extends Output {
    items() {
        return this.content.split('\n').map(e => new TextOutput(e));
    }
}

class ArrayOutput extends Output {
    constructor(content, format = null) {
        super(content);
        this.format = format;
    }

    str() {
        return this.content.map(e => e.str()).join('\n');
    }

    print() {
        let div = document.createElement('div');
        if (this.format)
            div.classList.add(this.format);
        for (let item of this.content)
            div.appendChild(item.print());
        return div;
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

const Async = {
    timeout(time) {
        let handle;
        let promise = new Promise((resolve, reject) => {
            handle = setTimeout(() => {
                resolve();
            }, time);
        });

        promise.abort = () => clearTimeout(handle);
        return promise;
    },

    request(method, url, timeout = 0) {
        let req;
        let promise = new Promise((resolve, reject) => {
            req = new XMLHttpRequest();
            req.open(method, url, true);
            if (timeout > 0)
                req.timeout = timeout;
            req.onreadystatechange = () => {
                if (req.readyState !== 4)
                    return;

                if (req.status != 200) {
                    reject(req.status);
                    return;
                }

                resolve(req.responseText);
            };
            req.send();
        });

        promise.abort = () => req.abort();
        return promise;
    },

    read(path) {
        let content = localStorage.getItem(path);
        if (content !== null)
            return Promise.resolve(content);
        else
            return Promise.reject(path + ': no such file');
    },

    write(path, content) {
        localStorage.setItem(path, content);
        return Promise.resolve();
    },

    append(path, content) {
        let prev = localStorage.getItem(path) || '';
        localStorage.setItem(path, prev + content);
        return Promise.resolve();
    },

    list(path) {
        return Promise.resolve(Object.keys(localStorage));
    },

    move(path, target) {
        let content = localStorage.getItem(path);
        if (content === null)
            return Promise.reject(path + ': no such file');

        localStorage.setItem(target, content);
        localStorage.removeItem(path);
        return Promise.resolve();
    },

    remove(path) {
        localStorage.removeItem(path);
        return Promise.resolve();
    }

    // TODO: async execute
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
        this.job = [this];
        this.variables = parent ? new Map(parent.variables) : new Map();

        this.state = READY;
        this.tty = false;
        this.inputEnded = false;

        if (parent) {
            this.stdin = parent.stdin;
            this.stdout = parent.stdout;
            this.stderr = parent.stderr;
        } else {
            this.stdin = this.stdout = this.stderr = null;
        }
    }

    execute(args = []) {
        if (this.state !== READY)
            return;

        this.state = RUNNING;
        this.args = args;

        this.stdin.stdout = this;

        if (this.parent)
            this.parent.children.add(this);

        let res = this.onExecute.apply(this, args);

        if (this.stdin.state === TERMINATED)
            this.eof();

        if (typeof res === 'number')
            this.exit(res);
    }

    eof() {
        if (this.state !== RUNNING || this.inputEnded)
            return;

        this.inputEnded = true;
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

        // if (!this.parent) {
        //     term.stdout = null;
        //     return;
        // }

        // restore control to parent process
        let input = this.parent.stdin;
        input.stdout = this.parent;
        input.updateInput();

        if (input.state === TERMINATED)
            this.eof();

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

    clearHistory() {
        // ignore
    }

    clearInput() {
        // ignore
    }

    updateInput() {
        // ignore
    }

    jobReturned() {
        return this.job.every(e => e.state === TERMINATED)
    }

    onExecute() {
        // ignore
    }

    onInput(content) {
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

    onReturn(prog, code) {
        // ignore
    }

    // TODO: args parsing API
}

class Term extends Program {
    constructor() {
        super();
        this.inputEnabled = true;
        this.tty = true;
        this.stdin = this.stdout = this;
        this.stderr = new TermError(this);

        this.inputContent = '';
        this.inputNewest = '';
        this.inputCursor = 0;

        this.scrollOnInput = true;
        this.scrollOnOutput = true;

        this.termElement = document.getElementById('term');
        this.promptElement = document.getElementById('prompt');
        this.inputElement = document.getElementById('input');
        this.outputElement = document.getElementById('output');

        // FIXME: this requires delicate sequencing - better ways?
        this.stderr.execute();

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

                // remove duplicate history and add new entry
                if (!prog.password && content.trim()) {
                    let idx = prog.history.indexOf(content);
                    if (idx !== -1)
                        prog.history.splice(idx, 1);
                    prog.history.push(content);
                }

                prog.writeText(this.inputContent);

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

            if (e.ctrlKey) {
                switch (e.key) {
                    case 'c':
                        this.clearInput();

                        // interrupt every process in job
                        for (let p of prog.job)
                            p.interrupt();
                        break;

                    case 'd':
                        // prevent EOF when input disabled or not on empty line
                        if (!prog.inputEnabled || this.inputContent !== '')
                            break;

                        // echo termination input if available
                        if (prog.echo || prog.exitInput)
                            this.writeHistory(prog.prompt, prog.exitInput);

                        prog.eof();
                        break;

                    case 'l':
                        this.clearHistory();
                        break;

                    case 'u':
                        if (!prog.inputEnabled)
                            break;

                        this.clearInput();
                        break;
                }

                this.updateInput();
                e.preventDefault();
                return;
            }

            if (!prog.inputEnabled)
                return;

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
        this.sh = new shell(this);
        this.sh.execute();
        this.updateInput();
    }

    onInput(content) {
        this.outputElement.appendChild(content.print());

        // FIXME: always scroll if at bottom
        if (this.scrollOnOutput)
            this.termElement.scrollTop = this.termElement.scrollHeight;
    }

    onEOF() {
        // ignore, since processes send EOF to stdout when exiting
    }

    onReturn(prog, code) {
        this.writeText('[returned ' + code.toString() + ']');
        this.inputEnabled = false;
        // TODO: maybe restart shell? Or close window?
    }

    writeHistory(prompt, input) {
        this.writeRaw(
            span(prompt, 'prompt') +
            span(escapeHTML(input), 'input')
        );
    }

    clearHistory() {
        while (this.outputElement.lastChild)
            this.outputElement.removeChild(this.outputElement.lastChild);
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
    constructor(parent) {
        super(parent);
        this.inputEnabled = true;
        this.tty = true;
        this.stderr = this;
    }

    onEOF() {
        // ignore
    }

    onInput(content) {
        this.stdout.writeRaw(span(escapeHTML(content.str()), 'error'));
    }
}

class Monitor extends Program {
    constructor(parent, callback, eof = null) {
        super(parent);
        this.callback = callback;
        this.ending = eof;
        this.inputEnabled = true;
    }

    onEOF() {
        if (this.ending)
            this.ending(this);
        else
            super.onEOF();
    }

    onInput(content) {
        this.callback(this, content);
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
        this.setReturnCode(0);

        this.jobRunning = false;
        this.jobs = [];
        // set to undefined to prevent writing history before loading
        this.historyPromise = undefined;
        this.loaded = false;
        this.script = null;
    }

    onExecute(script) {
        if (script) {
            this.script = script;
            Async.read(script).then(content => {
                // execute script

                this.inputEnabled = true;
                this.executeCommand(content);
            }, error => {
                // script not found

                this.stderr.writeText('sh: ' + error);
                this.exit(127);
            });
        } else if (this.stdin.tty) { // interactive
            Async.read('.config').then(content => {
                // config file found, execute it

                this.inputEnabled = true;
                this.executeCommand(content);
            }, error => {
                // no config file, show first-time usage help
                // TODO: actually show help messages

                this.stdout.writeText('Welcome to Term v0.3');
                this.inputEnabled = true;
                this.loaded = true;
                this.stdin.updateInput();
            });
        } else {
            // executing commands from stdin
            this.inputEnabled = true;
            this.loaded = true;
        }
    }

    onInput(content) {
        // TODO: history shortcuts

        if (this.historyPromise === null) {
            let hist = this.history.slice(this.history.length -
                Number.parseInt(this.variables.get('HIST_SIZE')) || 100);
            this.historyPromise = Async.write(this.variables.get('HIST_FILE'),
                hist.join('\n'));
            this.historyPromise.then(() => {
                this.historyPromise = null;
            }, error => {
                console.log('failed to write history file');
            });
        }

        this.executeCommand(content.str());
    }

    onEOF() {
        // exit with exit code of last job
        this.exit(this.exitCode);
    }

    onInterrupt() {
        if (!this.stdin.tty) {
            super.onInterrupt();
        }
    }

    onReturn(prog, code) {
        if (prog === prog.job[prog.job.length - 1]) {
            // set return code to exit code of last program
            this.setReturnCode(code);
        }

        if (prog.jobReturned()) {
            this.jobRunning = false;

            if (this.jobs.length !== 0) {
                // there are more jobs, do next one
                this.nextJob();
            } else if (this.stdin.state !== TERMINATED && !this.script) {
                // no more jobs right now and not running script, update input
                this.stdin.updateInput();

                if (this.loaded)
                    return;

                this.loaded = true;

                // initialize history
                let histFile = this.variables.get('HIST_FILE');
                if (histFile) {
                    // load history
                    Async.read(histFile).then(content => {
                        this.historyPromise = null;

                        if (!content)
                            return;

                        this.history = content.split(/\n/).concat(this.history);
                        this.historyIndex = this.history.length;
                    }, error => {
                        // ignore error
                        this.historyPromise = null;
                        console.log('failed to read history file');
                    });
                }
            } else {
                // last job ended and no more input, exit
                this.exit(this.exitCode);
            }
        }
    }

    executeCommand(content) {
        for (let line of content.split(/\n|;/)) {
            this.queueJob(line);
        }

        this.nextJob();
    }

    queueJob(str) {
        if (!str.trim())
            return;

        // TODO: parse parameters (e.g. quotes)
        let programs = str.split(/\|/).map(e => e.trim().split(/\s+/));

        // detect pipe syntax errors
        if (programs.some(e => e.length === 0)) {
            this.stderr.writeText('sh: invalid pipe');
            this.setReturnCode(1);
            return;
        }

        this.jobs.push(programs);
    }

    nextJob() {
        if (this.jobRunning || this.jobs.length === 0)
            return;

        let programs = this.jobs.shift();
        let processes = programs.map(e => this.createProcess(e[0]));

        // detect non-existent processes
        if (processes.some(e => !e)) {
            this.setReturnCode(127);
            return;
        }

        let args = programs.map(e => e.slice(1));

        this.jobRunning = true;

        for (let i = 0; i < processes.length; ++i) {
            processes[i].job = processes;
            if (i > 0)
                processes[i].stdin = processes[i - 1];
            if (i < processes.length - 1)
                processes[i].stdout = processes[i + 1];
        }

        // execute in reverse order so that input can be received
        // TODO: reverse order might be bad. Solutions?
        for (let i = processes.length - 1; i >= 0; --i) {
            processes[i].execute(args[i].map(e => {
                // resolve environment variables
                if (e[0] === '$')
                    return this.variables.get(e.substr(1));

                return e;
            }));
        }

        this.stdin.updateInput();
    }

    setReturnCode(code) {
        this.variables.set('?', code);
        this.prompt = code ? span('$ ', 'error') : '$ ';
        this.exitCode = code;
    }

    createProcess(cmd) {
        switch (cmd) {
            case 'history':
                return new Printer(this, this.history.join('\n'));

            case 'read':
                return new Monitor(this, (proc, content) => {
                    this.variables.set(proc.args[0], content.str());
                    proc.exit();
                });

            case 'echo':
                return new Caller(this, (proc) => {
                    proc.stdout.writeText(proc.args.join(' '));
                });

            case 'set':
                return new Caller(this, (proc) => {
                    let val = proc.args.slice(1).join(' ');
                    this.variables.set(proc.args[0], val);
                    proc.exit();
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

        // TODO: aliases

        if (!bin[cmd]) {
            this.stderr.writeText('sh: command not found: ' + cmd);
            return;
        }

        return new bin[cmd](this);
    }

    // TODO: source function
}

class Interpreter extends Program {
    constructor(parent) {
        super(parent);
        this.prompt = '> '
        this.inputEnabled = true;
    }

    onInput(content) {
        try {
            this.stdout.write(new ObjectOutput(eval(content.str())));
        } catch (e) {
            this.stderr.writeText(e.toString());
        }
    }
}

class Cat extends Program {
    onExecute() {
        let files = this.args;

        if (files.length === 0) {
            this.inputEnabled = true;
            return;
        }

        Promise.all(files.map(Async.read)).then(contents => {
            for (let content of contents)
                this.stdout.writeText(content);
            this.exit();
        }, error => {
            this.stderr.writeText('cat: ' + error);
            this.exit(1);
        });
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
        this.promise = Async.write(file, '');
        this.promise.then(() => this.promise = null);
    }

    onInput(content) {
        this.content.push(content.str());
        this.stdout.write(content);
        this.appendNext();
    }

    appendNext() {
        if (this.state !== RUNNING ||
            this.promise ||
            this.content.length === 0)
            return;

        let content = this.content.join('\n') + '\n';
        this.content = [];

        this.promise = Async.append(this.file, content);
        this.promise.then(() => {
            this.promise = null;
            this.appendNext();
        });
    }
}

class List extends Program {
    onExecute() {
        Async.list('.').then(files => {
            let list = files.map(e => new TextOutput(e));

            // FIXME: format will be lost when processed,
            // find a way to preserve overall formatting
            this.stdout.write(new ArrayOutput(list, 'multicolumn'));
            this.exit();
        }, error => {
            this.stderr.writeText('ls: ' + error);
            this.exit(1);
        });
    }
}

class Move extends Program {
    onExecute(path, target) {
        if (!path) {
            this.stderr.writeText('mv: missing file operand');
            return 1;
        }

        if (!target) {
            this.stderr.writeText('mv: missing destination file operand');
            return 1;
        }

        Async.move(path, target).then(() => {
            this.exit();
        }, error => {
            this.stderr.writeText('mv: ' + error);
            this.exit(1);
        });
    }
}

class Remove extends Program {
    onExecute() {
        let files = this.args;
        if (files.length === 0) {
            this.stderr.writeText('rm: missing operand');
            return 1;
        }

        Promise.all(files.map(Async.remove)).then(() => {
            this.exit();
        });
    }
}

class Curl extends Program {
    onExecute(url) {
        if (!url) {
            this.stderr.writeText('curl: missing url');
            return 1;
        }

        this.promise = Async.request('GET', url);
        this.promise.then(content => {
            // TODO: this can probably be removed
            if (this.state !== RUNNING)
                return;

            this.stdout.writeText(content);
            this.exit();
        }, error => {
            // TODO: error message
            this.exit(1);
        });
    }

    onInterrupt() {
        this.promise.abort();
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

class Grep extends Program {
    onExecute(regex) {
        if (regex === undefined) {
            this.stderr.writeText('grep: missing pattern');
            return 2;
        }

        this.inputEnabled = true;
        this.pattern = new RegExp(regex);
        this.matched = false;
    }

    onInput(content) {
        let matches = content.items().filter(e => this.pattern.test(e.str()));

        if (matches.length === 0)
            return;

        this.stdout.write(new ArrayOutput(matches));
        this.matched = true;
    }

    onEOF() {
        this.exit(this.matched ? 0 : 1);
    }
}

class Sleep extends Program {
    onExecute(time) {
        let t = Number.parseFloat(time);

        if (Number.isNaN(t)) {
            this.stderr.writeText('sleep: invalid time');
            return 1;
        }

        this.promise = Async.timeout(time * 1000);
        this.promise.then(() => this.exit());
    }

    onInterrupt() {
        this.promise.abort();
        super.onInterrupt();
    }
}

class Clear extends Program {
    onExecute() {
        this.stdout.clearHistory();
        return 0;
    }
}

const bin = {
    'sh': Shell,
    'js': Interpreter,
    'cat': Cat,
    'tee': Tee,
    'ls': List,
    'mv': Move,
    'rm': Remove,
    'curl': Curl,
    'head': Head,
    'tail': Tail,
    'grep': Grep,
    'sleep': Sleep,
    'clear': Clear
};

let term = null;

term = new Term();
term.execute([Shell]);
