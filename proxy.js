/**
 * Developer Project Gateway & Reverse Proxy
 * File Name: proxy.js
 * A zero-dependency, single-file Node.js Reverse Proxy and API.
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// --- 1. PROXIES CONFIGURATION ---
const PORT = 8000;
const PROJECTS_CONFIG = [
  {
    year: "2026",
    name: "AI Code Assistant",
    path: "/2026",
    target: "http://localhost:3026",
    description: "This year's flagship project - an intelligent local coding companion."
  },
  {
    year: "2025",
    name: "Microservice Playground",
    path: "/2025",
    target: "http://localhost:3025",
    description: "Last year's project exploring event-driven architectures and Redis."
  },
  {
    year: "2024",
    name: "Personal Portfolio & Sandbox",
    path: "/2024",
    target: "http://localhost:3024",
    description: "My interactive developer portfolio built with modern front-end frameworks."
  }
];

const requestLogs = [];
const projectHealth = {};
const startTime = Date.now();

PROJECTS_CONFIG.forEach(proj => {
  projectHealth[proj.path] = { status: 'offline', lastChecked: null };
});

// --- 2. HEALTH CHECK MONITOR ---
function checkProjectHealth() {
  PROJECTS_CONFIG.forEach(proj => {
    const parsedTarget = url.parse(proj.target);
    const options = {
      method: 'HEAD',
      host: parsedTarget.hostname,
      port: parsedTarget.port,
      path: parsedTarget.path || '/',
      timeout: 1500
    };

    const req = http.request(options, (res) => {
      projectHealth[proj.path] = { status: 'online', lastChecked: new Date().toLocaleTimeString() };
      res.resume();
    });

    req.on('error', () => {
      projectHealth[proj.path] = { status: 'offline', lastChecked: new Date().toLocaleTimeString() };
    });

    req.on('timeout', () => {
      projectHealth[proj.path] = { status: 'offline', lastChecked: new Date().toLocaleTimeString() };
      req.destroy();
    });

    req.end();
  });
}

setInterval(checkProjectHealth, 5000);
checkProjectHealth();

// --- 3. REVERSE PROXY LOGIC ---
function handleProxy(req, res, targetConfig) {
  const targetUrl = url.parse(targetConfig.target);
  let targetPath = req.url;

  if (targetPath.startsWith(targetConfig.path)) {
    targetPath = targetPath.substring(targetConfig.path.length);
    if (!targetPath.startsWith('/')) {
      targetPath = '/' + targetPath;
    }
  }

  const options = {
    host: targetUrl.hostname,
    port: targetUrl.port,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      'X-Forwarded-For': req.socket.remoteAddress,
      'X-Forwarded-Host': req.headers.host,
      'X-Forwarded-Proto': 'http',
      'host': targetUrl.host
    }
  };

  logRequest(req.method, req.url, `Proxied to ${targetConfig.target}${targetPath}`);

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    logRequest(req.method, req.url, `FAILED: ${err.message}`, true);
    renderBadGateway(res, targetConfig, err);
  });

  req.pipe(proxyReq);
}

function renderBadGateway(res, targetConfig, error) {
  res.writeHead(502, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>502 Bad Gateway</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-900 text-slate-100 flex items-center justify-center min-h-screen p-4">
      <div class="max-w-md w-full bg-slate-800 rounded-2xl border border-slate-700 p-8 shadow-2xl text-center">
        <h1 class="text-2xl font-bold mb-2">502 Bad Gateway</h1>
        <p class="text-slate-400 mb-6">Could not connect to: <strong class="text-indigo-400">${targetConfig.name}</strong>.</p>
        <div class="bg-slate-900 rounded-xl p-4 text-left mb-6 font-mono text-xs text-red-300 border border-slate-700/50">
          <div><strong>Target:</strong> ${targetConfig.target}</div>
          <div><strong>Reason:</strong> ${error.message}</div>
        </div>
        <a href="/dashboard" class="inline-block py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium">Go to Dashboard</a>
      </div>
    </body>
    </html>
  `);
}

function logRequest(method, url, action, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  requestLogs.push({ method, url, action, timestamp, isError });
  if (requestLogs.length > 50) requestLogs.shift();
  console.log(`[${timestamp}] ${method} ${url} -> ${action}`);
}

// --- 4. HTTP SERVER ---
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/api/status') {
    const uptimeMs = Date.now() - startTime;
    const uptimeSec = Math.floor((uptimeMs / 1000) % 60);
    const uptimeMin = Math.floor((uptimeMs / (1000 * 60)) % 60);
    const uptimeHrs = Math.floor(uptimeMs / (1000 * 60 * 60));

    const statusData = {
      uptime: `${uptimeHrs}h ${uptimeMin}m ${uptimeSec}s`,
      port: PORT,
      projects: PROJECTS_CONFIG,
      health: projectHealth,
      logs: requestLogs.slice(-15).reverse(),
      diagnostics: {
        nodeVersion: process.version,
        platform: `${process.platform} (${process.arch})`,
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(statusData));
  }

  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, htmlContent) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end(`<h2>Missing index.html dashboard file in this directory!</h2>`);
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlContent);
    });
    return;
  }

  const matchedProject = PROJECTS_CONFIG.find(proj => req.url.startsWith(proj.path));
  if (matchedProject) {
    return handleProxy(req, res, matchedProject);
  }

  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end(`<h2>404 - Route Not Found</h2>`);
});

server.listen(PORT, () => {
  console.log(`\n=== PROJECT GATEWAY ONLINE ===`);
  console.log(`Running at: http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard\n`);
});
