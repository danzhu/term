'use strict';

let programs = [];

function span(str, cls) {
    return '<span class="' + cls + '">' + str + '</span>';
}

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

class Program {
    constructor(parent = null) {
        this.prompt = '';
        this.exitInput = '';
        this.inputEnabled = false;
        this.echo = true;
        this.password = false;
        this.history = [];
        this.variables = parent ? new Map(parent.variables) : new Map();

        this.stdin = term;
        this.stdout = term;
        this.stderr = termErr;
    }

    execute(args = []) {
        this.args = args;
        programs.push(this);

        let res = this.onRun.apply(this, args);

        if (typeof res === 'number')
            this.exit(res);
    }

    exit(code = 0) {
        let idx = programs.indexOf(this);

        // ignore exit request if already exited
        if (idx === -1)
            return;

        // FIXME: this might not be the correct chain-terminate behaviour
        for (let i = programs.length - 1; i > idx; --i)
            programs[i].exit();

        programs.pop();

        let parent = programs[programs.length - 1];
        if (!parent)
            return;

        // reset input and notify parent program
        parent.stdin.clearInput();
        parent.onReturn(this, code);
    }

    onRun() {
        // TODO: throw
    }

    onEOF() {
        this.exit();
    }

    onTerminate() {
        this.exit(130);
    }

    onInput(msg, error = false) {
        // ignore
    }

    onReturn(prog, code) {
        // ignore
    }

    write(content) {
        if (!this.inputEnabled)
            return;
        this.onInput(content);
    }

    writeText(msg) {
        this.write(escapeHTML(msg));
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
        this.stdin = this.stdout = this.stderr = null;

        this.inputContent = '';
        this.inputNewest = '';
        this.inputCursor = 0;
        this.inputHistory = 0;

        this.scrollOnInput = true;
        this.scrollOnOutput = true;

        this.termElement = document.getElementById('term');
        this.promptElement = document.getElementById('prompt');
        this.inputElement = document.getElementById('input');
        this.outputElement = document.getElementById('output');
    }

    onInput(msg, error = false) {
        if (typeof msg !== 'string')
            msg = escapeHTML(msg.toString());

        if (!msg)
            msg = '\n';

        if (error)
            msg = span(msg, 'error');

        let div = document.createElement('pre');
        div.innerHTML = msg;
        this.outputElement.appendChild(div);

        // FIXME: always scroll if at bottom
        if (this.scrollOnOutput)
            this.termElement.scrollTop = this.termElement.scrollHeight;
    }

    writeHistory(prompt, input) {
        this.onInput(
            span(prompt, 'prompt') +
            span(escapeHTML(input), 'input')
        );
    }

    changeOutput(msg) {
        this.outputElement.lastChild.innerHTML = msg;
    }

    clearInput() {
        let prog = programs[programs.length - 1];

        this.inputNewest = this.inputContent = '';
        this.inputCursor = 0;
        if (prog)
            this.inputHistory = prog.history.length;
    }

    updateInput() {
        let prog = programs[programs.length - 1];

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
        this.stdin = this.stdout = this.stderr = null;
    }

    write(content) {
        term.write(span(content, 'error'));
    }
}

document.addEventListener('keypress', e => {
    let prog = programs[programs.length - 1];

    if (!prog || !prog.inputEnabled)
        return;

    if (e.keyCode === 13) { // Enter key
        if (prog.echo) {
            let content = prog.password ?
                '*'.repeat(term.inputContent.length) :
                term.inputContent;
            prog.stdin.writeHistory(prog.prompt, content);
        }

        let content = term.inputContent;

        prog.onInput(term.inputContent);

        // remove duplicate history and add new entry
        if (!prog.password && content.trim()) {
            let idx = prog.history.indexOf(content);
            if (idx !== -1)
                prog.history.splice(idx, 1);
            prog.history.push(content);
        }

        prog.stdin.clearInput();
    } else {
        term.inputNewest = term.inputContent =
            term.inputContent.substr(0, term.inputCursor) +
            String.fromCharCode(e.which) +
            term.inputContent.substr(term.inputCursor);
        ++term.inputCursor;
    }

    term.inputHistory = prog.history.length;
    prog.stdin.updateInput();

    if (term.scrollOnInput)
        term.termElement.scrollTop = term.termElement.scrollHeight;
});

