// pm2 process file used on the server: `pm2 start ecosystem.config.cjs`
module.exports = {
  apps: [
    {
      name: "memspace-demo",
      script: "src/server.js",
      env: { NODE_ENV: "production", PORT: 3100 },
      max_memory_restart: "200M",
    },
  ],
};
