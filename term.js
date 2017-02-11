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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function execute(prog, args) {
    prog.prompt = '';
    prog.exit = '';
    prog.echo = true;
    prog.history = [];
    programs.push(prog);

    if (prog.init)
        prog.init(args);
}

function exit(code = 0) {
    let prog = programs.pop();

    if (prog.end)
        prog.end();

    // notify parent program
    prog = programs[programs.length - 1];
    if (prog && prog.finish)
        prog.finish(code || 0);
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

    if (!prog || !prog.inputEnabled)
        return;

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
            if (e.ctrlKey) {
                switch (e.key) {
                    case 'd':
                        if (inputContent !== '')
                            break;

                        // echo termination input if available
                        if (prog.echo || prog.exit)
                            writeHistory(prog.prompt, prog.exit);

                        exit();
                        break;

                    case 'c':
                        clearInput();
                        if (prog.terminate)
                            prog.terminate();
                        else
                            exit(130);
                        break;
                }

                e.preventDefault();
                e.stopPropagation();
            } else {
                return;
            }
            break;
    }

    updateInput();
});

class Shell {
    init(args) {
        writeOutput('Term v0.1');

        this.exit = 'exit';
        this.inputEnabled = true;

        this.variables = new Map();
        this.finish(0);
    }

    input(str) {
        str = str.trim();

        // ignore empty command
        if (!str)
            return;

        // TODO: parse parameters
        let [prog, ...args] = str.split(' ').filter(e => e.length !== 0);

        for (let i = args.length - 1; i >= 0; --i) {
            if (args[i][0] === '$') {
                let val = this.variables.get(args[i].substr(1));
                args[i] = val ? val.toString() : '';
            }
        }

        switch (prog) {
            case 'history':
                writeOutput(this.history.map(escapeHTML).join('\n'));
                break;

            case 'exit':
                let code = Number.parseInt(args);
                exit(code);
                break;

            default:
                if (bin[prog]) {
                    execute(new bin[prog](), args);
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

    finish(code) {
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

        let content = window.localStorage.getItem(args[0]);
        if (content === null) {
            exit(1);
            writeError('cat: ' + args[0] + ': no such file');
            return;
        }

        writeOutput(content);
        exit();
    }

    input(str) {
        writeOutput(str);
    }
}

class Sleep {
    init(args) {
        setTimeout(() => {
            exit();
            updateInput();
        }, Number.parseInt(args[0]) * 1000);
    }
}

class Echo {
    init(args) {
        writeOutput(args.join(' '));
        exit();
    }
}

class Clear {
    init(args) {
        const output = document.getElementById('output');
        while (output.lastChild)
            output.removeChild(output.lastChild);

        exit();
    }
}

class False {
    init(args) {
        exit(1);
    }
}

const bin = {
    'sh': Shell,
    'js': Interpreter,
    'cat': Cat,
    'sleep': Sleep,
    'echo': Echo,
    'clear': Clear,
    'false': False
};

execute(new Shell());
updateInput();
