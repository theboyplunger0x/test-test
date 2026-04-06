FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-cache

COPY . .
RUN npm run build && echo "BUILD_TS=$(date +%s)" > /tmp/build_marker

EXPOSE 3001
CMD ["npm", "start"]
