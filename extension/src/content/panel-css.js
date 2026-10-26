// Styles of the in-page panel (inside the closed Shadow DOM, so the site's CSS never leaks in
// and ours never leaks out).
export const PANEL_CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.lwrap,.drawer,.hover,.menu,.toast{
  --bg:#ffffff;--bg2:#f4f5f9;--fg:#1d2330;--mut:#5d6676;--line:#d9dde6;--acc:#4f46e5;--accfg:#fff;--accsoft:#eceafd;--warn:#8a5300;--warnbg:#fff4dc;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--fg);
}
@media (prefers-color-scheme:dark){
  .lwrap,.drawer,.hover,.menu,.toast{--bg:#1b1e25;--bg2:#252933;--fg:#e7e9ee;--mut:#a0a7b4;--line:#3a404c;--acc:#9b94ff;--accfg:#14121f;--accsoft:#2d2a4a;--warn:#f0c060;--warnbg:#3a2f15}
}
button,input,select,textarea{font:inherit;color:inherit}
.lwrap{position:fixed;right:0;top:42vh}
.launcher{display:flex;align-items:center;justify-content:center;width:30px;height:42px;border:1px solid var(--line);border-right:0;border-radius:10px 0 0 10px;background:var(--bg);color:var(--acc);cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.12);opacity:.85;transition:opacity .15s,width .15s}
.launcher:hover,.launcher:focus-visible,.launcher[aria-expanded="true"]{opacity:1;width:36px}
:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
.drawer{position:fixed;right:12px;top:12px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:0 0 10px}
.drawer.dropping{outline:3px dashed var(--acc);outline-offset:-3px}
header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px;background:var(--bg);border-bottom:1px solid var(--line)}
header strong{font-size:14px}
.logo{color:var(--acc);display:flex}
.svc{color:var(--mut);font-size:12px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{border:0;background:none;cursor:pointer;color:var(--mut);font-size:17px;line-height:1;padding:4px 7px;border-radius:6px}
.icon:hover{background:var(--bg2);color:var(--fg)}
.warn{margin:10px 12px 0;padding:8px 10px;border-radius:8px;background:var(--warnbg);color:var(--warn);font-size:12px}
.cur{padding:10px 14px 4px}
.cur .title{margin:0 0 8px;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
select,input[type=text],input[type=search],textarea{border:1px solid var(--line);border-radius:7px;background:var(--bg);padding:5px 8px;min-width:0}
select{flex:1}
.btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--bg2);border-radius:7px;padding:5px 10px;cursor:pointer;white-space:nowrap}
.btn:hover:not(:disabled){border-color:var(--acc)}
.btn:disabled{opacity:.45;cursor:default}
.btn.small{padding:3px 8px;font-size:12px}
.btn.primary{background:var(--acc);border-color:var(--acc);color:var(--accfg)}
.pin.on{background:var(--accsoft);border-color:var(--acc);color:var(--acc)}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0;align-items:center}
.chip{--c:#888;border:1px solid var(--c);color:var(--fg);background:transparent;border-radius:999px;padding:1px 9px;font-size:12px;cursor:pointer}
.chip.on{background:var(--c);color:#fff}
.tagform{display:inline-flex}
.tagin{width:110px;font-size:12px;padding:2px 8px!important;border-radius:999px!important}
.exp{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:9px 0 2px}
.tabs{display:flex;gap:2px;margin:8px 12px 0;border-bottom:1px solid var(--line)}
.tabs button{flex:1;border:0;background:none;padding:7px 4px;cursor:pointer;color:var(--mut);border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button[aria-selected="true"]{color:var(--acc);border-bottom-color:var(--acc);font-weight:600}
.pane{padding:6px 12px 0}
.sec{margin:10px 2px 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:600}
ul{list-style:none;margin:0;padding:0}
.frow{--c:#888;display:flex;align-items:center;gap:7px;width:100%;border:1px solid transparent;background:none;text-align:left;padding:5px 6px;border-radius:7px;cursor:pointer}
.frow:hover{background:var(--bg2)}
.frow.over{border-color:var(--acc);background:var(--accsoft)}
.dropping .frow{border-style:dashed;border-color:var(--line)}
.caret{width:10px;color:var(--mut);font-size:10px}
.dot{width:10px;height:10px;border-radius:3px;background:var(--c);flex:none}
.fn{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cnt{color:var(--mut);font-size:12px}
.inner{margin:0 0 4px 16px}
li.sub>.frow{padding-left:4px}
.chats li,.inner li{display:flex;align-items:center}
a.chat{flex:1;display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:6px;color:var(--fg);text-decoration:none}
a.chat:hover{background:var(--bg2)}
a.chat[aria-current="page"]{background:var(--accsoft);color:var(--acc)}
.ct{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.pinmark{color:var(--acc);display:flex}
.more{font-size:15px;padding:2px 6px;visibility:hidden}
li:hover>.more,.more:focus-visible{visibility:visible}
.newf{display:flex;gap:6px;margin:10px 0 2px}
.newf input{flex:1}
.empty{color:var(--mut);margin:12px 2px;font-size:12.5px}
.hint{margin:8px 0;padding:6px 8px;border-radius:7px;background:var(--accsoft);color:var(--acc);font-size:12px}
.muted{color:var(--mut)}
.small{font-size:12px}
.q{width:100%;margin:4px 0 6px}
.res li a{display:block;padding:6px;border-radius:7px;color:var(--fg);text-decoration:none}
.res li a:hover{background:var(--bg2)}
.res .ct{display:block;font-weight:600}
.snip{display:block;color:var(--mut);font-size:12px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
mark{background:#ffe58a;color:#1d2330;border-radius:2px;padding:0 1px}
.plist li .prow{display:block;width:100%;text-align:left;border:0;background:none;padding:6px;border-radius:7px;cursor:pointer}
.prow:hover{background:var(--bg2)}
.prow .ct{display:block}
.vars{display:block;color:var(--acc);font:11.5px ui-monospace,Consolas,monospace}
.fill label{display:block;margin:6px 0}
.fill label span{display:block;font-size:12px;color:var(--mut);margin-bottom:2px}
.fill textarea{width:100%;resize:vertical}
.fill .title{font-weight:600;margin:6px 0}
.link{border:0;background:none;color:var(--acc);cursor:pointer;padding:8px 2px;font-size:12.5px;text-decoration:underline}
.hover{position:fixed;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--acc);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15);padding:0}
.menu{position:fixed;width:240px;max-height:360px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.22);padding:6px}
.menu .mt{margin:2px 6px 6px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--mut);font-size:12px}
.menu button{--c:transparent;display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:none;padding:6px 8px;border-radius:6px;cursor:pointer}
.menu button:hover,.menu button:focus-visible{background:var(--bg2)}
.menu button.fi::before{content:"";width:9px;height:9px;border-radius:3px;background:var(--c)}
.menu button.sub{padding-left:24px}
.menu button[aria-checked="true"]{color:var(--acc);font-weight:600}
.menu button[aria-checked="true"]::after{content:"✓";margin-left:auto}
.menu hr{border:0;border-top:1px solid var(--line);margin:5px 0}
.menu form input{width:100%;margin-top:4px}
.toast{position:fixed;right:20px;bottom:24px;background:var(--fg);color:var(--bg);padding:8px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25)}
`;
