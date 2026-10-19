const sqlite3 = require('sqlite3').verbose();
let fs = require('fs');
let path = process.env.REPO_PATH;
let dbFile = `${path}/repo.db`;
let gamedbFile = `${path}/gamedb.db`;
const BUSY_TIMEOUT = 5000;
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
    },
    //Save versions of a game kept in the repo - the active one is what the repo mapping row points at
    versions:{
        "platform":         "TEXT",
        "game":             "TEXT",
        "label":            "TEXT",
        "path":             "TEXT",
        "active":           "INTEGER",
        "created":          "TEXT",
        "lastCopiedFrom":   "TEXT",
        "lastCopiedTo":     "TEXT"
    }
}



//Each query opens its own connection and closes it once the query has finished
let get = function(y, gameDBbool, params = []){
    let databaseFile = gameDBbool? gamedbFile: dbFile;
    return new Promise(function(resolve){
        let db = new sqlite3.Database(databaseFile, sqlite3.OPEN_READWRITE, function(err) {
            if(err){
                console.log('ERROR', err.message);
                return resolve(false);
            }
            //Wait for another connection's write instead of failing with SQLITE_BUSY
            db.configure('busyTimeout', BUSY_TIMEOUT);
            db.all(y, params, function(err, res){
                db.close();
                resolve(err ? false : res);
            });
        });
    })
}

let write = function(y, z){
    return new Promise(function(resolve){
        let db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE, (err) => {
            if(err){
                console.log(err);
                return resolve(false);
            }
            db.configure('busyTimeout', BUSY_TIMEOUT);
            db.run(y, z, function(err){
                db.close();
                if(err) console.log(err);
                resolve(!err);
            });
        });
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
    

//Creates any missing tables. Resolves only once every CREATE has finished, so later
//startup steps (migrate) don't race it for the database lock.
let setup = function(){
    if(!fs.existsSync(dbFile)) fs.writeFileSync(dbFile,'');
    return new Promise(function(resolve){
        let db = new sqlite3.Database(dbFile, sqlite3.OPEN_READWRITE, function(err) {
            if (err) {
                console.log('ERROR NUM 1')
                console.error(err.message);
                return resolve(false);
            }
            db.serialize(function(){
                Object.keys(tables).forEach(function(name){
                    let fields = Object.keys(tables[name]).map(k => `${k} ${tables[name][k]}`).join(',\n');
                    db.run(`CREATE TABLE IF NOT EXISTS ${name} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${fields})`, function(err2){
                        if(err2) console.log(`Could not create table ${name}: ${err2.message}`);
                    });
                });
            });
            //close() waits for the queued CREATEs
            db.close(() => resolve(true));
        });
    });
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
                let ok = await write(`ALTER TABLE ${table} ADD COLUMN ${cols[e]} ${tables[table][cols[e]]}`, []);
                console.log(ok ? `Added column ${table}.${cols[e]}` : `FAILED to add column ${table}.${cols[e]} - see error above`);
            }
        }
    }
}

//Parameterised helpers for modules that need their own queries
let query = function(sql, params = []){
    return get(sql, false, params);
};
let run = function(sql, params = []){
    return write(sql, params);
};

//The old config page saved empty fields as the text "null"/"undefined" - blank them out
let cleanDevices = async function(){
    let existing = await get(`PRAGMA table_info(devices)`) || [];
    let cols = existing.map(x => x.name).filter(x => x !== 'id');
    for(let i = 0; i < cols.length; i++){
        await write(`UPDATE devices SET ${cols[i]} = '' WHERE ${cols[i]} IN ('null', 'undefined')`, []);
    }
};

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

module.exports={setup, migrate, cleanDevices, query, run, getDevice, deleteDevice, countDeviceMappings, getConfig, writeConfig, getPreferences, writePreference, getSchema, getRepo, getPlatformNames, newRepoRecord, updateRepoCopiedFrom, updateRepoCopiedTo, getFullMapping, deleteMappingEntry, getGameFromID
}