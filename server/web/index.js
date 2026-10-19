let apiPrefix = "/api";
let htmlArea;
let onlineObj;
let elems = {};
let area = "main";
let step = 0;
let latestRepo, pushToList, available, gameEntries;

/***********************
 * PROCCESS FUNCTIONS  *
 ***********************/
let post = async function(url,obj, jsonRes){
    let post = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(obj)
    })
    if(jsonRes) return await post.json();
}

let zeros = function(str){
    str+="";
    return str.length === 1 ? '0'+str:str
}

let nd = function(date,incTime){
    if(!date) return '';
    if(typeof(date)==="string") date = new Date(date);
    let d = date;
    return`${zeros(d.getDate())}/${zeros(d.getMonth()+1)}/${d.getFullYear()} ${incTime?`${zeros(d.getHours())}:${zeros(d.getMinutes())}:${zeros(d.getSeconds())}`:""}`
}

let writePrefChange = async function(e){
    let device = e.getAttribute('device');
    let discover = e.checked;
    await post(apiPrefix+'/writePreferences', {
        device,discover
    });
}

let esc = function(str){
    return `${str ?? ''}`.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
};

/** PROGRESS **/
let progressState = null;
let progressStarted = 0;

let progressStatus = function(d){
    switch(d.status){
        case 'checking': return ['Checking...', ''];
        case 'online': return ['Waiting', ''];
        case 'offline': return ['Offline', 'is-disabled'];
        case 'skipped': return ['Skipped', 'is-disabled'];
        case 'gathering': return ['Gathering', 'is-primary'];
        case 'done': return [`${d.fileCount} save${d.fileCount === 1 ? '' : 's'}`, 'is-success'];
        case 'failed': return ['Failed', 'is-error'];
        default: return ['', ''];
    }
};

//0-1 progress for a device that is being gathered
let deviceFraction = function(d){
    if(d.status === 'done' || d.status === 'failed') return 1;
    if(d.status !== 'gathering' || !d.platformCount) return 0;
    let within = d.total ? d.done / d.total : 0;
    return Math.min(1, (d.platformIndex + within) / d.platformCount);
};

let renderProgress = function(){
    let area = document.getElementById('loading');
    let s = progressState;
    if(!area || !s) return;

    let devices = (s.order || []).map(id => s.devices[id]);
    let gathered = devices.filter(d => ['gathering', 'done', 'failed'].indexOf(d.status) !== -1);
    let overall = gathered.length ? gathered.reduce((sum, d) => sum + deviceFraction(d), 0) / gathered.length : 0;
    let elapsed = Math.round((Date.now() - progressStarted) / 1000);

    let rows = devices.map(function(d){
        let [label, cls] = progressStatus(d);
        let detail = '';
        if(d.status === 'gathering'){
            let platform = d.platform ? `${esc(d.platform)} (${d.platformIndex + 1}/${d.platformCount})` : '';
            let files = d.total ? `${d.done}/${d.total}` : 'scanning...';
            detail = `
                <progress class="nes-progress is-primary progressSmall" value="${Math.round(deviceFraction(d) * 100)}" max="100"></progress>
                <div class="progressDetail">${platform} &middot; ${files}${d.file ? ` &middot; ${esc(d.file)}` : ''}</div>`;
        }
        if(d.status === 'failed') detail = `<div class="progressDetail nes-text is-error">${esc(d.error)}</div>`;
        return `
        <div class="progressDevice">
            <div class="progressHead">
                <span>${esc(d.name)}${d.vpn ? ' <span style="font-size:10px;color:gray;">VPN</span>' : ''}</span>
                <span class="nes-text ${cls}">${label}</span>
            </div>
            ${detail}
        </div>`;
    }).join('');

    area.innerHTML = `
        <p class="title">Progress</p>
        <div class="progressHead">
            <span>${esc(s.phase)}</span>
            <span style="color:gray">${elapsed}s</span>
        </div>
        <progress class="nes-progress ${s.running === false && s.phase !== 'Done' ? 'is-error' : 'is-success'}" value="${s.phase === 'Done' ? 100 : Math.round(overall * 100)}" max="100"></progress>
        ${rows}
        ${(s.warnings || []).map(w => `<p class="nes-text is-warning" style="margin-top:16px;font-size:10px">${esc(w)}</p>`).join('')}
        <div id="progressActions"></div>`;
};

