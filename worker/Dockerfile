FROM node:22-slim
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src src
CMD ["node", "src/index.js"]
