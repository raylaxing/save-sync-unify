
let run = function(){
    require('dotenv').config();

    if(!process.env.SERVER_PORT){
        console.log('SET SERVER_PORT IN ENV')
        return;
    }
    const express = require('express')
    const app = express();
    const port = process.env.SERVER_PORT;
    const path = require('path');
    const fs = require('fs');

    global.c = require('../common/common.js');
    app.use(express.urlencoded({
        extended: true
    }));
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'web')));
    app.use(express.static(__dirname, { dotfiles: 'allow' } ));

    c.startup();
    let instance = fs.readFileSync('instance').toString();


    let devices, preferences, repo
    let deviceFunctions={}

    let apiPrefix = "/api";


    let storeFunctions = function(devices){
        for(let i = 0; i < devices.length; i++){
            deviceFunctions[devices[i].device] = {};
            deviceFunctions[devices[i].device] =  devices[i].functions
        }
        return devices;
    }
    let repackFunctions = function(devices){
        for(let i = 0; i < devices.length; i++){
            devices[i].functions = deviceFunctions[devices[i].device];
        }
        return devices;
    }
    app.get('/alive', function(req,res){
        res.send({ok:'okk'});
        res.end()
    })
    app.get(apiPrefix+'/getOnlineList', async function(request,response){
        config = await c.db.getConfig();
        devices = await c.devices.getOnlineDevices(config, 'server');
        response.send(devices);
        response.end();
    })
    app.get(apiPrefix+'/getPreferences', async function(request,response){
        preferences = await c.db.getPreferences(instance);
        response.send(preferences);
        response.end();
    })
    app.post(apiPrefix+'/writePreferences', async function(request, response){
        let writeResponse = await c.db.writePreference(instance, request.body);
        response.send(JSON.stringify({writeResponse}));
        response.end()
    });
    app.get(apiPrefix+'/copyToTemp', async function(request, response){
        if(c.progress.isRunning()){
            response.status(409).send({error: 'Already gathering saves - please wait for it to finish'});
            return;
        }
        c.progress.start();
        try{
            config = await c.db.getConfig();
            config.forEach(d => c.progress.device(d.device, {name: d.name, type: d.type, status: 'checking'}));
            devices = await c.devices.getOnlineDevices(config, 'server', function(device){
                c.progress.device(device.device, {status: device.online ? 'online' : 'offline', vpn: !!device.vpnActive});
            });
            preferences = await c.db.getPreferences(instance);
            for(let i = 0; i < devices.length; i++){
                let deviceId = devices[i].device;
                for(let e = 0; e < preferences.length; e++){
                    let pref = preferences[e];
                    if(deviceId === pref.device){
                        devices[i].discover = pref.discover === 1 && devices[i].online ? true : false;
                    }
                }
                if(devices[i].online && !devices[i].discover) c.progress.device(deviceId, {status: 'skipped'});
            }
            online = c.functions.getMasterList(devices);
            c.progress.phase('Gathering saves');
            online = await c.devices.prepareFiles(online);
            online = storeFunctions(online); //Required to parse function in API call
            c.progress.finish();
            console.log('Finished Copying from temp')
            response.send(JSON.stringify(online));
            response.end()
        }catch(e){
            console.log(e);
            c.progress.finish(e);
            response.status(500).send({error: e.message});
        }
    });

    //Live progress of copyToTemp (Server-Sent Events)
    app.get(apiPrefix+'/progress', function(request, response){
        response.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        response.flushHeaders();
        let send = state => response.write(`data: ${JSON.stringify(state)}\n\n`);
        send(c.progress.snapshot());
        let unsubscribe = c.progress.subscribe(send);
        request.on('close', unsubscribe);
    });

    app.post(apiPrefix+'/getOnlinePlatformList', async function(request, response){
        if(request.body) {
            let online = repackFunctions(request.body.online)
            let platformList = await c.functions.getOnlinePlatformList(online, true);
            response.send(JSON.stringify(platformList));
            response.end()
        }
    });
    app.post(apiPrefix+'/getFilteredGameList', async function(request, response){
        if(request.body) {
            repo = await c.functions.getRepo();
            let filteredGameList = c.functions.getFilteredGameList(repo,request.body.platform);
            response.send(JSON.stringify(filteredGameList));
            response.end()
        }
    });
    app.post(apiPrefix+'/getFilteredOnlinePlatformDevices', async function(request, response){
        if(request.body) {
            let onlinePlatformDevices = c.functions.getFilteredOnlinePlatformDevices(request.body.online,request.body.platform)
            console.log(onlinePlatformDevices, request.body)
            response.send(JSON.stringify(onlinePlatformDevices));
            response.end()
        }
    });
    app.post(apiPrefix+'/getFilteredOnlinePlatformDeviceFileList', async function(request, response){
        if(request.body) {
            let fileList = c.functions.getFilteredOnlinePlatformDeviceFileList(request.body.online, request.body.device, request.body.platform)
            response.send(JSON.stringify(fileList));
            response.end()
        }
    });
    app.post(apiPrefix+'/addOrUpdateRepo', async function(request, response){
        if(request.body) {
            let createRes = await c.functions.addOrUpdateRepo( request.body, repo );
            response.send(createRes);
            response.end()
        }
    });

    app.post(apiPrefix+'/getRepoStatInfo', async function(request,response){
        if(request.body){
            let repo = await c.functions.getRepo();
            let repoEntry = repo[request.body.platform][request.body.game]
            let repoData = await  c.functions.getSaveStats(repoEntry)
            response.send(JSON.stringify(repoData));
            response.end()
        }
    });
    //Save versions of a game in the repo
    app.post(apiPrefix+'/getVersions', async function(request, response){
        try{
            response.send(await c.versions.list(request.body.platform, request.body.game));
        }catch(e){
            response.status(400).send({error: e.message});
        }
    });
    app.post(apiPrefix+'/createVersion', async function(request, response){
        try{
            let id = await c.versions.create(request.body);
            response.send({ok: true, id});
        }catch(e){
            response.status(400).send({error: e.message});
        }
    });
    app.post(apiPrefix+'/setActiveVersion', async function(request, response){
        try{
            await c.versions.setActive(request.body.platform, request.body.game, request.body.id);
            response.send({ok: true});
        }catch(e){
            response.status(400).send({error: e.message});
        }
    });

    app.post(apiPrefix+'/syncTheSave', async function(request, response){
        if(request.body){
            let res = await c.devices.syncTheSave(request.body.latest,request.body.pushList, online);
            res = {
                successful: true
            }
            response.send(JSON.stringify(res));
            response.end();
        }
    })
    app.post(apiPrefix+'/nd', async function(request, response){
        if(request.body){
            let time = c.functions.niceDate(request.body.d, request.body.time)
            response.send(time);
            response.end();
        }
    })
    app.post(apiPrefix+'/gitPush',  async function(request,response){
        let res =  await c.git.push(process.env.REPO_PATH+request.body.path);
        response.send(res);
        response.end()
    });   
  
    //Mapping Table / delete
    app.get(apiPrefix+'/getFullMapping', async function(request,response){
        let mapping = await c.db.getFullMapping();
        for(let i = 0; i < mapping.length; i++){
            mapping[i].exists = fs.existsSync(`./TEMP/${mapping[i].deviceID}/${mapping[i].platformID}/${mapping[i].path}`);
        }
        response.send(JSON.stringify(mapping));
        response.end();
    });
    app.post(apiPrefix+'/deleteMappingEntry', async function(request, response){
        console.log(request.body.id)
        let res = await c.db.deleteMappingEntry(request.body.id);
        response.send(JSON.stringify({result: res}));
    });


    /**CONFIG PAGE**/
    let configError = function(response, e){
        response.status(400).send({error: e.message || `${e}`});
    };

    app.get('/configData/getDevices',  async function(request,response){
        let rows = await c.db.getConfig() || [];
        response.send({
            devices: rows.map(c.deviceConfig.toEditable),
            platforms: await c.deviceConfig.knownPlatforms(rows)
        });
    });
    app.post('/configData/writeDevice', async function(request, response){
        let input = request.body || {};
        let rows = await c.db.getConfig() || [];
        let existing = input.id ? rows.find(r => r.id === +input.id) : null;
        if(input.id && !existing) return configError(response, new Error('Device not found'));

        let known = (await c.deviceConfig.knownPlatforms(rows)).map(p => p.code);
        let {errors, row} = await c.deviceConfig.validate(input, existing, rows, known);
        if(Object.keys(errors).length) return response.send({ok: false, errors});

        if(existing) row.id = existing.id;
        let ok = await c.db.writeConfig(row);
        let saved = (await c.db.getConfig() || []).find(r => r.device === row.device);
        response.send({ok, device: saved && c.deviceConfig.toEditable(saved)});
    });
    app.post('/configData/deleteDevice', async function(request, response){
        let row = await c.db.getDevice(request.body.id);
        if(!row) return configError(response, new Error('Device not found'));
        let ok = await c.db.deleteDevice(row.id);
        response.send({ok});
    });
    app.post('/configData/deviceUsage', async function(request, response){
        let row = await c.db.getDevice(request.body.id);
        response.send({mappings: row ? await c.db.countDeviceMappings(row.device) : 0});
    });
    app.post('/configData/browse', async function(request, response){
        try{
            response.send(await c.deviceConfig.browse(request.body.device || {}, request.body.path));
        }catch(e){
            configError(response, e);
        }
    });
    app.get('/configData/drives', function(request, response){
        response.send(c.deviceConfig.listDrives());
    });
    app.post('/configData/test', async function(request, response){
        response.send(await c.deviceConfig.test(request.body.device || {}));
    });


    app.listen(port, () => {
    console.log(`Listening for port: ${port}`)
    })

}

module.exports = run;