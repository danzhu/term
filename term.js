'use strict';

let inputContent = '';
let inputNewest = '';
let inputCursor = 0;
let inputHistory = 0;

let programs = [];

function span(str, cls) {
    return '<span class="' + cls + '">' + str + '</span>';
}

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function writeOutput(msg) {
    const output = document.getElementById('output');

    if (typeof msg !== 'string')
        msg = escapeHTML(msg.toString());

    if (!msg)
        msg = '\n';

    let div = document.createElement('pre');
    div.innerHTML = msg;
    output.appendChild(div);
}

function writeError(msg) {
    writeOutput(span(msg, 'error'));
}

function writeHistory(prompt, input) {
    writeOutput(
        span(prompt, 'prompt') +
        span(escapeHTML(input), 'input')
    );
}

function changeOutput(msg) {
    const output = document.getElementById('output');

    output.lastChild.innerHTML = msg;
}

function clearInput() {
    inputNewest = inputContent = '';
    inputCursor = 0;
}

function updateInput() {
    const prompt = document.getElementById('prompt');
    const input = document.getElementById('input');
    let prog = programs[programs.length - 1];

    prompt.innerHTML = prog ? prog.prompt : '';

    if (!prog || !prog.inputEnabled) {
        input.innerHTML = inputContent;
        return;
    }

    let content = inputContent;

    let cursor = '<span id="cursor">' +
        escapeHTML(content.substr(inputCursor, 1) || ' ') +
        '</span>';

    input.innerHTML = escapeHTML(content.substr(0, inputCursor)) +
        cursor +
        escapeHTML(content.substr(inputCursor + 1));
}

function execute(prog, args = []) {
    prog.prompt = '';
    prog.exitInput = '';
    prog.echo = true;
    prog.history = [];
    prog.variables = this ? new Map(this.variables) : new Map();

    prog.exit = exit;
    prog.execute = execute;

    programs.push(prog);

    if (prog.init)
        prog.init(args);
}

function exit(code = 0) {
    // ignore exit request if already exited
    if (this != programs[programs.length - 1])
        return;

    programs.pop();

    if (this.end)
        this.end();

    // notify parent program
    let parent = programs[programs.length - 1];
    if (parent && parent.finish)
        parent.finish(this, code);
}

document.addEventListener('keypress', e => {
    let prog = programs[programs.length - 1];

    if (!prog || !prog.inputEnabled)
        return;

    if (e.keyCode === 13) { // Enter key
        if (prog.echo)
            writeHistory(prog.prompt, inputContent);

        if (prog.input)
            prog.input(inputContent);

        // remove duplicate history and add new entry
        if (inputContent.trim()) {
            let idx = prog.history.indexOf(inputContent);
            if (idx !== -1)
                prog.history.splice(idx, 1);
            prog.history.push(inputContent);
        }

        clearInput();
    } else {
        inputNewest = inputContent = inputContent.substr(0, inputCursor) +
            String.fromCharCode(e.which) +
            inputContent.substr(inputCursor);
        ++inputCursor;
    }

    inputHistory = prog.history.length;
    updateInput();
});

