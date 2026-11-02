# Atende.IA — imagem do servidor (funciona em ARM, como a VM gratuita da Oracle, e em x86).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Dependências primeiro: a camada fica em cache enquanto o package-lock não muda.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Nunca roda como root dentro do container.
USER node
EXPOSE 3011 3012
CMD ["node", "server.js"]
