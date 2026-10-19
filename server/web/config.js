/******************
 *     STATE      *
 ******************/
let state = {
    devices: [],
    platforms: [],      //[{code, name}] known platform codes for suggestions
    draft: null,        //Device being edited (null = list view)
    errors: {},
    dirty: false,
    idTouched: false,   //Stop auto-filling the ID once the user edits it
    found: {},          //Platform index -> extension counts seen in the picker
    test: null,
    busy: false
};
let picker = null;

/******************
 *    HELPERS     *
 ******************/
let esc = function(str){
    return `${str ?? ''}`.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
};

let post = async function(url, obj){
    let res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(obj)
    });
    let body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Request failed');
    return body;
};

//Network types - share the address/port/user/password fields
const DEFAULT_PORT = {ftp: '21', sftp: '22'};
let isRemote = type => type === 'ftp' || type === 'sftp';

let slugify = function(str){
    return `${str}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

let platformName = function(code){
    let p = state.platforms.find(x => x.code === code);
    return p && p.name !== code ? `${code} (${p.name})` : code;
};

//Device payload for browse/test - includes unsaved edits
let draftForServer = function(){
    let d = state.draft;
    return Object.assign({}, d, {platforms: d.platforms.map(p => Object.assign({}, p, {extensions: parseExts(p.extensionsText)}))});
};

let parseExts = function(text){
    return `${text || ''}`.split(/[\s,]+/).map(x => x.trim().replace(/^\*?\.+/, '')).filter(Boolean);
};

/******************
 *     LOADING    *
 ******************/
let load = async function(){
    let data = await (await fetch('/configData/getDevices')).json();
    state.devices = data.devices;
    state.platforms = data.platforms;
};

/******************
 *   LIST VIEW    *
 ******************/
let renderList = function(){
    let html = `
    <div class="toolbar">
        <button class="nes-btn" onClick="location.href='index.html'">Back</button>
        <button class="nes-btn is-primary" onClick="startEdit()">Add Device</button>
    </div>`;

    if(state.devices.length === 0){
        html += `<p>No devices yet. Add one to get started.</p>`;
    }

    state.devices.forEach(function(d){
        let where = isRemote(d.type)
            ? `${d.ftpUser && d.type === 'sftp' ? `${esc(d.ftpUser)}@` : ''}${esc(d.ftpAddress)}:${esc(d.ftpPort || DEFAULT_PORT[d.type])}${d.ftpAddressVpn ? ` (VPN ${esc(d.ftpAddressVpn)})` : ''}`
            : `Drive with ${esc(d.localExistCheck)}`;
        html += `
        <div class="nes-container with-title deviceCard">
            <h3 class="title">${esc(d.name)}</h3>
            <div class="deviceMeta">
                <span class="badge ${esc(d.type)}">${esc((d.type || '?').toUpperCase())}</span> ${where}
            </div>
            <div>${d.platforms.map(p => `<span class="badge" title="${esc(p.path)}">${esc(platformName(p.code))}</span>`).join('') || '<i>No platforms</i>'}</div>
            <div style="text-align:right;margin-top:10px">
                <button class="nes-btn" onClick="startEdit(${d.id})">Edit</button>
            </div>
        </div>`;
    });
    document.getElementById('content').innerHTML = html;
};

/******************
 *   EDIT VIEW    *
 ******************/
let startEdit = function(id){
    let source = state.devices.find(d => d.id === id);
    let d = source ? JSON.parse(JSON.stringify(source)) : {
        name: '', device: '', type: 'ftp',
        ftpAddress: '', ftpAddressVpn: '', ftpPort: '21', ftpUser: '', hasPassword: false, sshKey: '',
        localExistCheck: '', platforms: []
    };
    d.ftpPW = '';
    d.platforms.forEach(p => p.extensionsText = (p.extensions || []).join(', '));
    if(d.platforms.length === 0) d.platforms.push(newPlatform());

    state.draft = d;
    state.errors = {};
    state.dirty = false;
    state.idTouched = !!source;
    state.found = {};
    state.test = null;
    render();
    window.scrollTo(0, 0);
};

let newPlatform = function(){
    return {code: '', path: '', extensionsText: '', romDir: ''};
};

let fieldHtml = function(key, label, opts = {}){
    let d = state.draft;
    let err = state.errors[key];
    let value = opts.value !== undefined ? opts.value : d[key];
    let input = `<input class="nes-input" type="${opts.type || 'text'}" data-field="${key}" value="${esc(value)}"
        placeholder="${esc(opts.placeholder || '')}" ${opts.readonly ? 'readonly' : ''} autocomplete="off" />`;
    if(opts.button) input = `<div class="inputWithButton">${input}${opts.button}</div>`;
    return `
    <div class="field ${err ? 'has-error' : ''}">
        <label>${label}</label>
        ${input}
        ${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}
        ${err ? `<div class="err">${esc(err)}</div>` : ''}
    </div>`;
};

let platformHtml = function(p, i){
    let e = k => state.errors[`platforms.${i}.${k}`];
    let errLine = k => e(k) ? `<div class="err">${esc(e(k))}</div>` : '';
    let current = parseExts(p.extensionsText);
    let found = state.found[i] || {};
    let foundKeys = Object.keys(found).sort((a, b) => found[b] - found[a]);
    let canRemove = state.draft.platforms.length > 1;

    return `
    <div class="nes-container platformRow">
        ${canRemove ? `<button class="nes-btn is-error removePlatform" onClick="removePlatform(${i})">Remove</button>` : ''}
        <div class="row">
            <div class="field grow ${e('code') ? 'has-error' : ''}" style="flex:0 0 180px">
                <label>Platform</label>
                <input class="nes-input" list="platformCodes" data-platform="${i}" data-pfield="code" value="${esc(p.code)}" placeholder="GBA" autocomplete="off" />
                ${errLine('code')}
            </div>
            <div class="field grow ${e('extensions') ? 'has-error' : ''}">
                <label>Save extensions</label>
                <input class="nes-input" data-platform="${i}" data-pfield="extensionsText" value="${esc(p.extensionsText)}" placeholder="srm, sav" autocomplete="off" />
                ${errLine('extensions')}
            </div>
        </div>
        ${foundKeys.length ? `<div class="hint">Files in this folder (click to toggle):<br>
            ${foundKeys.map(k => `<span class="chip ${current.indexOf(k) !== -1 ? 'selected' : ''}" data-ext="${esc(k)}" onClick="toggleExt(${i}, this.dataset.ext)">.${esc(k)} (${found[k]})</span>`).join('')}
        </div>` : `<div class="hint">Leave blank to copy every file in the folder.</div>`}
        <div class="field ${e('path') ? 'has-error' : ''}" style="margin-top:16px">
            <label>Save folder</label>
            <div class="inputWithButton">
                <input class="nes-input" data-platform="${i}" data-pfield="path" value="${esc(p.path)}" placeholder="/RetroArch/saves" autocomplete="off" />
                <button class="nes-btn" onClick="openPicker('path', ${i})">Browse</button>
            </div>
            ${errLine('path')}
        </div>
        <div class="field" style="margin-bottom:0">
            <label>ROM folder <span class="hint">(optional)</span></label>
            <div class="inputWithButton">
                <input class="nes-input" data-platform="${i}" data-pfield="romDir" value="${esc(p.romDir)}" placeholder="Only needed for ROM copying" autocomplete="off" />
                <button class="nes-btn" onClick="openPicker('romDir', ${i})">Browse</button>
            </div>
        </div>
    </div>`;
};

let renderEditor = function(){
    let d = state.draft;
    let isNew = !d.id;
    let html = `
    <div class="toolbar">
        <button class="nes-btn" onClick="cancelEdit()">Back</button>
        <span>${isNew ? 'New device' : esc(d.name)}</span>
    </div>

    <datalist id="platformCodes">
        ${state.platforms.map(p => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}
    </datalist>

    <div class="nes-container with-title section">
        <h3 class="title">Device</h3>
        ${fieldHtml('name', 'Name', {placeholder: 'e.g. RG35XX Plus'})}
        ${fieldHtml('device', 'ID', {
            readonly: !isNew,
            hint: isNew ? 'Used internally and in saved mappings. Can\'t be changed later.' : 'Fixed - mappings and backups refer to this ID.'
        })}
        <div class="field typeChoice ${state.errors.type ? 'has-error' : ''}">
            <label>Connection</label>
            <label><input type="radio" class="nes-radio" name="type" value="ftp" ${d.type === 'ftp' ? 'checked' : ''} onChange="setType('ftp')" /><span>FTP (network)</span></label>
            <label><input type="radio" class="nes-radio" name="type" value="sftp" ${d.type === 'sftp' ? 'checked' : ''} onChange="setType('sftp')" /><span>SFTP (SSH)</span></label>
            <label><input type="radio" class="nes-radio" name="type" value="local" ${d.type === 'local' ? 'checked' : ''} onChange="setType('local')" /><span>Local (SD card / USB)</span></label>
            ${state.errors.type ? `<div class="err">${esc(state.errors.type)}</div>` : ''}
        </div>
    </div>

    <div class="nes-container with-title section">
        <h3 class="title">${{ftp: 'FTP', sftp: 'SFTP'}[d.type] || 'Drive'}</h3>
        ${isRemote(d.type) ? `
            <div class="row">
                <div class="grow">${fieldHtml('ftpAddress', 'Address', {placeholder: '192.168.1.20'})}</div>
                <div style="flex:0 0 120px">${fieldHtml('ftpPort', 'Port', {placeholder: DEFAULT_PORT[d.type]})}</div>
            </div>
            ${fieldHtml('ftpAddressVpn', 'VPN address <span class="hint">(optional)</span>', {
                placeholder: '100.x.x.x',
                hint: 'Used when the main address isn\'t reachable, e.g. a Tailscale IP.'
            })}
            <div class="row">
                <div class="grow">${fieldHtml('ftpUser', 'User', {placeholder: d.type === 'sftp' ? 'root' : 'anonymous'})}</div>
                <div class="grow">${fieldHtml('ftpPW', 'Password', {
                    type: 'password',
                    placeholder: d.hasPassword ? 'Saved - leave blank to keep' : ''
                })}</div>
            </div>
            ${d.type === 'sftp' ? fieldHtml('sshKey', 'Private key file <span class="hint">(optional)</span>', {
                placeholder: '~/.ssh/id_ed25519',
                hint: 'Path on this computer. The password is used as the key passphrase if set. A running ssh-agent is also tried.'
            }) : ''}
        ` : `
            ${fieldHtml('localExistCheck', 'Drive marker folder', {
                placeholder: '/Roms',
                button: `<button class="nes-btn" onClick="openPicker('marker')">Pick</button>`,
                hint: 'A folder that only exists on this device\'s card, so it can be recognised when mounted. Folder paths below are relative to the card.'
            })}
        `}
        <button class="nes-btn ${state.busy === 'test' ? 'is-disabled' : ''}" onClick="testDevice()">${state.busy === 'test' ? 'Testing...' : 'Test connection'}</button>
        ${testHtml()}
    </div>

    <div class="nes-container with-title section">
        <h3 class="title">Platforms</h3>
        ${state.errors.platforms ? `<div class="err" style="margin-bottom:16px">${esc(state.errors.platforms)}</div>` : ''}
        ${d.platforms.map(platformHtml).join('')}
        <button class="nes-btn" onClick="addPlatform()">+ Add platform</button>
    </div>

    <div class="actions">
        <div>
            ${!isNew ? `<button class="nes-btn is-error" onClick="deleteDevice()">Delete</button>` : ''}
        </div>
        <div>
            <span id="saveStatus"></span>
            <button class="nes-btn" onClick="cancelEdit()">Cancel</button>
            <button class="nes-btn is-success ${state.busy === 'save' ? 'is-disabled' : ''}" onClick="saveDevice()">${state.busy === 'save' ? 'Saving...' : 'Save'}</button>
        </div>
    </div>`;

    document.getElementById('content').innerHTML = html;
};

let testHtml = function(){
    let t = state.test;
    if(!t) return '';
    let line = (ok, msg) => `<div class="${ok ? 'ok' : 'bad'}">${ok ? '&#10003;' : '&#10007;'} ${esc(msg)}</div>`;
    return `<div class="testResult">
        ${t.steps.map(s => line(s.ok, s.message)).join('')}
        ${t.platforms.map(p => line(p.ok, `${p.code || '(no platform)'}: ${p.message}`)).join('')}
    </div>`;
};

let render = function(){
    state.draft ? renderEditor() : renderList();
};

/******************
 *  INPUT BINDING *
 ******************/
//Inputs update the draft directly, so typing never re-renders (keeps focus/cursor)
document.addEventListener('input', function(e){
    let el = e.target;
    let d = state.draft;
    if(!d) return;

    //Clear this field's validation error as soon as it's edited
    let errorKey = el.dataset.field || (el.dataset.pfield && `platforms.${el.dataset.platform}.${el.dataset.pfield === 'extensionsText' ? 'extensions' : el.dataset.pfield}`);
    if(errorKey && state.errors[errorKey]){
        delete state.errors[errorKey];
        let field = el.closest('.field');
        if(field){
            field.classList.remove('has-error');
            let err = field.querySelector('.err');
            if(err) err.remove();
        }
    }

    if(el.dataset.field){
        d[el.dataset.field] = el.value;
        if(el.dataset.field === 'device' && e.isTrusted) state.idTouched = true;
        if(el.dataset.field === 'name' && !d.id && !state.idTouched){
            d.device = slugify(el.value);
            let idInput = document.querySelector('[data-field="device"]');
            if(idInput){
                idInput.value = d.device;
                idInput.dispatchEvent(new Event('input', {bubbles: true}));
            }
        }
        state.dirty = true;
    }
    if(el.dataset.pfield){
        let p = d.platforms[+el.dataset.platform];
        p[el.dataset.pfield] = el.value;
        state.dirty = true;
        //Keep the found-extension chips in step with the text box
        if(el.dataset.pfield === 'extensionsText' && state.found[+el.dataset.platform]){
            let current = parseExts(el.value);
            el.closest('.platformRow').querySelectorAll('.chip').forEach(function(chip){
                chip.classList.toggle('selected', current.indexOf(chip.dataset.ext) !== -1);
            });
        }
    }
});

let setType = function(type){
    let d = state.draft;
    //Swap the default port when switching between FTP and SFTP, unless a custom one was entered
    if(isRemote(type) && (!d.ftpPort || d.ftpPort === DEFAULT_PORT[d.type])) d.ftpPort = DEFAULT_PORT[type];
    d.type = type;
    state.test = null;
    state.dirty = true;
    render();
};

let addPlatform = function(){
    state.draft.platforms.push(newPlatform());
    state.dirty = true;
    render();
};

let removePlatform = function(i){
    let p = state.draft.platforms[i];
    if((p.code || p.path) && !confirm(`Remove ${p.code || 'this platform'}?`)) return;
    state.draft.platforms.splice(i, 1);
    //Re-key found extensions and errors so they stay with their platform
    let found = {};
    Object.keys(state.found).forEach(k => { k = +k; if(k < i) found[k] = state.found[k]; if(k > i) found[k - 1] = state.found[k]; });
    state.found = found;
    state.errors = {};
    state.dirty = true;
    render();
};

let toggleExt = function(i, ext){
    let p = state.draft.platforms[i];
    let current = parseExts(p.extensionsText);
    let idx = current.indexOf(ext);
    idx === -1 ? current.push(ext) : current.splice(idx, 1);
    p.extensionsText = current.join(', ');
    delete state.errors[`platforms.${i}.extensions`];
    state.dirty = true;
    render();
};

let cancelEdit = function(){
    if(state.dirty && !confirm('Discard unsaved changes?')) return;
    state.draft = null;
    render();
};

/******************
 *    ACTIONS     *
 ******************/
let saveDevice = async function(){
    if(state.busy) return;
    state.busy = 'save';
    render();
    try{
        let res = await post('/configData/writeDevice', draftForServer());
        state.busy = false;
        if(!res.ok){
            state.errors = res.errors || {};
            render();
            let first = document.querySelector('.has-error, .err');
            if(first) first.scrollIntoView({behavior: 'smooth', block: 'center'});
            return;
        }
        await load();
        state.draft = null;
        render();
    }catch(e){
        state.busy = false;
        render();
        alert(`Save failed: ${e.message}`);
    }
};

let deleteDevice = async function(){
    let d = state.draft;
    let usage = await post('/configData/deviceUsage', {id: d.id});
    let msg = `Delete ${d.name}?`;
    if(usage.mappings) msg += `\n\n${usage.mappings} mapped save(s) point at this device. They will stay in the mapping table but won't sync.`;
    if(!confirm(msg)) return;
    await post('/configData/deleteDevice', {id: d.id});
    await load();
    state.draft = null;
    render();
};

let testDevice = async function(){
    if(state.busy) return;
    state.busy = 'test';
    state.test = null;
    render();
    try{
        state.test = await post('/configData/test', {device: draftForServer()});
    }catch(e){
        state.test = {steps: [{ok: false, message: e.message}], platforms: []};
    }
    state.busy = false;
    render();
};

/******************
 *  FOLDER PICKER *
 ******************/
//target: 'path' | 'romDir' (platform folders) or 'marker' (local drive marker)
let openPicker = async function(target, index){
    let d = state.draft;
    picker = {target, index, path: '', data: null, error: null, loading: true, drive: null, drives: null};

    if(target === 'marker'){
        //Choose a drive first, then a folder on it
        picker.path = '/';
        document.getElementById('picker').showModal();
        try{
            picker.drives = await (await fetch('/configData/drives')).json();
        }catch(e){
            picker.error = e.message;
        }
        picker.loading = false;
        renderPicker();
        return;
    }

    let start = target === 'path' ? d.platforms[index].path : d.platforms[index].romDir;
    //Start from the save folder when picking a ROM folder for the first time
    if(!start && target === 'romDir') start = d.platforms[index].path;
    if(!start) start = d.type === 'local' ? '/' : '';
    document.getElementById('picker').showModal();
    await browseTo(start, true);
};

let browseTo = async function(path, fallbackToRoot){
    picker.loading = true;
    picker.error = null;
    renderPicker();
    let device = draftForServer();
    if(picker.drive) device = {type: 'local', drive: picker.drive};
    try{
        picker.data = await post('/configData/browse', {device, path});
        picker.path = picker.data.path;
    }catch(e){
        //If the saved folder no longer exists, start from the top instead
        if(fallbackToRoot && path && path !== '/'){
            return browseTo(state.draft.type === 'local' || picker.drive ? '/' : '', false);
        }
        picker.error = e.message;
    }
    picker.loading = false;
    renderPicker();
};

let pickerUp = function(){
    let p = picker.path.replace(/\/+$/, '');
    let parent = p.substring(0, p.lastIndexOf('/')) || '/';
    browseTo(parent);
};

let pickerEnter = function(i){
    let name = picker.data.dirs[i];
    browseTo(`${picker.path.replace(/\/+$/, '')}/${name}`);
};

let pickerChooseDrive = function(i){
    picker.drive = picker.drives[i].path;
    browseTo('/');
};

let pickerSelect = function(){
    let d = state.draft;
    if(picker.target === 'marker'){
        d.localExistCheck = picker.path;
        delete state.errors.localExistCheck;
    }else{
        d.platforms[picker.index][picker.target] = picker.path;
        delete state.errors[`platforms.${picker.index}.${picker.target}`];
        if(picker.target === 'path' && picker.data) state.found[picker.index] = picker.data.extensions;
    }
    state.dirty = true;
    closePicker();
    render();
};

let closePicker = function(){
    document.getElementById('picker').close();
    picker = null;
};

let renderPicker = function(){
    if(!picker) return;
    let title = {path: 'Choose save folder', romDir: 'Choose ROM folder', marker: 'Choose drive marker folder'}[picker.target];
    let body = '';

    if(picker.target === 'marker' && !picker.drive){
        //Drive list
        body = picker.loading ? `<div class="pickerEmpty">Looking for drives...</div>`
            : picker.error ? `<div class="pickerEmpty bad">${esc(picker.error)}</div>`
            : !picker.drives.length ? `<div class="pickerEmpty">No mounted drives found. Plug in the SD card or USB drive and try again.</div>`
            : `<div class="pickerList">${picker.drives.map((dr, i) => `<div class="pickerItem" onClick="pickerChooseDrive(${i})">&#128190; ${esc(dr.name)}</div>`).join('')}</div>`;
        document.getElementById('pickerContent').innerHTML = `
            <p class="title">${title}</p>
            <p class="hint">Which drive is this device's card?</p>
            ${body}
            <div class="pickerFooter"><span></span><button class="nes-btn" onClick="closePicker()">Cancel</button></div>`;
        return;
    }

    let data = picker.data;
    if(picker.loading){
        body = `<div class="pickerEmpty">Loading...</div>`;
    }else if(picker.error){
        body = `<div class="pickerEmpty bad">${esc(picker.error)}</div>`;
    }else{
        let atRoot = picker.path === '/';
        body = `<div class="pickerList">
            ${!atRoot ? `<div class="pickerItem" onClick="pickerUp()">&#11013; ..</div>` : ''}
            ${data.dirs.map((name, i) => `<div class="pickerItem" onClick="pickerEnter(${i})">&#128193; ${esc(name)}</div>`).join('')}
            ${!data.dirs.length ? `<div class="pickerEmpty">No subfolders</div>` : ''}
        </div>`;
        let exts = Object.keys(data.extensions);
        body += `<div class="hint">${data.fileCount} file(s) here${exts.length ? ': ' + exts.map(k => `.${esc(k)} (${data.extensions[k]})`).join(', ') : ''}</div>`;
    }

    document.getElementById('pickerContent').innerHTML = `
        <p class="title">${title}</p>
        <div class="pickerPath">${picker.drive ? `${esc(picker.drive)} ` : ''}${esc(picker.path || '...')}</div>
        ${body}
        <div class="pickerFooter">
            <button class="nes-btn" onClick="closePicker()">Cancel</button>
            <button class="nes-btn is-primary ${picker.loading || picker.error ? 'is-disabled' : ''}" ${picker.loading || picker.error ? 'disabled' : ''} onClick="pickerSelect()">Use this folder</button>
        </div>`;
};

//Warn before leaving with unsaved changes
window.addEventListener('beforeunload', function(e){
    if(state.draft && state.dirty){
        e.preventDefault();
        e.returnValue = '';
    }
});

(async function(){
    try{
        await load();
        render();
    }catch(e){
        document.getElementById('content').innerHTML = `<p class="bad">Couldn't load devices: ${esc(e.message)}</p>`;
    }
})();
