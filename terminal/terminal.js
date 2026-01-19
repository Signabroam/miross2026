/* Terminal emulator (client-side only)
   Features: command history, autocomplete (Tab), virtual filesystem, basic commands
   Keyboard: Enter to run, Up/Down for history, Tab for autocomplete, Ctrl+L to clear
*/
(function(){
  const screen = document.getElementById('screen');
  const cmdEl = document.getElementById('cmd');
  const promptEl = document.getElementById('prompt');

  // persistent state keys
  const LS_KEYS = {history:'webterm_history_v1', fs:'webterm_fs_v1', config:'webterm_cfg_v1'};

  // default virtual filesystem (simple map of path -> {type, content})
  const defaultFS = {
    '/': {type:'dir', children:{'home':{type:'dir', children:{'readme.txt':{type:'file',content:'Bienvenue dans l\'émulateur de terminal. Tapez "help" pour commencer.'}}}}},
  };

  // load/store helpers
  function loadJSON(key, fallback){
    try{const v = localStorage.getItem(key); return v? JSON.parse(v): fallback}
    catch(e){return fallback}
  }
  function saveJSON(key,obj){ localStorage.setItem(key, JSON.stringify(obj)); }

  // state
  let history = loadJSON(LS_KEYS.history, []);
  let fs = loadJSON(LS_KEYS.fs, defaultFS);
  let config = loadJSON(LS_KEYS.config, {cwd:'/home'});
  let histIndex = history.length;

  // utility: sanitize for display
  function createLine(text, cls){ const d=document.createElement('div'); d.className='line '+(cls||''); d.innerText = text; return d }

  function print(text, cls){
    if(text==null) return;
    if(Array.isArray(text)) text.forEach(t=>print(t,cls));
    else screen.appendChild(createLine(text, cls));
    scrollBottom();
  }

  function scrollBottom(){ screen.scrollTop = screen.scrollHeight }

  // prompt
  function renderPrompt(){
    const user = 'webuser';
    const host = 'webterm';
    promptEl.innerText = `${user}@${host}:${config.cwd}$`;
  }

  // simple path resolver
  function resolvePath(p){
    if(!p) return config.cwd;
    if(p.startsWith('/')) return normalizePath(p);
    return normalizePath(config.cwd + '/' + p);
  }

  function normalizePath(p){
    const parts = p.split('/').filter(Boolean);
    const stack = [];
    for(const part of parts){
      if(part==='.' ) continue;
      if(part==='..') stack.pop();
      else stack.push(part);
    }
    return '/' + stack.join('/');
  }

  function getNode(path){
    const norm = normalizePath(path);
    if(norm==='/' ) return fs['/'];
    const parts = norm.slice(1).split('/');
    let node = fs['/'];
    for(const p of parts){
      if(!node || node.type!=='dir' || !node.children) return null;
      node = node.children[p];
    }
    return node||null;
  }

  function ensureParentDir(path){
    const parent = normalizePath(path + '/../');
    return getNode(parent) && getNode(parent).type==='dir';
  }

  // Commands
  const commands = {
    help(args){
      return [
        'Available commands: help, clear, ls, cd, pwd, cat, touch, rm, mkdir, rmdir, echo, date, whoami, history, man, grep, head, tail, calc, theme',
        'Shortcuts: Up/Down history, Tab autocompletion, Ctrl+L = clear.'
      ];
    },
    clear(){ screen.innerHTML=''; return null },
    pwd(){ return config.cwd },
    ls(args){
      const p = resolvePath(args[0]||'.');
      const node = getNode(p);
      if(!node) return `ls: impossible to access '${p}': No such file or directory`;
      if(node.type==='file') return args[0]||p;
      const names = Object.keys(node.children||{}).map(n=>{ const t=node.children[n].type; return (t==='dir'?n+'/':n)});
      return names.join('  ');
    },
    cd(args){
      const p = args[0] ? resolvePath(args[0]) : '/home';
      const node = getNode(p);
      if(!node || node.type!=='dir') return `cd: ${args[0]}: No such directory`;
      config.cwd = p; saveJSON(LS_KEYS.config, config); renderPrompt(); return null;
    },
    cat(args){
      if(!args[0]) return 'cat: missing file';
      const p = resolvePath(args[0]);
      const node = getNode(p);
      if(!node) return `cat: ${args[0]}: No such file`;
      if(node.type==='dir') return `cat: ${args[0]}: Is a directory`;
      return node.content||'';
    },
    touch(args){
      if(!args[0]) return 'touch: missing file operand';
      const p = resolvePath(args[0]);
      const parent = getNode(p+'/../');
      const name = p.split('/').pop();
      const dir = getNode(p.replace(/\/[^/]+$/, '')||'/');
      // ensure parent exists
      const parentPath = p.split('/').slice(0,-1).join('/')||'/';
      const parentNode = getNode(parentPath);
      if(!parentNode || parentNode.type!=='dir') return `touch: cannot touch '${args[0]}': No such directory`;
      parentNode.children[name] = parentNode.children[name] || {type:'file', content:''};
      saveJSON(LS_KEYS.fs, fs);
      return null;
    },
    mkdir(args){
      if(!args[0]) return 'mkdir: missing operand';
      const p = resolvePath(args[0]);
      const parentPath = p.split('/').slice(0,-1).join('/')||'/';
      const parentNode = getNode(parentPath);
      if(!parentNode || parentNode.type!=='dir') return `mkdir: cannot create directory '${args[0]}': No such file or directory`;
      const name = p.split('/').pop();
      parentNode.children[name] = {type:'dir', children:{}};
      saveJSON(LS_KEYS.fs, fs);
      return null;
    },
    rm(args){
      if(!args[0]) return 'rm: missing operand';
      const p = resolvePath(args[0]);
      if(p==='/' ) return 'rm: refusing to remove root';
      const parentPath = p.split('/').slice(0,-1).join('/')||'/';
      const name = p.split('/').pop();
      const parent = getNode(parentPath);
      if(!parent || !parent.children || !parent.children[name]) return `rm: cannot remove '${args[0]}': No such file or directory`;
      delete parent.children[name]; saveJSON(LS_KEYS.fs, fs); return null;
    },
    rmdir(args){ return commands.rm(args) },
    echo(args, raw){
      const s = args.join(' ');
      // support redirection >
      const m = s.match(/^(.*)\s+>\s+(.+)$/);
      if(m){ const txt = m[1]; const target = resolvePath(m[2]); const parentPath = target.split('/').slice(0,-1).join('/')||'/'; const parent=getNode(parentPath); if(!parent) return `echo: cannot create '${m[2]}': No such directory`; parent.children[target.split('/').pop()] = {type:'file', content:txt}; saveJSON(LS_KEYS.fs, fs); return null }
      return s;
    },
    date(){ return new Date().toString() },
    whoami(){ return 'webuser' },
    history(){ return history.map((h,i)=> `${i+1}  ${h}` ).join('\n') },
    man(args){
      if(!args[0]) return 'man: what manual page do you want?';
      const cmd = args[0];
      const docs = {help:'Displays help', ls:'Lists files', cd:'Changes directory', cat:'Displays file', clear:'Clears screen', echo:'Displays text or redirects > file', calc:'Simple calculator (e.g. calc 2+2)'};
      return docs[cmd] || `No manual entry for ${cmd}`;
    },
    grep(args){
      if(args.length<1) return 'grep: missing pattern';
      const pattern = args[0];
      const file = args[1];
      if(!file) return 'grep: missing file operand';
      const content = commands.cat([file]);
      if(typeof content !== 'string') return content;
      return content.split('\n').filter(l=> l.includes(pattern)).join('\n');
    },
    head(args){
      const file = args[0]; const n = parseInt(args[1]||'10',10);
      const content = commands.cat([file]); if(typeof content !== 'string') return content;
      return content.split('\n').slice(0,n).join('\n');
    },
    tail(args){
      const file = args[0]; const n = parseInt(args[1]||'10',10);
      const content = commands.cat([file]); if(typeof content !== 'string') return content;
      const lines = content.split('\n'); return lines.slice(Math.max(0,lines.length-n)).join('\n');
    },
    calc(args){
      if(!args[0]) return 'calc: missing expression';
      // safe eval: allow digits, operators and spaces only
      const expr = args.join('');
      if(!/^[0-9+\-*/().\s]+$/.test(expr)) return 'calc: invalid characters';
      try{ // eslint-disable-next-line no-eval
        const res = eval(expr); return String(res);
      }catch(e){return 'calc: error'}
    },
    theme(args){
      const t = args[0]||'dark';
      const el = document.getElementById('terminal');
      el.className = t==='light' ? 'theme-light' : 'theme-dark';
      return `Theme: ${t}`;
    }
  };

  // network and info-like simulated commands
  commands.curl = async function(args){
    if(!args[0]) return 'curl: usage: curl <url> [-o filename]';
    // simple arg parsing for -o
    let url = args.find(a=>!a.startsWith('-'));
    let outIdx = args.indexOf('-o');
    if(outIdx===-1) outIdx = args.indexOf('--output');
    let outFile = null;
    if(outIdx!==-1) outFile = args[outIdx+1];
    try{
      const res = await fetch(url);
      const text = await res.text();
      const truncated = text.length>20000 ? text.slice(0,20000)+'\n... (truncated)' : text;
      if(outFile){
        const path = resolvePath(outFile);
        const parentPath = path.split('/').slice(0,-1).join('/')||'/';
        const parent = getNode(parentPath);
        if(!parent) return `curl: cannot create '${outFile}': No such directory`;
        parent.children[path.split('/').pop()] = {type:'file', content:text};
        saveJSON(LS_KEYS.fs, fs);
        return `Saved ${outFile}`;
      }
      return truncated;
    }catch(e){
      return `curl: error fetching ${url}: ${e.message||e}`;
    }
  };

  commands.wget = async function(args){
    if(!args[0]) return 'wget: usage: wget <url> [-O filename]';
    const url = args[0];
    let out = args[1];
    if(!out) out = url.split('/').pop() || 'index.html';
    try{
      const res = await fetch(url);
      const text = await res.text();
      const path = resolvePath(out);
      const parentPath = path.split('/').slice(0,-1).join('/')||'/';
      const parent = getNode(parentPath);
      if(!parent) return `wget: cannot create '${out}': No such directory`;
      parent.children[path.split('/').pop()] = {type:'file', content:text};
      saveJSON(LS_KEYS.fs, fs);
      return `Downloaded '${out}'`;
    }catch(e){
      return `wget: error: ${e.message||e}`;
    }
  };

  commands.ping = function(args){
    const target = args[0] || 'localhost';
    const count = parseInt(args[1]||'4',10);
    const results = [];
    for(let i=0;i<count;i++){
      const ms = Math.floor(20 + Math.random()*180);
      const ok = Math.random()>0.08;
      if(ok) results.push(`64 bytes from ${target}: icmp_seq=${i+1} ttl=64 time=${ms} ms`);
      else results.push(`Request timeout for icmp_seq ${i+1}`);
    }
    const received = results.filter(r=> r.includes('64 bytes')).length;
    results.push(`--- ${target} ping statistics ---`);
    results.push(`${count} packets transmitted, ${received} received, ${(100*(count-received)/count).toFixed(1)}% packet loss`);
    return results.join('\n');
  };

  commands.neofetch = function(){
    const ua = navigator.userAgent;
    const platform = navigator.platform || 'web';
    const lang = navigator.language || '';
    const screenSize = `${window.screen.width}x${window.screen.height}`;
    // count files
    function countNodes(node){ if(!node) return 0; if(node.type==='file') return 1; return Object.values(node.children||{}).reduce((s,n)=>s+countNodes(n), 0) + 1 }
    const fsCount = countNodes(fs['/']);
    const ascii = ['       .--.      ','      |o_o |     ','      |:_/ |     ','     //   \ \    ','    (|     | )   ','   /\_`---'+'`_/\  ','   \_/     \_/   '];
    const info = [
      `User: webuser@webterm.keamsos`,
      `OS: Browser (${platform})`,
      `Browser: ${ua.split(') ')[0]})`,
      `Resolution: ${screenSize}`,
      `Locale: ${lang}`,
      `Filesystem nodes: ${fsCount}`
    ];
    const out = [];
    for(let i=0;i<Math.max(ascii.length, info.length); i++){
      out.push((ascii[i]||'') + '  ' + (info[i]||''));
    }
    return out.join('\n');
  };

  commands.uname = function(args){
    const a = navigator.userAgent; const p = navigator.platform || 'web';
    if(args.includes('-a')) return `${p} ${a}`;
    return p;
  };

  commands.top = function(args){
    const procs = [];
    for(let i=0;i<8;i++){
      procs.push({pid:1000+i, user:'webuser', cpu:(Math.random()*30).toFixed(1), mem:(Math.random()*200).toFixed(1), cmd:['node','chrome','python','bash','vim'][Math.floor(Math.random()*5)]});
    }
    const header = ` PID   USER     %CPU  %MEM  COMMAND`;
    const lines = procs.map(p=> ` ${p.pid}  ${p.user}   ${p.cpu}   ${p.mem}   ${p.cmd}`);
    return [header].concat(lines).join('\n');
  };

  const builtinNames = Object.keys(commands);

  // Execute
  function runCommand(line){
    if(!line.trim()) return;
    history.push(line); saveJSON(LS_KEYS.history, history); histIndex = history.length;
    // display the typed command
    const p = document.createElement('div'); p.className='line prompt entry'; p.innerText = promptEl.innerText + ' ' + line; screen.appendChild(p);
    // parse
    const parts = line.match(/(?:[^"\s]+|"[^"]*")+/g) || [];
    const cmd = parts[0];
    const args = (parts.slice(1)).map(s=> s.replace(/^"|"$/g,''));
    if(!cmd) return;
    const fn = commands[cmd];
    if(!fn) { print(`${cmd}: command not found`, 'error'); return }
    try{
      const out = fn(args, line);
      if(out===null) return;
      // handle promise (async commands like curl/wget)
      if(out && typeof out.then === 'function'){
        out.then(res=>{
          if(res===null) return;
          if(typeof res === 'string' && res.includes('\n')) res.split('\n').forEach(l=> print(l));
          else print(res);
        }).catch(e=> print('Error: '+(e && e.message?e.message:e), 'error'));
      }else{
        if(typeof out === 'string' && out.includes('\n')) out.split('\n').forEach(l=> print(l));
        else print(out);
      }
    }catch(e){ print('Error: '+e.message, 'error') }
  }

  // Focus helper
  function focusInput(){ cmdEl.focus(); placeCaretAtEnd(cmdEl); }
  function placeCaretAtEnd(el){
    el.focus();
    if(typeof window.getSelection !== 'undefined' && typeof document.createRange !== 'undefined'){
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
  }

  // input events
  cmdEl.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){
      e.preventDefault(); const line = cmdEl.innerText.replace(/\u00A0/g,' '); cmdEl.innerText=''; runCommand(line); scrollBottom(); return;
    }
    if(e.key==='ArrowUp'){
      e.preventDefault(); if(history.length===0) return; histIndex = Math.max(0, histIndex-1); cmdEl.innerText = history[histIndex]||''; placeCaretAtEnd(cmdEl); return;
    }
    if(e.key==='ArrowDown'){
      e.preventDefault(); histIndex = Math.min(history.length, histIndex+1); cmdEl.innerText = history[histIndex]||''; placeCaretAtEnd(cmdEl); return;
    }
    if(e.key==='Tab'){
      e.preventDefault(); autocomplete(); return;
    }
    if(e.ctrlKey && e.key.toLowerCase()==='l'){
      e.preventDefault(); commands.clear(); return;
    }
  });

  // autocomplete: complete command or file name of last token
  function autocomplete(){
    const text = cmdEl.innerText;
    const parts = text.match(/(?:[^\"\s]+|\"[^\"]*\")+/g) || [];
    const last = parts[parts.length-1] || '';
    const candidates = builtinNames.concat(listAllFilesInCwd());
    const matches = candidates.filter(c=> c.startsWith(last));
    if(matches.length===1){
      // replace last token with match
      parts[parts.length-1] = matches[0]; cmdEl.innerText = parts.join(' '); placeCaretAtEnd(cmdEl);
    }else if(matches.length>1){ print(matches.join('  ')); }
  }

  function listAllFilesInCwd(){
    const node = getNode(config.cwd);
    if(!node || node.type!=='dir') return [];
    return Object.keys(node.children||{});
  }

  // initial render
  renderPrompt(); focusInput();

  // click on screen focuses input
  screen.addEventListener('click', ()=> focusInput());
  document.getElementById('terminal').addEventListener('click', ()=> focusInput());

  // expose for debugging
  window.webterm = {fs, save:()=>saveJSON(LS_KEYS.fs, fs), clearHistory:()=>{history=[];saveJSON(LS_KEYS.history,history)}};

})();
