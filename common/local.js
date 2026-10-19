let fs = require('fs-extra');
let globby = require('glob');

let getDriveLetter = function (dir) {
    for (var i = 0; i < 26; i++) {
        var letter = String.fromCharCode(i + 65)
        if (fs.existsSync(`${letter}:/${dir}`)) return letter
    }
};
let getDriveDir = function(mountDir, dir){
    if(fs.existsSync(mountDir)){
        //This is assuming the path will be /media/USER/DEVICE/...
	let pathWithUser = `${mountDir}/${process.env.USER}`
        if(fs.existsSync(mountDir) && fs.existsSync(pathWithUser)){
            let mountedDevices = fs.readdirSync(pathWithUser);
            for(let i = 0; i < mountedDevices.length; i++){
		    let thisDir = `${pathWithUser}/${mountedDevices[i]}`

                if(fs.existsSync(thisDir+dir)) return thisDir;
            }
        }
    }
};

let copyToTemp = async function(device, k){    

    let searchPath = `${device.basePath}/${device.paths[k]}`.replace('//','/');
    let searchExts = device.extensionSearch[k];
    device.fileList[k] = [];

    //Searches through FS for files with the correct extension
    let found = [];
    if(searchExts.length === 0){
        let list = await globby(`${searchPath}/**/*`);
        found = found.concat(list);
    }else{
        for(let v = 0; v < searchExts.length; v++){
            let list = await globby(`${searchPath}/**/*.${searchExts[v]}`);
            found = found.concat(list);
        }
    }

    //Copy files to temp
    let report = device.reportProgress || function(){};
    for(let v = 0; v < found.length; v++){
        let path = found[v].replace(/\\/g, '/');
        report({done: v, total: found.length, file: path.replace(searchPath + '/', '')});
        let rootPath = path.replace(searchPath, '').replace(searchPath+'/','');
        let tempPath = `./TEMP/${device.device}/${k}/${rootPath}`;
        fs.lstatSync(path).isDirectory() ? fs.copySync(path, tempPath) : fs.cpSync(path, tempPath);


        device.fileList[k].push({
            temp: tempPath,
            rootPath
        });
    }
    report({done: found.length, total: found.length, file: ''});

    return device;
}

let copyFromTemp = function(device, destination){

    let copyToPath = `${device.basePath}/${device.paths[destination.platform]}/${destination.path}`;
    let copyFromPath = destination.newSave;
    fs.copyFileSync(copyFromPath, copyToPath)
    
    return fs.existsSync(copyToPath);
}

let copyRom = function(repoRom, destinationRom){
    fs.copyFileSync(repoRom, destinationRom)
    return fs.existsSync(destinationRom);
}


module.exports={
    getDriveLetter,
    onlineCheck: async function(device){
        if(process.platform === "win32"){
            //Windows Version
            var letter = getDriveLetter(device.localExistCheck);
            if (letter) {
                device.basePath = letter+':';
                return true
            } else {
                return false
            }
        }
        else if(process.platform === "linux"){
            //Linux Version
            //Debian/Ubuntu mount under /media, udisks2 (Arch, Fedora) under /run/media
            let sourceDir = getDriveDir("/media", device.localExistCheck) || getDriveDir("/run/media", device.localExistCheck);
            if(sourceDir){
                device.basePath = sourceDir;
                return true;
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
    },
    copyToTemp,
    copyFromTemp,
    copyRom
}