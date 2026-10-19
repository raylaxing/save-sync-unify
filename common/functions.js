let fs = require('fs');
let path = require('path');
let CRC32 = require('crc-32');

//This will only return ONLINE devices that are DISCOVERABLE
let getMasterList = function(deviceList){
    let cleanList = [];
    for(let i = 0; i < deviceList.length; i++){
        let x = deviceList[i];
        if(x.online && x.discover) cleanList.push(x);
    }
    return cleanList
}

let getRepo = async function(){
    let initlist = await c.db.getRepo();
    let repoList = {};
    for(let i = 0; i < initlist.length; i++){
        let entry = initlist[i];
        repoList[entry.platform] ??= {};
        repoList[entry.platform][entry.game] ??= [];
        repoList[entry.platform][entry.game].push(entry);
    }
    return repoList;
}

//If dir doesn't exist, create it
let dirCreate = function(dir){
    dir = path.join(dir);
    fs.mkdirSync(dir, {recursive: true}); //No error if it already exists (or another instance just made it)
}

let dirRemove = function(dir){
    dir = path.join(process.cwd(), dir);
    if(fs.existsSync(dir))fs.rmSync(dir, {recursive:true});

}

let getOnlinePlatformList = async function(online, choiceArray){
    let names = await c.db.getPlatformNames()
    
    platforms = {};
    for(let i = 0; i < online.length; i++){
        let device = online[i];
        for(let v = 0; v < device.platformList.length; v++){
            let k = device.platformList[v];
            let name = k;
            for(let s = 0; s < names.length; s++){
                if(k === names[s].short) name = names[s].name
            }
            platforms[k] ??= name
        }
    }
    if(choiceArray){
        let keys = Object.keys(platforms);
        let values = Object.values(platforms);
        return keys.map(function(x,i){
            return {value:x, text:values[i]}
        })
    
    }
    return platforms;
}

let getFilteredGameList = function(repo, platform){
    if(!repo[platform]) return [];
    return Object.keys(repo[platform]);
}

let getFilteredOnlinePlatformDevices = function(online, platform){
    return online.filter(function(x){
        if(x.platformList.indexOf(platform) !== -1) return x
    }).map(function(x){
        return {value:x.device, text:x.name}
    });
}

let getFilteredOnlinePlatformDeviceFileList = function(online, device, platform){
    let deviceObj = {};
    for(let i = 0; i < online.length; i++){
        if(online[i].device === device) deviceObj = online[i];
    }
    return deviceObj.fileList[platform].map(function(x){return x.rootPath});
}

let zeros = function(str){
    str+="";
    return str.length === 1 ? '0'+str:str
}
let makeDate = function(date){
    let d = date ?? new Date();
    return `${d.getFullYear()}-${zeros(d.getMonth()+1)}-${zeros(d.getDate())} ${zeros(d.getHours())}:${zeros(d.getMinutes())}:${zeros(d.getSeconds())}`
}
let niceDate = function(date, incTime){
    if(typeof(date)==="string") date = new Date(date);
    let d = date;
    return`${zeros(d.getDate())}/${zeros(d.getMonth()+1)}/${d.getFullYear()} ${incTime?`${zeros(d.getHours())}:${zeros(d.getMinutes())}:${zeros(d.getSeconds())}`:""}`
}
let numberDate = function(date){
    let d = date ?? new Date();
    return `${d.getFullYear()}-${zeros(d.getMonth()+1)}-${zeros(d.getDate())}_${zeros(d.getHours())}-${zeros(d.getMinutes())}-${zeros(d.getSeconds())}`
}
let yearMonth = function(date){
    let d = date ?? new Date();
    return `${d.getFullYear()}_${zeros(d.getMonth()+1)}`
}


//This needs to happen as there's some crazy permssion issues on Linux...
let copy = function(source, destination){
    if(process.platform === "linux"){
        let fileContent = fs.readFileSync(source);
        fs.writeFileSync(destination, fileContent)
    }else{
        fs.copyFileSync(source, destination)
    }
}

let addOrUpdateRepo = async function(writeData, repo){
    let {platform,game,newGameBool,device,path} =  writeData;

    console.log('Adding save entry to repo...')
    let result = await c.db.newRepoRecord({
        device,
        game,
        path,
        platform,
        lastCopiedFrom: newGameBool ? makeDate() : '',
        lastCopiedTo: ''
    });

    if(newGameBool && result){
        //Make a repo entry too
        console.log('New Game... creating a repo file...')
        copy(`./TEMP/${device}/${platform}/${path}`, `${process.env.REPO_PATH}/${platform}/${game}`)
        await c.git.add(`${process.env.REPO_PATH}`);
        let repoResult = await c.db.newRepoRecord({
            device : 'repo',
            game,
            path : `/${platform}/${game}`,
            platform,
            lastCopiedFrom: '',
            lastCopiedTo:   makeDate()
        })
        return repoResult;
    }
    return result;
}



let getSaveStats = async function(entries){
    let config = await c.db.getConfig();
    for(let i = 0; i < entries.length; i++){

        let entry = entries[i];
        let root = entry.device === 'repo' ? process.env.REPO_PATH: `./TEMP/${entry.device}/${entry.platform}/`;
        let path = `${root}${entry.path}`;

        if(fs.existsSync(path)){
            entry.sessionPath = path;
            entry.present = true;
            let file = fs.readFileSync(path);
            entry.crc32 = await CRC32.buf(file,0).toString(16).toUpperCase();
            if(entry.crc32[0] === '-') entry.crc32 = entry.crc32.slice(1, entry.crc32.length)
            let stats = fs.statSync(path);
            entry.birthTime = stats.birthtime;
            entry.modifiedTime = stats.mtime;
            entry.size = stats.size;
        }

        
        if(entry.device === 'repo'){
            entry.deviceName = 'Repository';
            continue;
        }
        for(let e = 0 ; e<config.length; e++){
            let device = config[e];
            if(entry.device === device.device){
                entry.deviceName = device.name;
            }
        }
    }
    return entries;
}



module.exports={
    getMasterList,
    getRepo,
    dirCreate,
    dirRemove,
    getOnlinePlatformList,
    getFilteredGameList,
    getFilteredOnlinePlatformDevices,
    getFilteredOnlinePlatformDeviceFileList,
    addOrUpdateRepo,
    getSaveStats,
    niceDate,
    makeDate,
    numberDate,
    copy,
    yearMonth
}
