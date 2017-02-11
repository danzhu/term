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
        this.echo = true;
        this.history = [];
        this.variables = parent ? new Map(parent.variables) : new Map();

        this.stdin = term;
        this.stdout = term;
        this.stderr = term;
    }

    execute(args = []) {
        this.args = args;
        programs.push(this);

        let res = this.run.apply(this, args);

        if (typeof res === 'number')
            this.exit(res);
    }

    run() {
        // TODO: throw
    }

    eof() {
        this.exit();
    }

    terminate() {
        this.exit(130);
    }

    exit(code = 0) {
        // ignore exit request if already exited
        if (this != programs[programs.length - 1])
            return;

        programs.pop();

        // notify parent program
        let parent = programs[programs.length - 1];
        if (parent)
            parent.finish(this, code);
    }

    input(msg, error = false) {
        // ignore
    }

    finish(prog, code) {
        // ignore
    }

    writeRaw(content) {
        this.stdout.input(content);
    }

    writeText(msg) {
        this.stdout.input(escapeHTML(msg));
    }

    writeError(msg) {
        this.stderr.input(msg, true);
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
        this.inputContent = '';
        this.inputNewest = '';
        this.inputCursor = 0;
        this.inputHistory = 0;

        this.scrollOnInput = true;
        this.scrollOnOutput = false;

        // this.termElement = document.getElementById('term');
        this.promptElement = document.getElementById('prompt');
        this.inputElement = document.getElementById('input');
        this.outputElement = document.getElementById('output');
    }

    input(msg, error = false) {
        if (typeof msg !== 'string')
            msg = escapeHTML(msg.toString());

        if (!msg)
            msg = '\n';

        if (error)
            msg = span(msg, 'error');

        let div = document.createElement('pre');
        div.innerHTML = msg;
        this.outputElement.appendChild(div);

        if (this.scrollOnOutput)
            window.scrollTo(0, document.body.scrollHeight);
    }

    writeHistory(prompt, input) {
        this.input(
            span(prompt, 'prompt') +
            span(escapeHTML(input), 'input')
        );
    }

    changeOutput(msg) {
        this.outputElement.lastChild.innerHTML = msg;
    }

    clearInput() {
        this.inputNewest = this.inputContent = '';
        this.inputCursor = 0;
    }

    updateInput() {
        let prog = programs[programs.length - 1];

        this.promptElement.innerHTML = prog ? prog.prompt : '';

        if (!prog || !prog.inputEnabled) {
            this.inputElement.innerHTML = this.inputContent;
            return;
        }

        let content = this.inputContent;

        let cursor = '<span id="cursor">' +
            escapeHTML(content.substr(this.inputCursor, 1) || ' ') +
            '</span>';

        this.inputElement.innerHTML =
            escapeHTML(content.substr(0, this.inputCursor)) +
            cursor +
            escapeHTML(content.substr(this.inputCursor + 1));
    }
}

document.addEventListener('keypress', e => {
    let prog = programs[programs.length - 1];

    if (!prog || !prog.inputEnabled)
        return;

    if (e.keyCode === 13) { // Enter key
        if (prog.echo)
            prog.stdin.writeHistory(prog.prompt, term.inputContent);

        prog.input(term.inputContent);

        // remove duplicate history and add new entry
        if (term.inputContent.trim()) {
            let idx = prog.history.indexOf(term.inputContent);
            if (idx !== -1)
                prog.history.splice(idx, 1);
            prog.history.push(term.inputContent);
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
        window.scrollTo(0, document.body.scrollHeight);
});

document.addEventListener('keydown', e => {
    let prog = programs[programs.length - 1];

    if (!prog)
        return;

    // ctrl + c always works, even when input is disabled
    if (e.ctrlKey && e.key == 'c') {
        prog.stdin.clearInput();

        prog.terminate();

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

                prog.eof();
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

        case 'Tab':
            // TODO: completion
            break;

        default:
            // don't prevent other keys from functioning
            return;
    }

    e.preventDefault();

    if (term.scrollOnInput)
        window.scrollTo(0, document.body.scrollHeight);
});

class Shell extends Program {
    run(script) {
        this.writeText('Term v0.1');

        this.exitInput = 'exit';
        this.inputEnabled = true;

        this.finish(null, 0);
    }

    input(str) {
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
                this.writeText(this.history.join('\n'));
                break;

            case 'exit':
                let code = Number.parseInt(args[0]);
                if (Number.isNaN(code)) {
                    this.writeError('exit: ' + args[0] + ': numeric argument required');
                    code = 2;
                }
                this.exit(code);
                break;

            default:
                if (!bin[cmd]) {
                    this.writeError('command not found: ' + escapeHTML(cmd));
                    this.finish(null, 127);
                    break;
                }

                let prog = new bin[cmd](this);
                try {
                    prog.execute(args);
                } catch (e) {
                    this.writeError('sh: ' + e.toString());
                }
                break;
        }
    }

    terminate() {
        // ignore
    }

    finish(prog, code) {
        this.variables.set('?', code);
        this.prompt = code ? span('$ ', 'error') : '$ ';
    }
}

class Interpreter extends Program {
    run() {
        this.prompt = '> '
        this.inputEnabled = true;
    }

    input(str) {
        try {
            this.writeText(eval(str));
        } catch (e) {
            this.writeError(e);
        }
    }
}

class Cat extends Program {
    run(file) {
        if (!file) {
            this.inputEnabled = true;
            return;
        }

        let content = localStorage.getItem(file);
        if (content === null) {
            this.writeError('cat: ' + file + ': no such file');
            return 1;
        }

        this.writeText(content);
        return 0;
    }

    input(str) {
        this.writeText(str);
    }
}

class List extends Program {
    run() {
        let list = [];
        for (let name in localStorage)
            list.push(name);

        if (list.length !== 0)
            this.writeText(list);
        this.exit();
    }
}

class Remove extends Program {
    run(file) {
        if (!file) {
            this.writeError('rm: missing operand');
            return 1;
        }

        localStorage.removeItem(file);
        return 0;
    }
}

class Curl extends Program {
    run(url) {
        if (!url) {
            this.writeError('curl: missing url');
            return 1;
        }

        let req = new XMLHttpRequest();
        req.open('GET', url);
        req.onreadystatechange = () => {
            if (req.status != 200) {
                this.exit(1);
                return;
            }
            this.writeText(req.responseText);
            this.stdin.updateInput();
            this.exit();
        };
        req.send();
    }
}

class Sleep extends Program {
    run(time) {
        if (!time) {
            this.writeError('sleep: missing operand');
            return 1;
        }

        setTimeout(() => {
            this.exit();
            this.stdin.updateInput();
        }, Number.parseFloat(time) * 1000);
    }
}

class Echo extends Program {
    run() {
        this.writeText([...arguments].join(' '));
        return 0;
    }
}

class Print extends Program {
    run() {
        this.writeRaw([...arguments].join(' '));
        return 0;
    }
}

class Clear extends Program {
    run() {
        const output = document.getElementById('output');
        while (output.lastChild)
            output.removeChild(output.lastChild);

        return 0;
    }
}

class False extends Program {
    run() {
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
term = new Term();

let sh = new Shell();
programs.push(sh);
sh.run(['-']);
term.updateInput();
