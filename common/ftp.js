let isReachable = require('is-reachable');
let ftp = require('basic-ftp');
let fs = require('fs');
let path = require('path');

//Reachability timeout - LAN devices answer in milliseconds, so don't wait long on offline ones
const REACHABLE_TIMEOUT = 5000;

//Open FTP connections, keyed by device id, so platforms/files on the same device share one login
let pool = {};

let  newConnection = function () {
    return new Promise(function (resolve, reject) {
        let client = new ftp.Client();
        client.ftp.verbose=false//true;
        resolve(client)
    });
};

//Returns an open client for the device, reusing the existing connection if still alive
let getConnection = async function(device){
    let entry = pool[device.device];
    if(entry && !entry.client.closed) return entry;

    let client = await newConnection();
    await client.access({
        host: device.ftpAddress,
        user: device.ftpUser,
        password: device.ftpPW,
        port: device.ftpPort
    });

    //Remember login directory so relative config paths resolve the same on a reused connection
    entry = {client, home: await client.pwd()};
    pool[device.device] = entry;
    return entry;
};

//Close the device's pooled connection (call when finished with a batch of transfers)
let releaseConnection = function(device){
    let entry = pool[device.device];
    if(entry) entry.client.close();
    delete pool[device.device];
};

let resolvePath = function(home, p){
    return p.startsWith('/') ? p : path.posix.join(home, p);
};

//Checks URL and returns if it's alive or not
let onlineCheck = async function(device){
    let available =  await isReachable(`${device.ftpAddress}:${device.ftpPort}`, {timeout:REACHABLE_TIMEOUT});
    if(!available && device.ftpAddressVpn && device.ftpAddressVpn !== ''){
        //Check for VPN address is available and replace is available
        available = await isReachable(`${device.ftpAddressVpn}:${device.ftpPort}`, {timeout:REACHABLE_TIMEOUT});
        if(available) {
            device.ftpAddress = device.ftpAddressVpn;
            device.vpnActive = true
        }
    }
    return available;
};

//Recursively list remote files under dir, returning paths relative to it (skips dotfiles like glob did)
let listFiles = async function(client, dir, rel = ''){
    let files = [];
    //cd then list, as minimal servers (e.g. Wii ftpii) may not accept a path on LIST
    await client.cd(rel ? `${dir}/${rel}` : dir);
    let entries = await client.list();
    for(let i = 0; i < entries.length; i++){
        let entry = entries[i];
        if(entry.name.startsWith('.')) continue;
        let entryPath = rel ? `${rel}/${entry.name}` : entry.name;
        if(entry.isDirectory){
            files = files.concat(await listFiles(client, dir, entryPath));
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
    let found = searchExts.length === 0 ? remoteFiles
        : searchExts.flatMap(ext => remoteFiles.filter(f => f.endsWith(`.${ext}`)));

    let report = device.reportProgress || function(){};
    for(let e = 0; e < found.length; e++){
        let rootPath = found[e];
        report({done: e, total: found.length, file: rootPath});
        let tempPath = `./TEMP/${device.device}/${k}/${rootPath}`;
        fs.mkdirSync(path.dirname(tempPath), {recursive:true});
        await client.downloadTo(tempPath, `${searchPath}/${rootPath}`);
        device.fileList[k].push({
            temp: tempPath,
            rootPath
        });
    }
    report({done: found.length, total: found.length, file: ''});

    return device
}

let copyFromTemp = async function(device, destination){

    //Local File
    let copyFromPath = destination.newSave;

    let {client, home} = await getConnection(device);

    //FTP File to be overwritten
    let deviceDir = resolvePath(home, device.paths[destination.platform]);
    let deviceFile = destination.path

    //Copy file from temp directory to ftp directory
    let result = await client.uploadFrom(copyFromPath, `${deviceDir}/${deviceFile}`);

    //If result.code === 226 (successful) return true
    return result.code === 226 ? true : false

}

let copyRom = async function(copyFromPath, deviceFile, device){

    let {client} = await getConnection(device);

    //Copy file from temp directory to ftp directory
    let result = await client.uploadFrom(copyFromPath, deviceFile);

    //If result.code === 226 (successful) return true
    return result.code === 226 ? true : false
}

module.exports={
    copyToTemp,
    copyFromTemp,
    onlineCheck,
    newConnection,
    releaseConnection,
    copyRom,
}
