let run = function(){
require('colors')
require('dotenv').config();
let fs = require('fs');
global.c = require('../common/common.js');
let ui = require('./ui.js');

let preferences, devices, repo, instance;

//Edits the discovery configuration
let editDiscovery = async function(devices){
    let exit = false;
    if(await ui.bool('Edit Config?')){
        let deviceId = await ui.select(devices.map(function(x){return {text:x.name, value:x.device} }), 'Discover which device?');
        let discoveryVal = await ui.bool('Discover this device?');
        await c.db.writePreference(instance, {device:deviceId, discover:discoveryVal})
        preferences = await c.db.getPreferences(instance);
    }else{
        exit = true;
    }
    return exit;
}

//Logs Online Devices and creates new Discovery DB entries if not found
let listConfiguration = async function(devices,preferences){
    for(let i = 0; i < devices.length; i++){
        let deviceId = devices[i].device;
        let entries = preferences.map(function(x){return x.device});

        //WRITE New Devices to Discovery
        if(entries.indexOf(deviceId) === -1){
            await c.db.writePreference(instance, {device:deviceId, discover:true});
            devices[i].discover = true;
        }else{
            for(let e = 0; e < preferences.length; e++){
                let pref = preferences[e];
                if(deviceId === pref.device){
                    devices[i].discover = pref.discover === 1 && devices[i].online ? true : false;
                }
            }
        }
        console.log(`  [${devices[i].discover?'X':' '}] ${devices[i].online?' ONLINE':'OFFLINE'} ::: ${devices[i].name}`)
    }
}

let addNewSave = async function(online,repo){

    //Get platform list
    let platform = "";
    do{
        let platformList = await c.functions.getOnlinePlatformList(online, true);
        platform = await ui.select(platformList, 'Which platform?', undefined, true)

        //Get Game Name
        let game = "";
        let newGameBool = undefined;
        if(platform !== "" && platform){
            do{
                game = "";
                newGameBool = await ui.bool('Is this a new Game?');
                let filteredGameList = c.functions.getFilteredGameList(repo,platform);
                game = newGameBool ?  await ui.text('New Game Name: ') :  await ui.select(filteredGameList, 'Which Game?', undefined, true);

                //Get Device List that has the selected platform
                let device = "";
                if(game !== "" && game){
                    do{
                        device = ""
                        let onlinePlatformDevices = c.functions.getFilteredOnlinePlatformDevices(online,platform)
                        device = await ui.select(onlinePlatformDevices, 'Which device?', undefined, true);

                        //Get a filelist for the device and platform
                        let filePath = ""
                        if(device !== "" && device){
                            do{
                                fileList = c.functions.getFilteredOnlinePlatformDeviceFileList(online, device, platform)
                                filePath = await ui.select(fileList, 'Which file?', undefined, true);

                                //Confirmation to continue
                                let continueBool;
                                if(filePath !== "" && filePath){
                                        console.log(`We are going to add ${game} (${platform}) to the repo?${"\n"}Device: ${device}${"\n"}File: ${filePath} `);
                                        continueBool = await ui.bool('Continue? ')
                                        if(continueBool){
                                            let createRes = await c.functions.addOrUpdateRepo(  {
                                                platform,
                                                game,
                                                newGameBool,
                                                device, 
                                                path:filePath
                                            }, repo );

                                            console.log(createRes ? 'Added Successfully':'Something went wrong')
                                          
                                            platform = undefined;
                                            game = undefined,
                                            device = undefined,
                                            filePath  = undefined;
                                        }
                                }
                        }while(filePath)
                        }
                    }while(device)
                }        
            }while(game)
        }
    }while(platform)
}

let syncASave = async function(online){

    let repo = await c.functions.getRepo();
    
    //Get platform list
    let platform = "";
    do{
        let platformList = await c.functions.getOnlinePlatformList(online, true);
        platform = await ui.select(platformList, 'Which platform?', undefined, true)

        //Get Game Name
        let game = "";
        if(platform !== "" && platform){
            do{
                game = "";
                let filteredGameList = c.functions.getFilteredGameList(repo,platform);
                game = await ui.select(filteredGameList, 'Which Game?', undefined, true);

                if(game !== "" && game){
                    let repoEntry = repo[platform][game]
                    let repoData = await  c.functions.getSaveStats(repoEntry)
                    let available = []

                    let nd = c.functions.niceDate;
                    console.log(`S A V E   S Y N C   I N   A C T I O N`)
                    console.log(`Game: ${game}`);
                    console.log(`Platform: ${platform}`);
                    for(let i = 0; i < repoData.length; i++) {
                        console.log('----')
                        let entry = repoData[i];
                        console.log(`Device: ${entry.deviceName}`)
                        if(entry.lastCopiedTo!==""&&entry.lastCopiedTo)console.log(`Last Time Copied to: ${nd(entry.lastCopiedTo, true)} `)
                        if(entry.lastCopiedFrom!==""&&entry.lastCopiedFrom)console.log(`Last Time Copied from: ${nd(entry.lastCopiedFrom, true)}`)
                        if(entry.present){
                            available.push(entry)
                            console.log('Status: AVAILABLE')
                            console.log(`Modified Time: ${nd(entry.modifiedTime,true)}`)
                            console.log(`Checksum: ${entry.crc32}`)
                        }else{
                            console.log('Status: UNAVAILABLE')
                        }
                        console.log('');
                    }
                    let availableDevices = available.map(function(x){
                        return {value:x.device, text:x.deviceName}
                    });
                    let deviceSource = await ui.select(availableDevices, 'Which device has the latest save data?', undefined, true);
                    if(deviceSource!==""){
                        let latestRepo;
                        let pushToList = [];
                        for(let i = 0; i < available.length; i++){
                            if(available[i].device === deviceSource){
                                latestRepo = available[i]
                            }else{
                                pushToList.push(available[i]);
                            }
                        }
                        console.log(`Copying the save from ${latestRepo.deviceName.green} to:`)

                        for(let u = 0; u < pushToList.length; u++){
                            console.log(`${pushToList[u].deviceName.blue}`)
                        }

                        let syncContinue = await ui.bool('Continue with this operation? ');
                        if(syncContinue){
                            let res = await c.devices.syncTheSave(latestRepo, pushToList, online);
                            console.log(res?'Sync Successful':'Something went wrong...')
                        }
                    }
                }        
            }while(game)
        }
    }while(platform)
}

let pushRepositories = async function(){
    let repos = [
        process.env.REPO_PATH,
        process.env.REPO_PATH+'/TRACE',
        process.env.REPO_PATH+'/DEVICE'
    ]
    for(let i = 0; i < repos.length; i++){
        console.log(`Pushing REPO ${repos[i]}`)
        let push = await c.git.push(repos[i]);
        if(!push)console.log('Push not successful')
    }
}

let syncRoms = async function(online){

    let romSyncDevices = []; 
    for(let i = 0; i < online.length; i++){ if(Object.keys(online[i].romDir).length) romSyncDevices.push(online[i]); }
    let deviceList = romSyncDevices.map(function(x){x.text = x.name; x.value = x.device; return x})
    let device = "";

    do{
        device = await ui.select(deviceList, 'Which device to Sync roms to?', undefined, true);
        //Get Game Name
        let platform = "";
        if(device !== "" && device){
            do{
                let platformNames = await c.db.getPlatformNames()

                let selectedDevice = {};
                for(let i = 0; i < online.length; i++){
                    if(online[i].device === device) selectedDevice = online[i];
                }
                let platformList = Object.keys(selectedDevice.romDir);
                platformList = platformList.map(function(x){ 
                    let y = {}
                    for(let z = 0; z < platformNames.length; z++){
                        if(platformNames[z].short === x) y.text = platformNames[z].name
                    }; 
                    y.value = x
                    return y
                });

                platform = "";
                platform = await ui.select(platformList, 'Which platform?', undefined, true);

                let {found, notFound} = await c.rom.getRomList(selectedDevice, platform)

                console.log(`\n   ${found.length}/${found.length+notFound.length}`.green + ' Found');
                console.log('\n   Not Found');
                for(let i = 0; i < notFound.length; i++){
                    console.log(notFound[i].newFileName.red);
                }

                continueBool = await ui.bool('Continue Copy? ')
                if(continueBool){
                    let completed = await c.rom.copyRoms(notFound, selectedDevice);
                    console.log(completed?'\nCompleted':'\nError')
                }

                }while (platform)
            }
        }while(device)
    


}

let main = async function(){

    let state = await c.startup();
    if(!state)return false;


    instance = fs.readFileSync('instance').toString();

    let config = await c.db.getConfig();
    devices = await c.devices.getOnlineDevices(config, 'local');
    preferences = await c.db.getPreferences(instance);
    do{
        await listConfiguration(devices,preferences);
        exitEdit = await editDiscovery(devices);
    }while(!exitEdit)
    online = c.functions.getMasterList(devices);
    //online = await c.devices.prepareFiles(online);
    //repo = await c.functions.getRepo();

    let options =
    [
        "Sync",
        "Add new Save",
        "Push Repositories",
        "Sync Roms",
        "Quit"
    ]
    let quit;
    do{
        let choice = await ui.select(options, 'How to continue? ', 'index');
        await [
            syncASave.bind(undefined, online, repo),
            addNewSave.bind(undefined, online,repo),
            pushRepositories.bind(undefined),
            syncRoms.bind(undefined, online),
            function(){console.log('Exiting...');quit=true}
        ][choice]();
    }while(!quit)

}

main();

}
module.exports=run