let copyToTemp = async function(){
    document.getElementById('startButtonDiv').classList.add('hidden');

    let loading = document.getElementById('loading');
    loading.classList.remove('hidden');
    progressStarted = Date.now();
    progressState = {phase: 'Starting...', order: [], devices: {}};
    renderProgress();

    //Live updates while the request runs
    let events = new EventSource(apiPrefix+'/progress');
    events.onmessage = function(e){
        let s = JSON.parse(e.data);
        //Ignore the previous run's final state, sent when first connecting
        if(s.started && s.started < progressStarted - 5000) return;
        progressState = s;
        renderProgress();
    };
    let ticker = setInterval(renderProgress, 1000);

    let res, body;
    try{
        res = await fetch(apiPrefix+'/copyToTemp');
        body = await res.json();
    }catch(e){
        body = {error: e.message};
    }
    events.close();
    clearInterval(ticker);

    if(!res || !res.ok){
        progressState = Object.assign({}, progressState, {running: false, phase: `Failed: ${body.error || 'server error'}`});
        renderProgress();
        document.getElementById('progressActions').innerHTML = `<button class="nes-btn" onClick="location.reload()">Back</button>`;
        return;
    }

    onlineObj = body;
    console.log(onlineObj)
    progressState = Object.assign({}, progressState, {running: false, phase: 'Done'});
    renderProgress();

    //Leave failures on screen until acknowledged, otherwise carry straight on
    let failed = onlineObj.filter(d => d.gatherError);
    let warnings = progressState.warnings || [];
    if(failed.length || warnings.length){
        document.getElementById('progressActions').innerHTML = `
            ${failed.length ? `<p class="nes-text is-error" style="margin-top:16px;font-size:12px">${failed.length} device(s) couldn't be read - their saves won't be listed.</p>` : ''}
            <button class="nes-btn" onClick="finishProgress()">Continue</button>`;
        return;
    }
    setTimeout(finishProgress, 800);
}

let finishProgress = function(){
    document.getElementById('loading').classList.add('hidden');
    renderMenu()
}

/*****************************
 * CREATE ELEMENTS FUNCTIONS  *
 *****************************/

let create = {
    button: function(id, text, onClick){
        return `<button id="${id}"" class="nes-btn dataInput" onClick="${onClick?`${onClick}`:''}">${text}</button>`;
    },
    dropdown: function(id, label, onChange){
        return ` 
        <label for="${id}" >${label}</label>
        <div class="nes-select">
            <select onChange="${onChange}" class="dataInput" id="${id}"></select>
        </div>`;
    },
    input: function(id, label, onChange){
        return `
        <label for="${id}">${label}</label>
        <input class="nes-input dataInput" onChange="${onChange}" id="${id}"  />
        `
    },
    icon: function(id, classNames, icon,  onClick, mappingID){
        return `
        <i class="nes-icon dataInput ${icon} ${classNames}" style="transform:none;float:left;margin-top:4px;"onClick="${onClick}" mappingID=${mappingID} id="${id}"> </i>`
    }
}

let createDropdownSelects = function(arr){
    let select = "";
    arr.forEach(function(x,i){
        if(i===0) select+=`<option value=""></option>`
        select+=`<option value="${x.value ?? x}">${x.text?? x}</option>`
    });
    return select
}

let createExistingGameInfo = function(repoData){
    let infoStr = "";
    console.log(repoData)
    for(i in repoData){
        let entry = repoData[i];
        infoStr+=`
        <div class="nes-container deviceListing with-title choice-section ${entry.present?'':'unavailableDevice'}" ">
            <h3 class="title">${entry.deviceName}</h3>
            <div class="nes-table-responsive">
                <table class="nes-table is-bordered is-centered">
                    <tbody>
                        <tr>
                            <td>Last Copied to</td>
                            <td>${nd(entry.lastCopiedTo, true)}</td>
                        </tr>
                        <tr>
                            <td>Last Copied from</td>
                            <td>${nd(entry.lastCopiedFrom, true)}</td>
                        </tr>
                        <tr>
                            <td>Last Modified</td>
                            <td>${nd(entry.modifiedTime, true)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `
        if(entry.present) infoStr+=`
            <div class="nes-container is-centered is-dark with-title">
                <p class="title">Checksum</p>
                <p>${entry.crc32}</p>
            </div>
        `
        infoStr += "</div>"
    }
    return infoStr
}

