let plugins = require('../plugins/exec.js').plugins();
let fs = require('fs');
let colors = require('colors');
let {zip} = require('zip-a-folder');

let parseObject = function(str){
    try {
        let value = JSON.parse(str);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch(e) {
        return {};
    }
};

//This get's the online devices and prepares them for continuing...
//onChecked(device) is called as each device's online check finishes (used for progress)
let getOnlineDevices = async function(config, mode, onChecked){
    //Check all devices at the same time so offline devices don't hold up the rest
    await Promise.all(config.map(async function(device){
        //Checks if device is alive or not, and sets online flag
        device.online = false;

        //Add base functions, and replace with plugin function if found
        device.functions = c[device.type];
        if(plugins[device.device])  device.pluginFunctions = plugins[device.device];

        device.online = await c[device.type].onlineCheck(device);
        if(onChecked) onChecked(device);

        //Parsing some of the JSON fields (blank or broken values become empty)
        device.paths = parseObject(device.paths);
        device.extensionSearch = parseObject(device.extensionSearch);
        device.platformList = Object.keys(device.paths);
        device.romDir = parseObject(device.romDir);
    }));
    return config
}

//Preps folders and copy files from device to temp
let prepareFiles = async function(devices){
    let monthTime = `${new Date().getMonth()}`
    c.functions.dirRemove('./TEMP');
    c.functions.dirCreate('./TEMP');
    c.functions.dirCreate('./TEMP/ZIP')
    c.functions.dirCreate(`${process.env.REPO_PATH}/TRACE`);
    c.functions.dirCreate(`${process.env.REPO_PATH}/DEVICE/${c.functions.yearMonth()}`)


    //Gather from each device in parallel - transfers within a device stay sequential on one connection
    await Promise.all(devices.map(async function(device){
        let report = patch => c.progress.device(device.device, patch);
        report({status: 'gathering', platformCount: device.platformList.length, platformIndex: 0, done: 0, total: 0, file: ''});
        console.log(`Gathering files for ${device.name[{ftp:'cyan', sftp:'magenta'}[device.type] || 'green']}`)

        //Set up folders
        c.functions.dirCreate('./TEMP/'+device.device);
        for(let e = 0; e < device.platformList.length; e++){
            let k = device.platformList[e];
            c.functions.dirCreate(`./TEMP/${device.device}/${k}`);
            c.functions.dirCreate(`${process.env.REPO_PATH}/${k}`);
            c.functions.dirCreate(`${process.env.REPO_PATH}/TRACE/${k}`)
        }

        device.fileList = {};
        //Transfer modules call this per file: {done, total, file}
        device.reportProgress = report;
        try{
            for(let i = 0; i < device.platformList.length; i++){
                let k = device.platformList[i];
                report({platform: k, platformIndex: i, done: 0, total: 0, file: ''});
                if(device.pluginFunctions && device.pluginFunctions.copyToTemp && device.pluginFunctions.copyToTemp[k]){
                    device = await device.pluginFunctions.copyToTemp[k](device, k);
                }else if(typeof device.functions.copyToTemp === 'function'){
                    device = await device.functions.copyToTemp(device, k);
                }

                let newZipFile = `${c.functions.numberDate()}_${k}_${device.device}_${identity}.zip`
                await zip(`./TEMP/${device.device}/${k}`, `./TEMP/ZIP/${newZipFile}`)

                c.functions.copy(`./TEMP/ZIP/${newZipFile}`, `${process.env.REPO_PATH}/DEVICE/${c.functions.yearMonth()}/${newZipFile}`)
            }
            let fileCount = Object.values(device.fileList).reduce((sum, list) => sum + list.length, 0);
            report({status: 'done', platformIndex: device.platformList.length, file: '', fileCount});
        }catch(e){
            //One failing device shouldn't stop the others - its saves just won't be listed
            console.log(`Gathering from ${device.name} failed: ${e.message}`);
            device.gatherError = e.message;
            report({status: 'failed', error: e.message, file: ''});
        }finally{
            delete device.reportProgress;
            if(device.functions.releaseConnection) device.functions.releaseConnection(device);
        }
    }));

    c.progress.phase('Backing up');

    //Do the GIT for Backups - the zips are already saved, so a failed commit is only a warning
    try{
        if(await c.git.exists( `${process.env.REPO_PATH}/DEVICE/`)){
            await c.git.add(`${process.env.REPO_PATH}/DEVICE/`);
        }
    }catch(e){
        console.log(`Backup commit failed: ${e.message}`);
        c.progress.warn(`Backup zips were saved but not committed to git: ${e.message}`);
    }

    return devices
}

let syncTheSave = async function(source, pushList, online){
    let success = []

    //Update copied from repo date
    await c.db.updateRepoCopiedFrom(source.id);

    // Copy latest save to temp directories
    for(let i = 0; i < pushList.length; i++){
        let destination = pushList[i];

        //Copy file to destination temp directory (or repo)
        if(destination.device === 'repo'){
            destination.newSave =  `${process.env.REPO_PATH}${destination.path}`
        }else{
            destination.newSave =  destination.sessionPath + 'NEW'
        }
        c.functions.copy(source.sessionPath, destination.newSave);

        //If we're a repo... then that's it!
        if(destination.device === 'repo'){
            await c.db.updateRepoCopiedTo(destination.id);
            continue;
        } 

        //Create a backup trace file of file we are replacing
        let date = c.functions.makeDate().replace(/:/g, '.')
        c.functions.copy(destination.sessionPath, `${process.env.REPO_PATH}/TRACE/${destination.platform}/${date}_${destination.game}_${destination.deviceName}`)

        //Copy from temp to device (plugin function or standard)
        let device,res;
        for(let e = 0; e < online.length; e++){
            if(online[e].device === destination.device) device = online[e]
        }
        if(device.pluginFunctions && device.pluginFunctions.copyFromTemp && device.pluginFunctions.copyFromTemp[destination.platform]){
            res = await device.pluginFunctions.copyFromTemp[destination.platform](device, destination);
        }else{
            res = await device.functions.copyFromTemp(device, destination);
        }

        //Update copy info on repo
        if(res) await c.db.updateRepoCopiedTo(destination.id);
                
        //Push to success array
        success.push(res?'success':'failed')
    }

    //Close any connections opened while pushing
    for(let e = 0; e < online.length; e++){
        if(online[e].functions && online[e].functions.releaseConnection) online[e].functions.releaseConnection(online[e]);
    }

    //Do the GIT for Trace and Main REPO
    if(await c.git.exists( `${process.env.REPO_PATH}/TRACE/`)){
        await c.git.add(`${process.env.REPO_PATH}/TRACE/`);
    }
    if(await c.git.exists( `${process.env.REPO_PATH}`)){
        await c.git.add(`${process.env.REPO_PATH}`);
    }

    //If there were any failures, return false
    return success.indexOf('failed') === -1;
}


module.exports={
    getOnlineDevices,
    prepareFiles,
    syncTheSave
}