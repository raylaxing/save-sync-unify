let simpleGit = require('simple-git');
let fs = require('fs');

let exists = async function(path){
    if(fs.existsSync(path)){
        let git = await simpleGit(path);
        let response = await git.checkIsRepo()
        return response
    }
    return false
}

//Stages new and modified files under path (a folder inside the repo) and commits them.
//git runs from inside path, so stage "." rather than the repo-root-relative paths git status reports.
let add = async function(path){
    let git = await simpleGit(path);
    await git.add(['--ignore-removal', '.']);

    let staged = await git.diff(['--cached', '--name-only']);
    if(staged.trim() === '') return false;

    await git.commit(c.functions.numberDate());
    return true;
}

let push = async function(path){
    let git = await simpleGit(path);
    let res = await git.push(['-u','origin', 'master']);
    return res;
}

module.exports = {
    exists,
    add,
    push

}