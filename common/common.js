
module.exports={
    startup: require('./startup.js'),
    db: require('./sqlite.js'),
    devices:require('./devices.js'),
    ftp:require('./ftp.js'),
    sftp:require('./sftp.js'),
    local:require('./local.js'),
    functions:require('./functions.js'),
    git: require('./git.js'),
    rom: require('./rom.js'),
    deviceConfig: require('./deviceConfig.js'),
    progress: require('./progress.js'),
    versions: require('./versions.js')

}