let createConfirmationGameInfo = function(){
    
    let str = ` 
    <div class="nes-container is-centered is-dark with-title choice-section">
        <p class="title">Copying Save from</p>
        <p>${latestRepo.deviceName}</p>
    </div>
    <div class="nes-container is-centered is-dark with-title choice-section">
        <p class="title">Copying Save to</p>
        <p>
    `
    for(let u = 0; u < pushToList.length; u++){
        str+=`${pushToList[u].deviceName}<br>`
    }
    if(pushToList.length === 0)str+='No Available Devices'
    str += `
        </p>
    </div>`;
    return str;
}

let createMappingTable = async function(){
    let mappingList = await (await fetch(apiPrefix+'/getFullMapping')).json();
    console.log(mappingList);
    let newText = "";
    let currentPlatform = "";
    let currentGame = "";

    for(let i = 0; i < mappingList.length; i++){
        let newPlatform = currentPlatform === mappingList[i].platform;
        let newGame = currentGame === mappingList[i].game;
        if(!newPlatform) currentPlatform = mappingList[i].platform;
        if(!newGame) currentGame = mappingList[i].game;
        newText += `
        ${!newPlatform?`
        <h2 class="mappingTitle" onClick="mapping_togglePlatform(this)" data="${mappingList[i].platformID}">
            ${mappingList[i].platform}
        </h2>
        <div class="mappedPlatform hidden" id="map-${mappingList[i].platformID}">`:''}
            ${!newGame?`
            <div class="mappedEntry nes-container">
                <div class="mappedGame">
                    <h3 style="color:#777;">${mappingList[i].game}</h3>
                </div>`:''}
            ${!newGame?`
            <div class="mappedDevice">`:''}
                ${create.icon(`delete_${mappingList[i].id}`, 'deleteBtn', 'close',  'mapping_deleteMapping(this)' , mappingList[i].id)}
                <div>
                    <div>
                        ${mappingList[i].device} 
                    </div>
                    <div style="font-size:9px;padding-left:32px; color:${mappingList[i].exists?'#8cc757':'#999'}">
                        ${mappingList[i].path}
                    </div>
                </div>
                ${(mappingList[i+1]) && (currentGame !==  mappingList[i+1].game) ? `
                </div>
            </div>`:''}
        ${(mappingList[i+1]) && (currentPlatform !==  mappingList[i+1].platform) ? `
        </div>`:''}
        `
    }
    elems.mapping.info.table.innerHTML = newText
    return true
}

/**********************
 * COMMON UI FUNCTIONS
 *********************/

let resetElements = function(){
    for(areas in elems){
        for(element in elems[areas].ui){
            elems[areas].ui[element].value = ""
        }
    }
}

let toggleHidden = function(elem){
    elem.classList.toggle('hidden')
}

let setUi = function(){
    for(thisArea in elems){
        elems[thisArea].area.classList[thisArea === area ? 'remove': 'add']('hidden');
    }
    if(area !== 'addGame' && area !== 'syncGame') return
    for(thisStep in elems[area].steps){
        let elemStep = parseInt(elems[area].steps[thisStep].getAttribute('data-step'));
        elems[area].steps[thisStep].classList[step >= elemStep ? 'remove':'add']('hidden');
    }
    elems.extra.area.classList.remove('hidden');
}

/***********************
 * ADD GAME FUNCTIONS  *
 ***********************/

