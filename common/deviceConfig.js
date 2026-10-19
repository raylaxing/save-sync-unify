let fs = require('fs');
let path = require('path');
let isReachable = require('is-reachable');
let ftp = require('basic-ftp');

const TYPES = ['ftp', 'local'];
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const BROWSE_IDLE_MS = 60000;

/*********************
 * SHAPING / OUTPUT  *
 *********************/

let parseJSON = function(str, fallback){
    if(!str) return fallback;
    try { return JSON.parse(str); } catch(e) { return fallback; }
};

//Converts a DB row into the shape the config page edits (passwords never leave the server)
let toEditable = function(row){
    let paths = parseJSON(row.paths, {});
    let exts = parseJSON(row.extensionSearch, {});
    let romDir = parseJSON(row.romDir, {});
    return {
        id: row.id,
        device: row.device,
        name: row.name,
        type: row.type,
        ftpAddress: row.ftpAddress || '',
        ftpAddressVpn: row.ftpAddressVpn || '',
        ftpPort: row.ftpPort || '',
        ftpUser: row.ftpUser || '',
        hasPassword: !!row.ftpPW,
        localExistCheck: row.localExistCheck || '',
        platforms: Object.keys(paths).map(function(k){
            return {
                code: k,
                path: paths[k] || '',
                extensions: (exts[k] || []).map(normaliseExt).filter(Boolean),
                romDir: romDir[k] || ''
            };
        })
    };
};

//".SRM", "*.srm", " srm " -> "srm" (the copy code adds the dot itself)
let normaliseExt = function(ext){
    return `${ext || ''}`.trim().replace(/^\*?\.+/, '');
};

let normalisePath = function(p){
    p = `${p || ''}`.trim().replace(/\\/g, '/');
    if(p.length > 1) p = p.replace(/\/+$/, '');
    return p;
};

/*************
 * VALIDATE  *
 *************/

