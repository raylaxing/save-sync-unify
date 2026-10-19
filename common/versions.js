/*****
 * SAVE VERSIONS
 * A game can keep several saves in the repo, e.g. "Pokemon Gold" and "Pokemon Gold [2nd play through]".
 * Exactly one version is active: the game's repo mapping row points at its file, so syncing
 * (which reads/writes the repo row's path) always uses the active version.
 */
let fs = require('fs');

const BAD_LABEL = /[\[\]\/\\:*?"<>|]/;

let repoFile = p => `${process.env.REPO_PATH}${p}`;

let displayName = (game, label) => label ? `${game} [${label}]` : game;

let getRepoRow = async function(platform, game){
    let rows = await c.db.query(`SELECT * FROM mapping WHERE device = 'repo' AND platform = ? AND game = ?`, [platform, game]);
    return rows && rows[0];
};

//Returns the game's versions, creating the "original" entry from the repo row the first time
let ensureVersions = async function(platform, game){
    let repo = await getRepoRow(platform, game);
    if(!repo) throw new Error(`${game} has no repo copy yet - add it as a new game first`);

    let rows = await c.db.query(`SELECT * FROM versions WHERE platform = ? AND game = ? ORDER BY id`, [platform, game]);
    if(rows.length === 0){
        await c.db.run(`INSERT INTO versions (platform, game, label, path, active, created, lastCopiedFrom, lastCopiedTo) VALUES (?,?,?,?,?,?,?,?)`,
            [platform, game, '', repo.path, 1, '', repo.lastCopiedFrom || '', repo.lastCopiedTo || '']);
        rows = await c.db.query(`SELECT * FROM versions WHERE platform = ? AND game = ? ORDER BY id`, [platform, game]);
    }
    return {repo, rows};
};

let list = async function(platform, game){
    let {rows} = await ensureVersions(platform, game);
    return rows.map(function(v){
        let file = repoFile(v.path);
        let present = fs.existsSync(file);
        let stats = present ? fs.statSync(file) : null;
        return {
            id: v.id,
            label: v.label,
            name: displayName(game, v.label),
            path: v.path,
            active: v.active === 1,
            created: v.created,
            present,
            modifiedTime: stats ? stats.mtime : null,
            size: stats ? stats.size : 0
        };
    });
};

//Makes a version active: stores the outgoing version's copy dates and points the repo row at the new one
let setActive = async function(platform, game, id){
    let {repo, rows} = await ensureVersions(platform, game);
    let target = rows.find(v => v.id === +id);
    if(!target) throw new Error('Version not found');
    let current = rows.find(v => v.active === 1);
    if(current && current.id === target.id) return true;

    if(current){
        await c.db.run(`UPDATE versions SET active = 0, lastCopiedFrom = ?, lastCopiedTo = ? WHERE id = ?`,
            [repo.lastCopiedFrom || '', repo.lastCopiedTo || '', current.id]);
    }
    await c.db.run(`UPDATE versions SET active = 1 WHERE id = ?`, [target.id]);
    await c.db.run(`UPDATE mapping SET path = ?, lastCopiedFrom = ?, lastCopiedTo = ? WHERE id = ?`,
        [target.path, target.lastCopiedFrom || '', target.lastCopiedTo || '', repo.id]);
    return true;
};

//startFrom: 'copy' (snapshot of the active version) or 'empty' (filled by the next sync from a device)
let create = async function({platform, game, label, startFrom, activate}){
    label = `${label || ''}`.trim().replace(/\s+/g, ' ');
    if(!label) throw new Error('Give the version a comment, e.g. 2nd play through');
    if(BAD_LABEL.test(label)) throw new Error('The comment can\'t contain [ ] / \\ : * ? " < > |');

    let {rows} = await ensureVersions(platform, game);
    if(rows.some(v => (v.label || '').toLowerCase() === label.toLowerCase())) throw new Error('This game already has a version with that comment');

    let path = `/${platform}/${displayName(game, label)}`;
    if(fs.existsSync(repoFile(path))) throw new Error(`A file named "${displayName(game, label)}" is already in the repo`);

    if(startFrom === 'copy'){
        let active = rows.find(v => v.active === 1);
        if(!active || !fs.existsSync(repoFile(active.path))) throw new Error('The current version has no save in the repo to copy');
        c.functions.copy(repoFile(active.path), repoFile(path));
    }

    await c.db.run(`INSERT INTO versions (platform, game, label, path, active, created, lastCopiedFrom, lastCopiedTo) VALUES (?,?,?,?,?,?,?,?)`,
        [platform, game, label, path, 0, c.functions.makeDate(), '', '']);
    let created = (await c.db.query(`SELECT id FROM versions WHERE platform = ? AND game = ? AND path = ?`, [platform, game, path]))[0];

    if(activate) await setActive(platform, game, created.id);

    //Commit the new save file so it's kept in history
    if(startFrom === 'copy'){
        try{
            if(await c.git.exists(process.env.REPO_PATH)) await c.git.add(process.env.REPO_PATH);
        }catch(e){
            console.log(`Commit of new version failed: ${e.message}`);
        }
    }
    return created.id;
};

module.exports = {
    list,
    create,
    setActive,
    displayName
};
