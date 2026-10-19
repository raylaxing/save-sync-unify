const sqlite3 = require('sqlite3').verbose();
let fs = require('fs');
let path = process.env.REPO_PATH;
let dbFile = `${path}/repo.db`;
let gamedbFile = `${path}/gamedb.db`;
let tables = {
    devices:{
        "device":	        "TEXT",
        "type":             "TEXT",
        "paths"	:           "TEXT",
        "ftpUser":      	"TEXT",
        "ftpPW":	        "TEXT",
        "name":         	"TEXT",
        "localExistCheck":	"TEXT",
        "ftpAddress":	    "TEXT",
        "extensionSearch":	"TEXT",
        "ftpPort":	        "TEXT",
        "ftpAddressVpn":    "TEXT",
        "romDir":           "TEXT",
        "sshKey":           "TEXT"
    },
    discovery:{
            "device":	    "TEXT",
	        "instance":	    "TEXT",
	        "discover":	    "INTERGER"
    },
    mapping:{
        "device":           "TEXT",
        "game":             "TEXT",
        "path":             "TEXT",
        "lastCopiedFrom":   "TEXT",
        "lastCopiedTo":     "TEXT",
        "platform":         "TEXT" 
    },
    platforms:{
        "name":             "TEXT",
        "short":            "TEXT"
    }
}



let get = async function(y, gameDBbool, params = []){
    let databaseFile = gameDBbool? gamedbFile: dbFile;
    return new Promise(async function(resolve,reject){
    let db = new sqlite3.Database(databaseFile, sqlite3.OPEN_READWRITE, async function(err) {
        if(err)console.log('ERROR')
        await db.all(y, params, async function(err,res){
            if(err){
                resolve(false)
            }
            resolve(res);
        });
        });
        db.close()
    })
}

let write = function(y, z){
    return new Promise(function(resolve,reject){
    let db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE, (err) => {
        db.run(y,z,function(err,res){
            if(err){  console.log(err); resolve(false) }
            resolve(true);
        });
        });
        db.close();
    })
}

let objToUpdate = function(obj){
    let id = obj.id;
    delete obj.id;
    let keys = Object.keys(obj);
    let vals = Object.values(obj);
    vals.push(id);
    return {
        fields: keys.join(" = ? , ") + " = ? ",
        vals, 
    }
}
let objToNew = function(obj){
    let keys = Object.keys(obj);
    let vals = Object.values(obj);
    let qs = [];
    for(let i = 0; i < vals.length; i++){
        qs.push('?')
    }
    return {
        fields: keys.join(','),
        qs: qs.join(','),
        vals
    }
}
    

let setup = async function(){
    if(!fs.existsSync(dbFile)) fs.writeFileSync(dbFile,'');
    db = await new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE, async function(err) {
        if (err) {
            console.log('ERROR NUM 1')
            console.error(err.message);
        }

        let values = Object.values(tables);
        for(let u = 0; u < values.length; u++){
            let table = values[u];
            let tableIndex = u
            let keys = Object.keys(table);
            let vals = Object.values(table);

            let fields = "";
            for(let i = 0; i < keys.length; i++){
                fields += `${keys[i]} ${vals[i]}${i === keys.length-1 ? "":","}${"\n"}`
            }

            let createQuery = `CREATE TABLE ${Object.keys(tables)[tableIndex]} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${fields})`;

            await db.run(createQuery,function(err2){
                if(err2){
                   
                }
                
            });
            
            }
        //console.log('Connected to the database.');
    });
    await db.close()
  
};

//Adds any columns in the tables schema that are missing from an existing database
let migrate = async function(){
    let tableNames = Object.keys(tables);
    for(let i = 0; i < tableNames.length; i++){
        let table = tableNames[i];
        let existing = await get(`PRAGMA table_info(${table})`);
        if(!existing || existing.length === 0) continue; //Table not created yet - setup will create it in full
        let existingCols = existing.map(x => x.name);
        let cols = Object.keys(tables[table]);
        for(let e = 0; e < cols.length; e++){
            if(existingCols.indexOf(cols[e]) === -1){
                await write(`ALTER TABLE ${table} ADD COLUMN ${cols[e]} ${tables[table][cols[e]]}`, []);
            }
        }
    }
}