document.addEventListener('keydown', e => {
    let prog = programs[programs.length - 1];

    if (!prog)
        return;

    // ctrl + c always works, even when input is disabled
    if (e.ctrlKey && e.key == 'c') {
        prog.stdin.clearInput();

        prog.onTerminate();

        prog.stdin.updateInput();
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
                    prog.stdin.writeHistory(prog.prompt, prog.exitInput);

                prog.onEOF();
                break;
        }

        prog.stdin.updateInput();
        e.preventDefault();
        return;
    }

    switch (e.key) {
        case 'ArrowLeft':
            if (term.inputCursor > 0) {
                --term.inputCursor;
                prog.stdin.updateInput();
            }
            break;

        case 'ArrowRight':
            if (term.inputCursor < term.inputContent.length) {
                ++term.inputCursor;
                prog.stdin.updateInput();
            }
            break;

        case 'ArrowUp':
            if (term.inputHistory > 0) {
                --term.inputHistory;
                term.inputContent = prog.history[term.inputHistory];
                term.inputCursor = term.inputContent.length;
                prog.stdin.updateInput();
            }
            break;

        case 'ArrowDown':
            if (term.inputHistory < prog.history.length) {
                ++term.inputHistory;
                term.inputContent = term.inputHistory === prog.history.length ?
                    term.inputNewest :
                    prog.history[term.inputHistory];
                term.inputCursor = term.inputContent.length;
                prog.stdin.updateInput();
            }
            break;

        case 'Backspace':
            if (term.inputCursor > 0) {
                term.inputNewest = term.inputContent =
                    term.inputContent.substr(0, term.inputCursor - 1) +
                    term.inputContent.substr(term.inputCursor);
                --term.inputCursor;
                prog.stdin.updateInput();
            }
            break;

        case 'Delete':
            if (term.inputCursor < term.inputContent.length) {
                term.inputNewest = term.inputContent =
                    term.inputContent.substr(0, term.inputCursor) +
                    term.inputContent.substr(term.inputCursor + 1);
                prog.stdin.updateInput();
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

class Shell extends Program {
    onRun(script) {
        this.stdout.writeText('Term v0.1');

        this.exitInput = 'exit';
        this.inputEnabled = true;

        this.onReturn(null, 0);
    }

    onInput(str) {
        str = str.trim();

        // TODO: parse parameters
        let params = str.split(' ').filter(e => e.length !== 0);

        // resolve variables
        // TODO: merge with parsing for in-line usage
        for (let i = params.length - 1; i >= 0; --i) {
            if (params[i][0] === '$') {
                let val = this.variables.get(params[i].substr(1));
                params[i] = val !== undefined ? val.toString() : '';
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

        let [cmd, ...args] = params;

        switch (cmd) {
            case 'history':
                this.stdout.writeText(this.history.join('\n'));
                break;

            case 'exit':
                let code = Number.parseInt(args[0]);
                if (Number.isNaN(code)) {
                    this.stderr.writeText('exit: ' +
                        args[0] + ': numeric argument required');
                    code = 2;
                }
                this.exit(code);
                break;

            default:
                if (!bin[cmd]) {
                    this.stderr.writeText('command not found: ' + cmd);
                    this.onReturn(null, 127);
                    break;
                }

                let prog = new bin[cmd](this);
                try {
                    prog.execute(args);
                } catch (e) {
                    this.stderr.writeText('sh: ' + e.toString());
                }
                break;
        }
    }

    onTerminate() {
        // ignore
    }

    onReturn(prog, code) {
        this.variables.set('?', code);
        this.prompt = code ? span('$ ', 'error') : '$ ';
    }
}

class Interpreter extends Program {
    onRun() {
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

class List extends Program {
    onRun() {
        let list = [];
        for (let name in localStorage)
            list.push(name);

        if (list.length !== 0)
            this.stdout.writeText(list);
        this.exit();
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

        let req = new XMLHttpRequest();
        req.open('GET', url);
        req.onreadystatechange = () => {
            if (req.status != 200) {
                this.exit(1);
                return;
            }
            this.stdout.writeText(req.responseText);
            this.stdin.updateInput();
            this.exit();
        };
        req.send();
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
            this.stdin.updateInput();
        }, Number.parseFloat(time) * 1000);
    }
}

class Echo extends Program {
    onRun() {
        this.stdout.writeText(this.args.join(' '));
        return 0;
    }
}

class Print extends Program {
    onRun() {
        this.writeRaw(this.args.join(' '));
        return 0;
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

class False extends Program {
    onRun() {
        return 1;
    }
}

const bin = {
    'sh': Shell,
    'js': Interpreter,
    'cat': Cat,
    'ls': List,
    'rm': Remove,
    'curl': Curl,
    'sleep': Sleep,
    'echo': Echo,
    'print': Print,
    'clear': Clear,
    'false': False
};

let term = null;
let termErr = null;
term = new Term();
termErr = new TermError();

let sh = new Shell();
sh.execute(['-']);
term.updateInput();
