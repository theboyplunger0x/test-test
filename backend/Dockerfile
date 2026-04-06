FROM node:22-slim

WORKDIR /app

# Copy everything first to bust cache on any file change
COPY . .
RUN npm install && npm run build && echo "ROUTES:" && ls dist/routes/ && echo "INDEX HEAD:" && head -5 dist/index.js

EXPOSE 3001
CMD ["node", "dist/index.js"]
