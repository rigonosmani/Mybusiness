// CommonJS entry point. Hosts like Hostinger and cPanel load the app with require(),
// which can't load ES modules directly on Node 20, so this file imports the real server.
const path = require("node:path");
const http = require("node:http");

process.chdir(path.join(__dirname, ".."));

import("./server.mjs").catch((err) => {
  console.error("Lexopak failed to start:", err);
  // Show the reason in the browser instead of a bare 503, so it can be fixed without server logs.
  http
    .createServer((req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Lexopak failed to start:\n\n${err.message}\n`);
    })
    .listen(process.env.PORT || 3000);
});