let addGame_init = async function(){
    let platformList = await post(apiPrefix+'/getOnlinePlatformList', {online:onlineObj}, true);
    elems.addGame.ui.addGame_platform.innerHTML =  createDropdownSelects(platformList);

    area = "addGame";
    step = 0;
    setUi();
}
let addGame_platform = async function(){
    let platform = elems.addGame.ui.addGame_platform.value;
    if(platform !== ""){
        let deviceList = await post(apiPrefix+'/getFilteredOnlinePlatformDevices', {online:onlineObj, platform}, true)
        elems.addGame.ui.addGame_device.innerHTML = createDropdownSelects(deviceList);
    }
    step = 1;
    setUi();
}
let addGame_device = async function(){
    let device = elems.addGame.ui.addGame_device.value;
    let platform = elems.addGame.ui.addGame_platform.value;
    if(device !== ""){
        let fileList = await post(apiPrefix+'/getFilteredOnlinePlatformDeviceFileList', {online:onlineObj, platform, device}, true);
        elems.addGame.ui.addGame_file.innerHTML = createDropdownSelects(fileList);

        step = 2;
        setUi();
    }
}
let addGame_file = async function(){
    let file = elems.addGame.ui.addGame_file.value;
    let platform = elems.addGame.ui.addGame_platform.value;
    if(file!==""){
        let gameList = await post(apiPrefix+'/getFilteredGameList', {platform}, true);
        elems.addGame.ui.addGame_name_list.innerHTML = createDropdownSelects(gameList);
     
        step = 3;
        setUi();
    }
}
let addGame_name_choice = function(e){
    createNew = e.id==='addGame_name_btn_new';
    elems.addGame.ui.addGame_name_list.parentElement.parentElement.classList[createNew?'add':'remove']('hidden');
    elems.addGame.ui.addGame_name_text.parentElement.classList[!createNew?'add':'remove']('hidden');

    step = 4;
    setUi();
}
let addGame_name_confirm = function(e){
    if(e.value !== "" && e.value){
        step = 5;
    }
    setUi();
}
let addGame_submit = async function(){
    let postingData = {
        platform: elems.addGame.ui.addGame_platform.value,
        game: createNew ? elems.addGame.ui.addGame_name_text.value : elems.addGame.ui.addGame_name_list.value,
        newGameBool: createNew,
        device: elems.addGame.ui.addGame_device.value,
        path:elems.addGame.ui.addGame_file.value
    }
    console.log('POSTING THIS NEW ENTRY:')
    console.log(postingData)
    let res = await(post(apiPrefix+'/addOrUpdateRepo', postingData, true));
    if(res){  
        elems.success.info.message.innerHTML = "Added to Repo";

        area = "success"
        step = 0;
        setUi();
    }
}

/***********************
 * SAVE VERSIONS        *
 ***********************/

let createVersionsInfo = function(versions){
    if(!Array.isArray(versions)){
        return `<p class="nes-text is-error" style="font-size:12px">${esc(versions && versions.error)}</p>`;
    }
    let rows = versions.map(v => `
        <label class="versionRow">
            <input type="radio" class="nes-radio" name="syncVersion" ${v.active ? 'checked' : ''} onChange="syncGame_setVersion(${v.id})" />
            <span>${v.label ? `[${esc(v.label)}]` : 'Original'}</span>
        </label>
        <div class="progressDetail versionMeta">${v.present ? `Saved ${nd(v.modifiedTime, true)}` : 'Empty - sync from a device to fill it'}</div>`).join('');

    return `
    <div class="nes-container with-title choice-section">
        <p class="title">Save version</p>
        ${rows}
        <div id="newVersionForm" class="hidden" style="margin-top:20px">
            <div class="nes-field">
                <label for="newVersionLabel">Comment</label>
                <input id="newVersionLabel" class="nes-input" placeholder="2nd play through" autocomplete="off" />
            </div>
            <label for="newVersionStart" style="margin-top:12px">Start from</label>
            <div class="nes-select">
                <select id="newVersionStart">
                    <option value="empty">Empty - for a new playthrough</option>
                    <option value="copy">Copy of the active version</option>
                </select>
            </div>
            <label style="margin-top:12px"><input type="checkbox" class="nes-checkbox" id="newVersionActivate" checked /><span>Make it the active version</span></label>
            <p id="newVersionError" class="nes-text is-error" style="font-size:10px"></p>
            <button class="nes-btn is-primary" onClick="syncGame_createVersion()">Create</button>
            <button class="nes-btn" onClick="syncGame_toggleNewVersion(false)">Cancel</button>
        </div>
        <div id="newVersionButton" style="margin-top:16px">
            <button class="nes-btn" onClick="syncGame_toggleNewVersion(true)">+ New version</button>
        </div>
        <p class="progressDetail" style="margin-top:12px;word-break:normal">Only the active version is synced. The others stay safe in the repo.</p>
    </div>`;
}

