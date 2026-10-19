/*****
 * Live progress of the "Start" gather, streamed to the web page over SSE.
 * Holds a single snapshot; every change is broadcast to subscribers.
 */
let EventEmitter = require('events');
let emitter = new EventEmitter();
emitter.setMaxListeners(50);

let state = {running: false, phase: '', devices: {}, order: [], warnings: []};

let emit = function(){
    emitter.emit('update', state);
};

let start = function(){
    state = {running: true, phase: 'Checking devices', started: Date.now(), devices: {}, order: [], warnings: []};
    emit();
};

let phase = function(text){
    state.phase = text;
    emit();
};

//Merge fields into a device's entry: {name, status, platform, platformIndex, platformCount, done, total, file, error}
let device = function(id, patch){
    if(!state.devices[id]){
        state.devices[id] = {};
        state.order.push(id);
    }
    Object.assign(state.devices[id], patch);
    emit();
};

//Non-fatal problems to show the user at the end (e.g. the backup commit failed)
let warn = function(message){
    state.warnings.push(message);
    emit();
};

let finish = function(error){
    state.running = false;
    state.phase = error ? `Failed: ${error.message || error}` : 'Done';
    state.finished = Date.now();
    emit();
};

let subscribe = function(fn){
    emitter.on('update', fn);
    return () => emitter.off('update', fn);
};

module.exports = {
    start,
    phase,
    device,
    warn,
    finish,
    subscribe,
    snapshot: () => state,
    isRunning: () => state.running
};
