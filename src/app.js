let user = null;
let messages = [];
let input = '';
let isLogin = true;
let username = '';
let password = '';
let ws = null;
let activeUsers = [];
let showUserList = false;
let announcement = null;
let tagMap = {};
let bannedInfo = null;

export function render() {
  const root = document.getElementById('root');
  if (bannedInfo) {
    const isNowBan = bannedInfo.expiresAt === 0;
    root.innerHTML = `
      <div class="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white">
        <h1 class="text-4xl font-bold mb-4">You are banned</h1>
        <p class="text-zinc-400 mb-2">Reason: ${bannedInfo.reason}</p>
        ${isNowBan ? `
          <p class="text-emerald-500 font-bold">Join back, but be more careful</p>
        ` : `
          <p class="text-red-500">Banned until: ${new Date(bannedInfo.expiresAt).toLocaleString()}</p>
        `}
      </div>
    `;
  } else if (!user) {
    root.innerHTML = `
      <div class="flex flex-col items-center justify-center h-screen bg-zinc-950 text-white">
        <h1 class="text-4xl font-bold mb-8">BilalNet</h1>
        <div class="bg-zinc-900 p-8 rounded-xl shadow-md w-80">
          <input id="username" class="w-full p-2 mb-4 bg-zinc-800 rounded" placeholder="Username" value="${username}" />
          <input id="password" class="w-full p-2 mb-4 bg-zinc-800 rounded" type="password" placeholder="Password" value="${password}" />
          <button id="auth-btn" class="w-full p-2 bg-emerald-600 rounded mb-2 hover:bg-emerald-700 transition">${isLogin ? 'Login' : 'Signup'}</button>
          <button id="toggle-auth" class="text-sm text-zinc-400 w-full">${isLogin ? 'Need an account? Signup' : 'Have an account? Login'}</button>
        </div>
      </div>
    `;
    document.getElementById('username').addEventListener('input', (e) => username = e.target.value);
    document.getElementById('password').addEventListener('input', (e) => password = e.target.value);
    document.getElementById('auth-btn').addEventListener('click', () => handleAuth(isLogin ? 'login' : 'signup'));
    document.getElementById('toggle-auth').addEventListener('click', () => { isLogin = !isLogin; render(); });
  } else {
    root.innerHTML = `
      <div class="flex flex-col h-screen bg-zinc-950 text-white">
        <header class="p-4 border-b border-zinc-800 flex justify-between items-center">
          <h1 class="text-xl font-bold">BilalNet</h1>
          <button id="toggle-users" class="text-sm bg-zinc-800 px-3 py-1 rounded">Users</button>
        </header>
        ${announcement ? `
          <div class="p-2 bg-red-600 text-white text-center font-bold">
            ${announcement}
          </div>
        ` : ''}
        ${showUserList ? `
          <div class="p-4 bg-zinc-900 border-b border-zinc-800">
            <h2 class="font-bold mb-2">Active Users</h2>
            <ul>${activeUsers.map(u => `<li class="text-emerald-500">${u}</li>`).join('')}</ul>
          </div>
        ` : ''}
        <div id="messages" class="flex-1 overflow-y-auto p-4">
          ${messages.map(m => `
            <div class="mb-2">
              <span class="font-bold" style="color: ${tagMap[m.username] || '#10b981'}">${m.username}: </span>
              <span>${m.content}</span>
            </div>
          `).join('')}
        </div>
        <div class="p-4 border-t border-zinc-800 flex flex-col gap-2">
          <div class="flex">
            <input id="message-input" class="flex-1 p-2 bg-zinc-800 rounded" value="${input}" />
            <button id="send-btn" class="ml-2 p-2 bg-emerald-600 rounded hover:bg-emerald-700 transition">Send</button>
          </div>
          <div class="text-xs text-zinc-500 mt-2">
            <p>Targeting users: Central school, a Oxford elementary school</p>
            <p>Creator: Bilal hamama</p>
          </div>
        </div>
      </div>
    `;
    document.getElementById('message-input').addEventListener('input', (e) => input = e.target.value);
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('toggle-users').addEventListener('click', () => { showUserList = !showUserList; render(); });
    
    if (!ws) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', username: user }));
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'chat') {
          messages.push(message);
          if (messages.length > 200) messages.shift();
        } else if (message.type === 'userList') {
          activeUsers = message.users;
          tagMap = message.tagMap;
        } else if (message.type === 'announcement') {
          announcement = message.content;
          render();
          setTimeout(() => {
            announcement = null;
            render();
          }, 5000);
        } else if (message.type === 'banned') {
          bannedInfo = { reason: message.reason, expiresAt: message.expiresAt };
          render();
        } else if (message.type === 'error') {
          alert(message.message);
          user = null;
          render();
        }
        render();
      };
    }
  }
}

async function handleAuth(type) {
  const response = await fetch(`/api/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.ok) {
    user = username;
    render();
  } else {
    alert('Auth failed');
  }
}

function sendMessage() {
  if (input.trim() && ws) {
    ws.send(JSON.stringify({ type: 'chat', content: input }));
    input = '';
    render();
  }
}
