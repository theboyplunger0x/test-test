FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-cache

COPY . .
ARG CACHEBUST=1
RUN npm run build && ls dist/routes/

EXPOSE 3001
CMD ["npm", "start"]