let syncGame_toggleNewVersion = function(show){
    document.getElementById('newVersionForm').classList.toggle('hidden', !show);
    document.getElementById('newVersionButton').classList.toggle('hidden', show);
    if(show) document.getElementById('newVersionLabel').focus();
}

let syncGame_createVersion = async function(){
    let res = await post(apiPrefix+'/createVersion', {
        platform: elems.syncGame.ui.syncGame_platform.value,
        game: elems.syncGame.ui.syncGame_existingList.value,
        label: document.getElementById('newVersionLabel').value,
        startFrom: document.getElementById('newVersionStart').value,
        activate: document.getElementById('newVersionActivate').checked
    }, true);
    if(res.error){
        document.getElementById('newVersionError').textContent = res.error;
        return;
    }
    await syncGame_existingList();
}

let syncGame_setVersion = async function(id){
    let ok = confirm(`Switch the active version?\n\nYour devices still hold the current version's save. If it has progress you want to keep, sync it into the repo first.\n\nAfterwards, sync from the Repository to put the new version on your devices.`);
    if(ok){
        let res = await post(apiPrefix+'/setActiveVersion', {
            platform: elems.syncGame.ui.syncGame_platform.value,
            game: elems.syncGame.ui.syncGame_existingList.value,
            id
        }, true);
        if(res.error) alert(res.error);
    }
    //Re-render either way so the radio buttons match the saved state
    await syncGame_existingList();
}

/***********************
 * SYNC GAME FUNCTIONS  *
 ***********************/

let syncGame_init = async function(){
    let platformList = await post(apiPrefix+'/getOnlinePlatformList', {online:onlineObj}, true)
    elems.syncGame.ui.syncGame_platform.innerHTML = createDropdownSelects(platformList);

    area = "syncGame";
    step = 0;
    setUi();
}

let syncGame_platform = async function(){
    let platform = elems.syncGame.ui.syncGame_platform.value;
    if(platform !== ""){
        let gameList = await post(apiPrefix+'/getFilteredGameList', {platform}, true)
        elems.syncGame.ui.syncGame_existingList.innerHTML = createDropdownSelects(gameList);

        step = 1;
        setUi()
    }
}

let syncGame_existingList  = async function(){
    let game = elems.syncGame.ui.syncGame_existingList.value;
    let platform = elems.syncGame.ui.syncGame_platform.value;
    if(game !== ""){
        let [repoData, versions] = await Promise.all([
            post(apiPrefix+'/getRepoStatInfo',{platform,game}, true),
            post(apiPrefix+'/getVersions',{platform,game}, true)
        ]);
        //Name the repo copy after the active version so it's clear which save is being synced
        let active = Array.isArray(versions) ? versions.find(v => v.active) : null;
        for(i in repoData){
            if(repoData[i].device === 'repo' && active && active.label) repoData[i].deviceName = `Repository [${active.label}]`;
        }
        elems.syncGame.info.versions.innerHTML = createVersionsInfo(versions);
        elems.syncGame.info.files.innerHTML = createExistingGameInfo(repoData);
        gameEntries = repoData;
       
        available = [];
        let availableDevices = [];
        for(i in repoData){
            if(repoData[i].present) {
                available.push(repoData[i]);
                availableDevices.push({value:repoData[i].device, text: repoData[i].deviceName})
            }
        }
        elems.syncGame.ui.syncGame_device.innerHTML = createDropdownSelects(availableDevices);
        
        step = 2;
        setUi();
    }
}

