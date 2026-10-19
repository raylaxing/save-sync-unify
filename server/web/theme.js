/*****
 * DARK MODE - shared by index.html and config.html
 * Loaded in <head> so the theme is applied before the page paints.
 * Saved choice wins, otherwise follows the system setting.
 */
(function(){
    const KEY = 'theme';
    //NES.css components that have an .is-dark variant
    const DARKABLE = '.nes-container, .nes-input, .nes-textarea, .nes-select, .nes-radio, .nes-checkbox, .nes-table, .nes-dialog';
    let system = window.matchMedia('(prefers-color-scheme: dark)');

    let saved = function(){
        try { return localStorage.getItem(KEY); } catch(e) { return null; }
    };
    let isDark = function(){
        let s = saved();
        return s ? s === 'dark' : system.matches;
    };

    let paint = function(root){
        let dark = document.documentElement.dataset.theme === 'dark';
        if(root.matches && root.matches(DARKABLE)) root.classList.toggle('is-dark', dark);
        if(root.querySelectorAll) root.querySelectorAll(DARKABLE).forEach(el => el.classList.toggle('is-dark', dark));
    };

    let apply = function(){
        let dark = isDark();
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        if(document.body) paint(document.body);
        let btn = document.getElementById('themeToggle');
        if(btn){
            btn.textContent = dark ? 'Light' : 'Dark';
            btn.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
        }
    };

    window.toggleTheme = function(){
        try { localStorage.setItem(KEY, isDark() ? 'light' : 'dark'); } catch(e) {}
        apply();
    };

    apply();
    system.addEventListener('change', apply);

    document.addEventListener('DOMContentLoaded', function(){
        let btn = document.createElement('button');
        btn.id = 'themeToggle';
        btn.className = 'nes-btn';
        btn.onclick = window.toggleTheme;
        document.body.appendChild(btn);
        apply();

        //Pages re-render with innerHTML, so darken new NES elements as they appear
        new MutationObserver(function(mutations){
            if(document.documentElement.dataset.theme !== 'dark') return;
            mutations.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && paint(n)));
        }).observe(document.body, {childList: true, subtree: true});
    });
})();
