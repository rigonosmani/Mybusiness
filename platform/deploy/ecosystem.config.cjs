// PM2 process definition for the Next.js standalone server.
module.exports = {
  apps: [{
    name: "kometa",
    cwd: __dirname + "/../.next/standalone",
    script: "server.js",
    env: { NODE_ENV: "production", PORT: "3000", HOSTNAME: "127.0.0.1" },
    max_memory_restart: "512M",
  }],
};