let syncGame_device = async function(){
    let device = elems.syncGame.ui.syncGame_device.value;
    if(device!==""){
        pushToList = [];
        for(let i = 0; i < gameEntries.length; i++){
            let entry = gameEntries[i];
            if(entry.device === device && entry.present){
                latestRepo = entry
            }else if(entry.present || entry.device === 'repo'){
                //The repo copy can be empty (a new version) - it's still somewhere to sync to
                pushToList.push(entry);
            }
        }
        elems.syncGame.info.confirm.innerHTML = createConfirmationGameInfo(device);
        step = 3;
        setUi()     
        
        //Hides Sync Button if no available copy-to are found
        elems.syncGame.ui.syncGame_proceed.classList[pushToList.length === 0 ? 'add':'remove']('hidden')
    }
}

let syncGame_proceed = async function(){
    area = 'success';
    setUi()

    elems.success.info.message.innerHTML = "Syncing..."

    let res = await post(apiPrefix+'/syncTheSave', {
        latest: latestRepo,
        pushList: pushToList
    }, true);
    if(res.successful){
        elems.success.info.message.innerHTML = "Sync Completed"
    }else{
        elems.success.info.message.innerHTML  = "Sync Failed"
    }
}

/***********************
 * OTHER UI FUNCTIONS  *
 ***********************/

let success_return = function(){
    area = "main";
    step = 0;
    setUi();
    resetElements();
}

let main_pushRepo = async function(){  
    let pushRepoButton = elems.main.ui.main_pushRepo
    let startingText = pushRepoButton.innerHTML
    pushRepoButton.classList.add('is-disabled');

    pushRepoButton.innerHTML='Main Repo...'
    let res = await post(apiPrefix+'/gitPush', {
        path: ''
    }, true);
    console.log(res);

    if(!res)return

    pushRepoButton.innerHTML='Trace Repo...'
    let res2 = await post(apiPrefix+'/gitPush', {
        path: '/TRACE'
    }, true);
    console.log(res2);

    if(!res2)return

    pushRepoButton.innerHTML='Device Repo...'
    let res3 = await post(apiPrefix+'/gitPush', {
        path: '/DEVICE'
    }, true);
    console.log(res3);

    pushRepoButton.innerHTML= startingText;
    pushRepoButton.classList.remove('is-disabled');
    pushRepoButton.classList.add('is-success')
    setTimeout(function(){
        pushRepoButton.classList.remove('is-success')
    }, 5000);
}

let main_toggleMapping = async function(){
    await createMappingTable();
    toggleHidden(elems.mapping.area);
}

let mapping_togglePlatform = async function(elem){
    let platform = elem.getAttribute('data');
    let toggleElem = document.getElementById(`map-${platform}`);
    toggleHidden(toggleElem);
}

let mapping_deleteMapping= async function(elem){
    let rmID = elem.getAttribute('mappingid');
    let res = await post(apiPrefix+'/deleteMappingEntry', {
        id: rmID
    }, true);
    if(res){
        await createMappingTable()
    }else{
        elem.classList.add('error')
    }
}

/******************
 * INIT FUNCTIONS
 *****************/

