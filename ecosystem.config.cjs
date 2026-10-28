// pm2 start ecosystem.config.cjs   (rodar dentro da pasta do painel, como o usuário dos projetos)
module.exports = {
  apps: [
    {
      name: "painel",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3005 -H 127.0.0.1",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
    },
  ],
};