document.addEventListener('keydown', e => {
    let prog = programs[programs.length - 1];

    if (!prog)
        return;

    // ctrl + c always works, even when input is disabled
    if (e.ctrlKey && e.key == 'c') {
        clearInput();

        if (prog.terminate)
            prog.terminate();
        else
            prog.exit(130);

        updateInput();
        e.preventDefault();
        return;
    }

    if (!prog.inputEnabled)
        return;

    if (e.ctrlKey) {
        switch (e.key) {
            case 'd':
                // prevent EOF when not on empty line
                if (inputContent !== '')
                    break;

                // echo termination input if available
                if (prog.echo || prog.exitInput)
                    writeHistory(prog.prompt, prog.exitInput);

                if (prog.eof)
                    prog.eof();
                else
                    prog.exit();
                break;
        }

        updateInput();
        e.preventDefault();
        return;
    }

    switch (e.key) {
        case 'ArrowLeft':
            if (inputCursor <= 0)
                return;
            --inputCursor;
            break;

        case 'ArrowRight':
            if (inputCursor >= inputContent.length)
                return;
            ++inputCursor;
            break;

        case 'ArrowUp':
            if (inputHistory <= 0)
                return;
            --inputHistory;
            inputContent = prog.history[inputHistory];
            inputCursor = inputContent.length;
            break;

        case 'ArrowDown':
            if (inputHistory >= prog.history.length)
                return;

            ++inputHistory;
            inputContent = inputHistory === prog.history.length ?
                inputNewest :
                prog.history[inputHistory];
            inputCursor = inputContent.length;
            break;

        case 'Backspace':
            if (inputCursor <= 0)
                return;
            inputNewest = inputContent =
                inputContent.substr(0, inputCursor - 1) +
                inputContent.substr(inputCursor);
            --inputCursor;
            break;

        case 'Tab':
            e.preventDefault();
            break;

        default:
            return;
    }

    updateInput();
});

class Shell {
    init(args) {
        writeOutput('Term v0.1');

        this.exitInput = 'exit';
        this.inputEnabled = true;

        this.finish(0);
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

        let [prog, ...args] = params;

        switch (prog) {
            case 'history':
                writeOutput(this.history.map(escapeHTML).join('\n'));
                break;

            case 'exit':
                let code = Number.parseInt(args[0]);
                if (Number.isNaN(code)) {
                    writeError('exit: ' + args[0] + ': numeric argument required');
                    code = 2;
                }
                this.exit(code);
                break;

            default:
                if (bin[prog]) {
                    this.execute(new bin[prog](), args);
                } else {
                    writeError('command not found: ' + escapeHTML(prog));
                    this.finish(127);
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

class Interpreter {
    init(args) {
        this.prompt = '> '
        this.inputEnabled = true;
    }

    input(str) {
        try {
            writeOutput(eval(str));
        } catch (e) {
            writeError(e);
        }
    }
}

class Cat {
    init(args) {
        if (args.length === 0) {
            this.inputEnabled = true;
            return;
        }

        let content = localStorage.getItem(args[0]);
        if (content === null) {
            this.exit(1);
            writeError('cat: ' + args[0] + ': no such file');
            return;
        }

        writeOutput(content);
        this.exit();
    }

    input(str) {
        writeOutput(str);
    }
}

class List {
    init(args) {
        let list = [];
        for (let name in localStorage)
            list.push(name);

        if (list.length !== 0)
            writeOutput(list);
        this.exit();
    }
}

class Remove {
    init(args) {
        if (args.length === 0) {
            writeError('rm: missing operand');
            this.exit(1);
            return;
        }

        localStorage.removeItem(args[0]);
        this.exit();
    }
}

class Curl {
    init(args) {
        if (args.length === 0) {
            writeError('curl: missing url');
            this.exit(1);
            return;
        }

        let req = new XMLHttpRequest();
        req.open('GET', args[0]);
        req.onreadystatechange = () => {
            if (req.status != 200) {
                this.exit(1);
            }
            writeOutput(escapeHTML(req.responseText));
            this.exit();
            updateInput();
        };
        req.send();
    }
}

class Sleep {
    init(args) {
        if (args.length === 0) {
            writeError('sleep: missing operand');
            this.exit(1);
            return;
        }

        setTimeout(() => {
            this.exit();
            updateInput();
        }, Number.parseFloat(args[0]) * 1000);
    }
}

class Echo {
    init(args) {
        writeOutput(args.join(' '));
        this.exit();
    }
}

class Clear {
    init(args) {
        const output = document.getElementById('output');
        while (output.lastChild)
            output.removeChild(output.lastChild);

        this.exit();
    }
}

class False {
    init(args) {
        this.exit(1);
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
    'clear': Clear,
    'false': False
};

execute(new Shell());
updateInput();
