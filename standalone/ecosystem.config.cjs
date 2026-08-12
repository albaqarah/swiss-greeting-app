// pm2 ecosystem file — `pm2 start ecosystem.config.cjs`
// All settings (PIN, port, mode) live in the .env file next to this file.
module.exports = {
  apps: [
    {
      name: "genius-bot",
      script: "server/dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
