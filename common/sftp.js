let isReachable = require('is-reachable');
let SftpClient = require('ssh2-sftp-client');
let fs = require('fs');
let path = require('path');

//Reachability timeout - LAN devices answer in milliseconds, so don't wait long on offline ones
const REACHABLE_TIMEOUT = 5000;
//Guards recursive listing against symlink loops (e.g. Android storage links)
const MAX_DEPTH = 10;

//Open SFTP connections, keyed by device id, so platforms/files on the same device share one login
let pool = {};

//Builds ssh2 connection options from a device row (sftp devices reuse the ftp* columns)
let connectOptions = function(device, host){
    let opts = {
        host: host || device.ftpAddress,
        port: +(device.ftpPort || 22),
        username: device.ftpUser || 'root',
        readyTimeout: 15000,
        //Some servers (e.g. Dropbear on handhelds) only accept passwords via keyboard-interactive
        tryKeyboard: true
    };
    if(device.ftpPW) opts.password = device.ftpPW;
    if(device.sshKey){
        let keyPath = device.sshKey.replace(/^~(?=\/)/, process.env.HOME || '');
        if(!fs.existsSync(keyPath)) throw new Error(`SSH key file not found: ${keyPath}`);
        opts.privateKey = fs.readFileSync(keyPath);
        if(device.ftpPW) opts.passphrase = device.ftpPW;
    }
    if(process.env.SSH_AUTH_SOCK) opts.agent = process.env.SSH_AUTH_SOCK;
    return opts;
};

//Connects and returns {client, home, closed()} - shared with the config page's browser
let connect = async function(device, host){
    let client = new SftpClient();
    let state = {closed: false};
    let opts = connectOptions(device, host);
    client.on('keyboard-interactive', function(name, instructions, lang, prompts, finish){
        finish(prompts.map(() => opts.password || ''));
    });
    client.on('close', () => state.closed = true);
    client.on('end', () => state.closed = true);
    await client.connect(opts);
    return {
        client,
        home: await client.realPath('.'),
        closed: () => state.closed,
        close: () => client.end().catch(() => {})
    };
};

//Returns an open connection for the device, reusing the existing one if still alive
let getConnection = async function(device){
    let entry = pool[device.device];
    if(entry && !entry.closed()) return entry;
    entry = await connect(device);
    pool[device.device] = entry;
    return entry;
};

//Close the device's pooled connection (call when finished with a batch of transfers)
let releaseConnection = function(device){
    let entry = pool[device.device];
    if(entry) entry.close();
    delete pool[device.device];
};

let resolvePath = function(home, p){
    return p.startsWith('/') ? p : path.posix.join(home, p);
};

//Lists a directory as {name, isDirectory, isFile}, following symlinks (Android's /sdcard is one)
let listDir = async function(client, dir){
    let entries = await client.list(dir);
    let out = [];
    for(let i = 0; i < entries.length; i++){
        let e = entries[i];
        let isDirectory = e.type === 'd', isFile = e.type === '-';
        if(e.type === 'l'){
            try{
                let target = await client.stat(`${dir}/${e.name}`);
                isDirectory = target.isDirectory;
                isFile = target.isFile;
            }catch(err){
                continue; //Broken link
            }
        }
        out.push({name: e.name, isDirectory, isFile});
    }
    return out;
};

//Checks URL and returns if it's alive or not
let onlineCheck = async function(device){
    let port = device.ftpPort || 22;
    let available =  await isReachable(`${device.ftpAddress}:${port}`, {timeout:REACHABLE_TIMEOUT});
    if(!available && device.ftpAddressVpn && device.ftpAddressVpn !== ''){
        //Check for VPN address is available and replace is available
        available = await isReachable(`${device.ftpAddressVpn}:${port}`, {timeout:REACHABLE_TIMEOUT});
        if(available) {
            device.ftpAddress = device.ftpAddressVpn;
            device.vpnActive = true
        }
    }
    return available;
};

//Recursively list remote files under dir, returning paths relative to it (skips dotfiles like glob did)
let listFiles = async function(client, dir, rel = '', depth = 0){
    let files = [];
    let entries = await listDir(client, rel ? `${dir}/${rel}` : dir);
    for(let i = 0; i < entries.length; i++){
        let entry = entries[i];
        if(entry.name.startsWith('.')) continue;
        let entryPath = rel ? `${rel}/${entry.name}` : entry.name;
        if(entry.isDirectory && depth < MAX_DEPTH){
            files = files.concat(await listFiles(client, dir, entryPath, depth + 1));
        }else if(entry.isFile){
            files.push(entryPath);
        }
    }
    return files;
};

let copyToTemp = async function(device, k){
    //Define Paths for transfer
    let searchExts = device.extensionSearch[k];
    device.fileList[k] = [];

    let {client, home} = await getConnection(device);
    let searchPath = resolvePath(home, `${device.paths[k]}`);

    //List the directory and only download files that match the save extensions
    let remoteFiles = await listFiles(client, searchPath);
    //No extensions set means copy every file (same as local devices)
    let extGroups = searchExts.length === 0 ? [null] : searchExts;
    for(let v = 0; v < extGroups.length; v++){
        let found = extGroups[v] === null ? remoteFiles : remoteFiles.filter(f => f.endsWith(`.${extGroups[v]}`));

        for(let e = 0; e < found.length; e++){
            let rootPath = found[e];
            let tempPath = `./TEMP/${device.device}/${k}/${rootPath}`;
            fs.mkdirSync(path.dirname(tempPath), {recursive:true});
            await client.get(`${searchPath}/${rootPath}`, tempPath);
            device.fileList[k].push({
                temp: tempPath,
                rootPath
            });
        }
    }

    return device
}

let copyFromTemp = async function(device, destination){
    try{
        let {client, home} = await getConnection(device);
        let deviceDir = resolvePath(home, device.paths[destination.platform]);
        await client.put(destination.newSave, `${deviceDir}/${destination.path}`);
        return true;
    }catch(e){
        console.log(`SFTP upload to ${device.name} failed: ${e.message}`);
        return false;
    }
}

let copyRom = async function(copyFromPath, deviceFile, device){
    try{
        let {client} = await getConnection(device);
        //fastPut uses parallel writes - much quicker for large ROMs, but not every server supports it
        try{
            await client.fastPut(copyFromPath, deviceFile);
        }catch(e){
            await client.put(copyFromPath, deviceFile);
        }
        return true;
    }catch(e){
        console.log(`SFTP ROM copy to ${device.name} failed: ${e.message}`);
        return false;
    }
}

module.exports={
    copyToTemp,
    copyFromTemp,
    onlineCheck,
    connect,
    listDir,
    releaseConnection,
    copyRom,
}
