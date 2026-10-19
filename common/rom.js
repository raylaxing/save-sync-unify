let l = require('./local.js');

let fs = require('fs');
let repoPaths = {
    n64: "Nintendo 64",
    gb:"Gameboy & Gameboy Color",
    gba: ""
}
let config = {
    n64:{
        ext:['z64'],
        offset: 0x3b,
        bytes:4
    },
    gb:{
        ext:['gb','sgb','gbc'],
        offset: 0x0134,
        bytes:14
    }
}


let getRomRepoPath = async function(platform){
    if(process.platform === "win32"){
        //Windows Version
        var letter = l.getDriveLetter(`/${repoPaths[platform]}`);
        if (letter) {
            let basePath = letter+':'+`/${repoPaths[platform]}`;
            return basePath
        } else {
            return false
        }
    }
    else if(process.platform === "linux"){
        //Linux Version
        let sourceDir = l.getDriveDir("/media", `/${repoPaths[platform]}`);
        if(sourceDir){
            return sourceDir +  `/${repoPaths[platform]}`;
        }else{
            return false;
        }
    } else if (process.platform === 'darwin'){
        //Mac version...
        return false;
    }else{
        //What else are we running this on??
        return false;
    }
}

let readBytes = async function(length,offset, platformPath, file){
    let buffer = Buffer.alloc(length);
    let fd = fs.openSync(`${platformPath}/${file}`, 'r');
    fs.readSync(fd, buffer, 0, length, offset);
    fs.closeSync(fd);
    let id = buffer.toString('utf8').replace(/\u0000/g, "");
    return id;
}

let listRomsInRepo = async function(platform){
    let platformPath = await getRomRepoPath(platform);
    let fileList = fs.readdirSync(platformPath);
    let foundFileList = [];
    for(let i = 0; i < fileList.length; i++){
        let file = fileList[i];
        let ext = file.split('.')[file.split('.').length - 1].toLowerCase();
        if(config[platform].ext.indexOf(ext) === -1)continue;

        let offset = config[platform].offset; // Offset in bytes
        let length = config[platform].bytes; // Number of bytes to read

        let id = await  readBytes(length,offset, platformPath, file);
        let lookupName = await c.db.getGameFromID(id,platform);

         //Hacky...
         if(ext==='gbc'){
            let id2 = await readBytes(length-4,offset, platformPath, file);
            let lookupName2 = await c.db.getGameFromID(id2,platform, true);
            lookupName = lookupName2 === ''? lookupName:lookupName2
        }

        if(lookupName === ''){
            lookupName = id;
        }

        let newName = lookupName.replace(/[`~!@#$%^&*()_|+\=?;:'",.<>\{\}\[\]\\\/]/gi, '').replace('é','e');

        if ((file).indexOf('_ENG') !== -1) newName +=  '_ENG';
        let newFileName = newName + '.' + ext;
        let thisFile = {
            repoFile: `${platformPath}/${file}`,
            newFileName
        }
        foundFileList.push(thisFile);
    }
    return foundFileList;
}

//This needs to be FTP ready
let doRomsExists = async function(repoRoms, localDir){
    for(let i = 0; i < repoRoms.length; i++){
        let thisFile = repoRoms[i];
        let checkFile = `${localDir}/${thisFile.newFileName}`;
        thisFile.deviceFile = checkFile;
        thisFile.deviceDir = localDir;
        thisFile.found = fs.existsSync(checkFile);
    }
}

let getRomList = async function(device, platform){
    let repoRoms = await listRomsInRepo(platform);
    let copyToPath = `${device.basePath}${device.romDir[platform]}`;
    await doRomsExists(repoRoms, copyToPath);

    let found = [];
    let notFound = [];
    for(let i = 0; i < repoRoms.length; i++){
        repoRoms[i].found ? found.push(repoRoms[i]) : notFound.push(repoRoms[i]);
    }
    return{found,notFound};
}

let copyRoms = async function(romList, device){
    for(let i = 0; i < romList.length; i++){
        let thisRom = romList[i];
        await device.functions.copyRom(thisRom.repoFile, thisRom.deviceFile, device)
    }
    if(device.functions.releaseConnection) device.functions.releaseConnection(device);
    return true;
}

module.exports={
    getRomList,
    getRomRepoPath,
    copyRoms
}

//TO DO ... MAKE FTP READY
// ---- need to doRomExists and check exists via FTP
// ---- need to copyRoms to FTP device