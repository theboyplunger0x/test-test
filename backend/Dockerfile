FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build
RUN npm prune --production

EXPOSE 3001
CMD ["npm", "start"]
