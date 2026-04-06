FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-cache

COPY . .
RUN npm run build && echo "=== BUILD OUTPUT ===" && ls -la dist/ && ls -la dist/routes/ && cat dist/index.js | head -30

EXPOSE 3001
CMD ["npm", "start"]