let renderMenu = async function(){
    let topmenu = `
    <div id="menu">
        <div class="leftButtonDiv">
            ${create.button('main_addGame', 'Add Game', 'addGame_init()')}
        </div>
        <div class="rightButtonDiv">
            ${create.button('main_syncGame', 'Sync Game', 'syncGame_init()')}
        </div>
        <div class="leftButtonDiv" style="margin-top:20px;">
            ${create.button('main_pushRepo', 'Git Push', 'main_pushRepo()')}
        </div>
        <div class="rightButtonDiv" style="margin-top:20px;">
            ${create.button('main_toggleMapping', 'View Games', 'main_toggleMapping()')}
        </div>
    </div> `;


    let addNewGamearea = `
    <div id="addNewGame"  class="hidden nes-container with-title" data-context="addGame">
        <h3 class="title">Add a Game</h3>
        <div id="addGame_platform_area" class="addGameStep choice-section" data-step="0">
            ${create.dropdown('addGame_platform','Select Platform' , 'addGame_platform()')}
        </div>
      
        <div id="addGame_device_area" class="addGameStep choice-section" data-step="1">
            ${create.dropdown('addGame_device','Select Device' , 'addGame_device()')}
        </div>
       
        <div id="addGame_file_area" class="addGameStep choice-section" data-step="2">
            ${create.dropdown('addGame_file','Select File' , 'addGame_file()')}
        </div>
        
        <div id="addGame_nameChoice_area" class="addGameStep choice-section" data-step="3">
            <div class="leftButtonDiv">
                ${create.button('addGame_name_btn_list','Existing' , 'addGame_name_choice(this)')}
            </div>
            <div class="rightButtonDiv">
                ${create.button('addGame_name_btn_new','New Game' , 'addGame_name_choice(this)')}
            </div>
        </div>

        <div id="addGame_name_area" class="addGameStep choice-section" data-step="4">
            <div id="addGame_name_list_parent">
                ${create.dropdown('addGame_name_list','Select a Game' , 'addGame_name_confirm(this)')}
            </div>
            <div id="addGame_name_text_parent" class="nes-field">
                ${create.input('addGame_name_text','Type a new name' , 'addGame_name_confirm(this)')}
            </div>
        </div>

        <div id="addGame_submission" class="addGameStep choice-section" data-step="5">        
            ${create.button('addGame_submit', `Let's Go`, 'addGame_submit()')}
        </div>
    </div>
    `;


    let syncGame =`
    <div id="syncGame" class="hidden nes-container with-title">
        <h3 class="title">Sync a Game</h3>

        <div id="syncGame_platformArea" class="syncGameStep choice-section" data-step="0">
            ${create.dropdown('syncGame_platform','Select Platform' , 'syncGame_platform()')}
        </div>

        <div id="syncGame_existingList_area" class="syncGameStep choice-section" data-step="1">
            ${create.dropdown('syncGame_existingList','Select Game' , 'syncGame_existingList()')}
        </div>

        <div id="syncGame_device_area"  class="syncGameStep choice-section" data-step="2">
            <div id="syncGame_versions"></div>
            <div id="syncGame_FileInfo" ></div>
            ${create.dropdown('syncGame_device','Select latest Device' , 'syncGame_device()')}
        </div>

        <div id="syncGame_syncInfo" class="syncGameStep choice-section" data-step="3">
            <div id="syncGame_confirmInfo"></div>
            <div style="margin:auto" class="choice-section">
                ${create.button('syncGame_proceed', 'Sync', 'syncGame_proceed()')}
            </div>
        </div>
    </div>
    `;
    let success = `
    <div id="successScreen"class="hidden nes-container is-centered">
        <h2 id="successMessage" class="nes-text is-primary"></h2>
        ${create.button('success_return', 'Return to Menu', 'success_return()')}
    </div>
    <div id="extra_buttons">
        <div class="extra_elements">
        ${create.button('extra_mapping', 'Mapping', 'main_toggleMapping()')}
        </div>
        <div class="extra_elements">
        ${create.button('extra_back', 'Back', 'success_return()')}
        </div>
    </div>
    `
    let mapping = `
    <div id="mappingTable" class="hidden nes-container ">
        <h2  class="nes-text is-primary">Mapping Table</h2>
        <div id="mappingTableContent"></div>
    </div>
    `

    htmlArea.innerHTML = topmenu+addNewGamearea+syncGame+success+mapping;

    //Main Elems
    elems.main = {ui:{}, area:{}};
    elems.main.area = document.getElementById('menu')
    let menuElems = document.querySelectorAll('#menu .dataInput');
    for(input in menuElems){
        let thisElem = menuElems[input];
        if(thisElem.id) elems.main.ui[thisElem.id] = thisElem;
    }

    //Add Game Elems
    elems.addGame = {steps:{},ui:{}, area:{}};
    elems.addGame.area = document.getElementById('addNewGame')
    let addStepDivs = document.getElementsByClassName('addGameStep');
    for(step in addStepDivs){
        let thisElem = addStepDivs[step];
        if(thisElem.id) elems.addGame.steps[thisElem.id] = thisElem;
    }
    let inputAddElems = document.querySelectorAll('#addNewGame .dataInput');
    for(input in inputAddElems){
        let thisElem = inputAddElems[input];
        if(thisElem.id) elems.addGame.ui[thisElem.id] = thisElem;
    }

    //Sync Game Elems
    elems.syncGame = {steps:{}, ui:{}, area:{}, info:{}};
    elems.syncGame.area = document.getElementById('syncGame');
    elems.syncGame.info.files = document.getElementById('syncGame_FileInfo');
    elems.syncGame.info.versions = document.getElementById('syncGame_versions');
    elems.syncGame.info.confirm = document.getElementById('syncGame_confirmInfo')
    let syncStepDivs = document.getElementsByClassName('syncGameStep');
    for(step in syncStepDivs){
        let thisElem = syncStepDivs[step];
        if(thisElem.id) elems.syncGame.steps[thisElem.id] = thisElem;
    }
    let inputSyncElems = document.querySelectorAll('#syncGame .dataInput');
    for(input in inputSyncElems){
        let thisElem = inputSyncElems[input];
        if(thisElem.id) elems.syncGame.ui[thisElem.id] = thisElem;
    }

    //Success Elems
    elems.success = {ui:{}, area:{}, info:{}};
    elems.success.area = document.getElementById('successScreen');
    elems.success.info.message = document.getElementById('successMessage');
    let successElems = document.querySelectorAll('#successScreen .dataInput');
    for(input in successElems){
        let thisElem = successElems[input];
        if(thisElem.id) elems.success.ui[thisElem.id] = thisElem;
    }

    //Mapping Table Elems
    elems.mapping = {ui:{}, area:{}, info:{}};
    elems.mapping.area = document.getElementById('mappingTable');
    elems.mapping.info.table = document.getElementById('mappingTableContent');

    //Extra Elems
    elems.extra = {ui:{}, area:{}};
    elems.extra.area = document.getElementById('extra_buttons');
    let extraElems = document.querySelectorAll('#extra_buttons .dataInput');
    for(input in extraElems){
        let thisElem = extraElems[input];
        if(thisElem.id) elems.extra.ui[thisElem.id] = thisElem;
    }


    await createMappingTable();
    setUi();
}

let renderFirstStep = async function(){

    let deviceList = await async function(){
        return data = await (await fetch(apiPrefix+'/getOnlineList')).json();
    }();

    let devicePreferences = await async function(){
        return data = await (await fetch(apiPrefix+'/getPreferences')).json();
    }();


   //Device List HTML
    let html =`<div class="nes-container with-title "><p class="title">Devices</p>`;
    for(let i = 0; i < deviceList.length; i++){
        let device = deviceList[i];
        html +=`<label>
            <input class="nes-checkbox" type="checkbox" onClick="writePrefChange(this)" device="${device.device}" id="${device.device}_pref" ${!device.online ? "disabled='true'" : '' } />
            <span class="nes-text ${device.online?'is-success':'is-disabled'}"> ${device.name} ${device.vpnActive ? '<span style="font-size:10px;color:gray;">VPN</span>':''} </span>
        </label><br>`
    }
    html+='</div>'
    htmlArea = document.getElementById('content');
    htmlArea.innerHTML = html;

    //Buttons HTML
    htmlArea.innerHTML += `<br>
    <div id="startButtonDiv">
    <div class="leftButtonDiv" id='copyToTempButton'>
        <button class="nes-btn" onClick='copyToTemp()'>Start</button>
    </div>
    <div id='configButton' class="rightButtonDiv">
        <button class="nes-btn"  onClick="location.href = 'config.html'" >Config</button>
    </div>
    </div>`

    htmlArea.innerHTML += `<div id='loading' class='hidden nes-container with-title'></div>`;


    /** Check Marks Set up  */
    for(let i = 0; i < deviceList.length; i++){
        if(deviceList[i].online){
            let device = deviceList[i];
            let deviceId = device.device;
            let checkElem = document.getElementById(`${device.device}_pref`);
            let prefs = devicePreferences.map(function(e){  return e.device; })
            
            //Create entry if not found
            if(prefs.indexOf(deviceId) === -1){
                console.log('new device on this instance');
                await post(apiPrefix+'/writePreferences', {
                    device:deviceId,
                    discover:true
                });
                checkElem.checked = true;
            }else{
                let flag = devicePreferences[prefs.indexOf(deviceId)].discover;
                console.log(flag);
                checkElem.checked = flag === 1 ? true : false;
            }
        }
    }

}

renderFirstStep();