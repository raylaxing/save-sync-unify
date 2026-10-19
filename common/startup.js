let db = require('./sqlite.js');
let fs = require('fs');
let pth = require('path');
let crypto = require('crypto');

module.exports = async function(){

    if(!process.env.REPO_PATH){
        console.log('NO REPO PATH')
        return false;
    }else{
        c.functions.dirCreate(process.env.REPO_PATH);
        c.functions.dirCreate(process.env.REPO_PATH+'/DEVICE');
        c.functions.dirCreate(process.env.REPO_PATH+'/TRACE');
    }
    

    //Makes runtime identity
    let identifierPath = pth.join(process.cwd(), 'instance');
    global.identity = fs.existsSync(identifierPath) ? fs.readFileSync(identifierPath).toString() : function(){
        let newId = crypto.randomBytes(8).toString('hex');
        fs.writeFileSync(identifierPath, newId);
        return newId;
    }();
    

    //DB Check
    await db.setup();
    await db.migrate();
    return true;
}