let getDevice = async function(id){
    let res = await get(`SELECT * FROM devices WHERE id = ?`, false, [id]);
    return res && res[0];
}

let deleteDevice = async function(id){
    let device = await getDevice(id);
    if(!device) return false;
    await write(`DELETE FROM discovery WHERE device = ?`, [device.device]);
    return await write(`DELETE FROM devices WHERE id = ?`, [id]);
}

let countDeviceMappings = async function(deviceId){
    let res = await get(`SELECT count(*) as count FROM mapping WHERE device = ?`, false, [deviceId]);
    return res && res[0] ? res[0].count : 0;
}

let getConfig = async function(){
    return await get(`SELECT * FROM devices order by name asc`);
}

let writeConfig = async function(data){
    if(data.id){
        let toUpdate = objToUpdate(data);
        let query = `UPDATE devices SET ${toUpdate.fields} WHERE id = ?`;
        let response =  await write(query, toUpdate.vals);
        return response;
    }else{
        delete data.id
        let toNew = objToNew(data);
        let query = `INSERT INTO devices (${toNew.fields}) VALUES (${toNew.qs})`;
        let response = await write(query, toNew.vals);
        return response
    }
}

let getPreferences = async function(instance){
    return await get(`SELECT * FROM discovery WHERE instance = "${instance}"`)
}

let writePreference = async function(instance, {device, discover}){
    let obj = {device,instance,discover};
    let currentData = await get(`SELECT * FROM discovery WHERE instance = "${instance}" AND device = "${device}"`);
    if(currentData.length !== 0 ){
        obj.id = currentData[0].id;
        let toUpdate = objToUpdate(obj);
        let query = `UPDATE discovery SET ${toUpdate.fields} WHERE id = ?`;
        let response =  await write(query, toUpdate.vals);
        return response;
    }else{
        let toNew = objToNew(obj);
        let query = `INSERT INTO discovery (${toNew.fields}) VALUES (${toNew.qs})`;
        let response = await write(query, toNew.vals);
        return response
    }
}

let getPlatformNames = async function(){
    return await get('SELECT * from platforms')
}

let getRepo = async function(){
    return await get(`SELECT * FROM mapping order by game asc`)
}

let newRepoRecord = async function(obj){
    let toNew = objToNew(obj);
    let query = `INSERT INTO mapping (${toNew.fields}) VALUES (${toNew.qs})`;
    let response = await write(query, toNew.vals);
    return response
}

let updateRepoCopiedFrom = async function(id){
    let date = c.functions.makeDate()
    let query = `UPDATE mapping SET lastCopiedFrom = "${date}" WHERE id = ?`;
    response = await write(query, [id])
    return date;
}

let updateRepoCopiedTo = async function(id){
    let date = c.functions.makeDate()
    let query = `UPDATE mapping SET lastCopiedTo = "${date}" WHERE id = ?`;
    response = await write(query, [id])
    return date;
}

let getFullMapping = async function(){
    let query = `
        SELECT mapping.id,
        mapping.game,
        mapping.path, 
        mapping.platform as platformID,
        mapping.device as deviceID,
        IFNULL(devices.name, 'Repository') as device,
        platforms.name as platform
        from mapping
        left join platforms on mapping.platform = platforms.short
        left join devices on mapping.device = devices.device
        ORDER by
        platform asc,
        game asc `;

    return await get(query);
}

let deleteMappingEntry = async function(id){
    return await write(`DELETE from mapping WHERE id = '${id}'`)
}

//Will retrun empty array if not found
let getGameFromID = async function(id, platform, like){
    let query = `SELECT title from db where gameid ${like?'like':'='} "${id}${like?'%':''}" AND platform = "${platform}"`;
    let res = await get(query, true);
    return res[0] && res[0].title ?  res[0].title: '';
}

let getSchema = function(){
    return tables;
}

module.exports={setup, migrate, getDevice, deleteDevice, countDeviceMappings, getConfig, writeConfig, getPreferences, writePreference, getSchema, getRepo, getPlatformNames, newRepoRecord, updateRepoCopiedFrom, updateRepoCopiedTo, getFullMapping, deleteMappingEntry, getGameFromID
}