//Returns {errors, row} - errors is keyed by field ("platforms.0.path" for platform rows)
let validate = async function(input, existingRow, allRows, knownPlatformCodes){
    let errors = {};
    let isNew = !existingRow;

    let name = `${input.name || ''}`.trim();
    if(!name) errors.name = 'Give the device a name';

    //Device ID is referenced by mappings, discovery prefs, TEMP folders and plugins - fixed once created
    let device = isNew ? `${input.device || ''}`.trim() : existingRow.device;
    if(isNew){
        if(!device) errors.device = 'ID is required';
        else if(!ID_PATTERN.test(device)) errors.device = 'Use only letters, numbers, - and _';
        else if(allRows.some(r => r.device.toLowerCase() === device.toLowerCase())) errors.device = 'Another device already uses this ID';
    }

    let type = input.type;
    if(TYPES.indexOf(type) === -1) errors.type = 'Choose FTP or Local';

    let row = {device, name, type};

    if(type === 'ftp'){
        let address = `${input.ftpAddress || ''}`.trim().replace(/^ftp:\/\//i, '').replace(/\/+$/, '');
        if(!address) errors.ftpAddress = 'Address is required';
        else if(/[\s/]/.test(address)) errors.ftpAddress = 'Just the host or IP, e.g. 192.168.1.20';

        let vpn = `${input.ftpAddressVpn || ''}`.trim().replace(/^ftp:\/\//i, '').replace(/\/+$/, '');
        if(vpn && /[\s/]/.test(vpn)) errors.ftpAddressVpn = 'Just the host or IP';

        let port = `${input.ftpPort || ''}`.trim() || '21';
        if(!/^\d+$/.test(port) || +port < 1 || +port > 65535) errors.ftpPort = 'Port must be 1-65535';

        row.ftpAddress = address;
        row.ftpAddressVpn = vpn;
        row.ftpPort = port;
        row.ftpUser = `${input.ftpUser || ''}`.trim();
        //Blank password on an existing device means "keep the current one"
        row.ftpPW = input.ftpPW ? input.ftpPW : (existingRow && !input.clearPassword ? existingRow.ftpPW : '');
        row.localExistCheck = '';
    }else if(type === 'local'){
        let check = normalisePath(input.localExistCheck);
        if(!check) errors.localExistCheck = 'Pick a folder that only exists on this drive';
        else if(!check.startsWith('/')) check = '/' + check;
        row.localExistCheck = check;
        row.ftpAddress = row.ftpAddressVpn = row.ftpPort = row.ftpUser = row.ftpPW = '';
    }

    let platforms = Array.isArray(input.platforms) ? input.platforms : [];
    if(platforms.length === 0) errors.platforms = 'Add at least one platform';

    let paths = {}, extensionSearch = {}, romDir = {};
    let seen = {};
    platforms.forEach(function(p, i){
        let code = `${p.code || ''}`.trim();
        //Match an existing platform code case-insensitively so "gba" and "GBA" don't become two platforms
        let known = knownPlatformCodes.find(k => k.toLowerCase() === code.toLowerCase());
        if(known) code = known;

        if(!code) errors[`platforms.${i}.code`] = 'Platform is required';
        else if(!ID_PATTERN.test(code)) errors[`platforms.${i}.code`] = 'Use only letters, numbers, - and _';
        else if(seen[code.toLowerCase()]) errors[`platforms.${i}.code`] = 'This platform is listed twice';
        seen[code.toLowerCase()] = true;

        let savePath = normalisePath(p.path);
        if(!savePath) errors[`platforms.${i}.path`] = 'Choose the save folder';

        let exts = (Array.isArray(p.extensions) ? p.extensions : `${p.extensions || ''}`.split(/[\s,]+/))
            .map(normaliseExt).filter(Boolean);
        exts = exts.filter((x, idx) => exts.indexOf(x) === idx);
        if(exts.some(x => /[\/\\*?]/.test(x))) errors[`platforms.${i}.extensions`] = 'Extensions only, e.g. srm, sav';

        paths[code] = savePath;
        extensionSearch[code] = exts;
        let rom = normalisePath(p.romDir);
        if(rom) romDir[code] = rom;
    });

    row.paths = JSON.stringify(paths);
    row.extensionSearch = JSON.stringify(extensionSearch);
    row.romDir = Object.keys(romDir).length ? JSON.stringify(romDir) : '';

    return {errors, row};
};

/****************************
 * CONNECTIONS FOR BROWSING *
 ****************************/

//Resolves the FTP credentials to use - a blank password falls back to the saved one
let ftpCredentials = async function(input){
    let pw = input.ftpPW;
    if(!pw && input.id && !input.clearPassword){
        let row = await c.db.getDevice(input.id);
        if(row) pw = row.ftpPW;
    }
    return {
        host: `${input.ftpAddress || ''}`.trim().replace(/^ftp:\/\//i, ''),
        vpn: `${input.ftpAddressVpn || ''}`.trim().replace(/^ftp:\/\//i, ''),
        port: +(input.ftpPort || 21),
        user: `${input.ftpUser || ''}`.trim() || 'anonymous',
        password: pw || ''
    };
};

//One cached FTP client for browsing, so clicking through folders doesn't log in every time.
//Requests are queued because a basic-ftp client can only do one thing at a time.
let browseSession = null;
let browseQueue = Promise.resolve();

let withBrowseClient = function(creds, fn){
    let run = async function(){
        let key = JSON.stringify(creds);
        if(!browseSession || browseSession.key !== key || browseSession.client.closed){
            if(browseSession) browseSession.client.close();
            browseSession = null;

            let client = new ftp.Client(15000);
            let host = creds.host;
            //Fall back to the VPN address if the main one isn't reachable
            if(creds.vpn && !(await isReachable(`${host}:${creds.port}`, {timeout: 3000}))) host = creds.vpn;
            await client.access({host, port: creds.port, user: creds.user, password: creds.password});
            browseSession = {key, client, home: await client.pwd(), host};
        }
        clearTimeout(browseSession.timer);
        let session = browseSession;
        try {
            return await fn(session);
        } finally {
            session.timer = setTimeout(function(){
                session.client.close();
                if(browseSession === session) browseSession = null;
            }, BROWSE_IDLE_MS);
        }
    };
    let result = browseQueue.then(run, run);
    browseQueue = result.catch(function(){});
    return result;
};

//Finds the mounted drive for a local device (same rules as the sync uses)
let localBase = async function(input){
    let probe = {localExistCheck: normalisePath(input.localExistCheck)};
    if(!probe.localExistCheck) throw new Error('Set the drive marker folder first');
    let found = await c.local.onlineCheck(probe);
    if(!found) throw new Error(`No mounted drive contains "${probe.localExistCheck}". Is it plugged in?`);
    return probe.basePath;
};

let summariseFiles = function(names){
    let exts = {};
    names.forEach(function(n){
        let m = n.match(/\.([^.]+)$/);
        if(m && !n.startsWith('.')) exts[m[1]] = (exts[m[1]] || 0) + 1;
    });
    return exts;
};

let sortNames = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'});

//Lists folders (and a summary of file extensions) at a path on the device
let browse = async function(input, browsePath){
    if(input.type === 'ftp'){
        let creds = await ftpCredentials(input);
        if(!creds.host) throw new Error('Set the FTP address first');
        return await withBrowseClient(creds, async function(session){
            let target = normalisePath(browsePath) || session.home;
            if(!target.startsWith('/')) target = path.posix.join(session.home, target);
            try{
                await session.client.cd(target);
            }catch(e){
                if(e.code === 550) throw new Error(`Folder not found: ${target}`);
                throw e;
            }
            let current = await session.client.pwd();
            let list = await session.client.list();
            let dirs = list.filter(x => x.isDirectory && !x.name.startsWith('.')).map(x => x.name).sort(sortNames);
            let files = list.filter(x => x.isFile).map(x => x.name);
            return {path: current, root: '/', dirs, extensions: summariseFiles(files), fileCount: files.length};
        });
    }
    if(input.type === 'local'){
        //Browsing a specific drive (to pick the marker folder) or the device's detected drive
        let base;
        if(input.drive){
            let drive = listDrives().find(d => d.path === input.drive);
            if(!drive) throw new Error('That drive is no longer mounted');
            base = drive.path;
        }else{
            base = await localBase(input);
        }
        //Local paths are stored relative to the drive, so keep browsing inside it
        let rel = path.posix.normalize('/' + normalisePath(browsePath));
        let abs = path.join(base, rel);
        if(!fs.existsSync(abs)) throw new Error(`Folder not found: ${rel}`);
        let entries = fs.readdirSync(abs, {withFileTypes: true});
        let dirs = entries.filter(x => x.isDirectory() && !x.name.startsWith('.')).map(x => x.name).sort(sortNames);
        let files = entries.filter(x => x.isFile()).map(x => x.name);
        return {path: rel, root: '/', drive: base, dirs, extensions: summariseFiles(files), fileCount: files.length};
    }
    throw new Error('Choose a device type first');
};

//Lists the drives under the mount folder, to help pick a local device's marker folder
let listDrives = function(){
    let drives = [];
    if(process.platform === 'win32'){
        for(let i = 0; i < 26; i++){
            let letter = String.fromCharCode(i + 65);
            if(fs.existsSync(`${letter}:/`)) drives.push({name: `${letter}:`, path: `${letter}:`});
        }
        return drives;
    }
    let roots = [`/media/${process.env.USER}`, `/run/media/${process.env.USER}`];
    roots.forEach(function(root){
        if(!fs.existsSync(root)) return;
        fs.readdirSync(root, {withFileTypes: true}).forEach(function(d){
            if(d.isDirectory()) drives.push({name: d.name, path: path.join(root, d.name)});
        });
    });
    return drives;
};

//Checks the device is reachable and that each platform's save folder exists
let test = async function(input){
    let result = {ok: false, steps: [], platforms: []};
    let platforms = Array.isArray(input.platforms) ? input.platforms : [];

    let checkPlatforms = async function(listFn){
        for(let i = 0; i < platforms.length; i++){
            let p = platforms[i];
            let exts = (Array.isArray(p.extensions) ? p.extensions : []).map(normaliseExt).filter(Boolean);
            if(!normalisePath(p.path)){
                result.platforms.push({code: p.code, ok: false, message: 'No folder set'});
                continue;
            }
            try{
                let listing = await listFn(p.path);
                let matching = exts.length === 0 ? listing.fileCount
                    : exts.reduce((sum, e) => sum + (listing.extensions[e] || 0), 0);
                let message = exts.length === 0
                    ? `Folder found, ${listing.fileCount} files at top level`
                    : `Folder found, ${matching} matching file(s) at top level` + (listing.dirs.length ? `, ${listing.dirs.length} subfolder(s)` : '');
                result.platforms.push({code: p.code, ok: true, message});
            }catch(e){
                result.platforms.push({code: p.code, ok: false, message: e.message});
            }
        }
    };

    try{
        if(input.type === 'ftp'){
            let creds = await ftpCredentials(input);
            if(!creds.host) throw new Error('Set the FTP address first');
            let reachable = await isReachable(`${creds.host}:${creds.port}`, {timeout: 5000});
            result.steps.push({ok: reachable, message: `${creds.host}:${creds.port} ${reachable ? 'is reachable' : 'did not respond'}`});
            if(!reachable && creds.vpn){
                let vpnReachable = await isReachable(`${creds.vpn}:${creds.port}`, {timeout: 5000});
                result.steps.push({ok: vpnReachable, message: `VPN ${creds.vpn}:${creds.port} ${vpnReachable ? 'is reachable' : 'did not respond'}`});
                reachable = vpnReachable;
            }
            if(!reachable) return result;

            let home = await withBrowseClient(creds, async s => s.home);
            result.steps.push({ok: true, message: `Logged in as ${creds.user} (home folder ${home})`});
        }else if(input.type === 'local'){
            let base = await localBase(input);
            result.steps.push({ok: true, message: `Drive found at ${base}`});
        }else{
            throw new Error('Choose a device type first');
        }
        await checkPlatforms(p => browse(input, p));
        result.ok = result.platforms.every(p => p.ok);
    }catch(e){
        result.steps.push({ok: false, message: e.message});
    }
    return result;
};

//Platform codes already in use (platforms table + other devices), for suggestions and case matching
let knownPlatforms = async function(rows){
    let named = await c.db.getPlatformNames() || [];
    let codes = {};
    named.forEach(p => codes[p.short] = p.name);
    rows.forEach(function(r){
        Object.keys(parseJSON(r.paths, {})).forEach(k => codes[k] ??= k);
    });
    return Object.keys(codes).sort(sortNames).map(k => ({code: k, name: codes[k]}));
};

module.exports = {
    toEditable,
    validate,
    browse,
    listDrives,
    test,
    knownPlatforms
};
