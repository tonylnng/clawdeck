FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production=false

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=0 /app/dist ./dist

RUN mkdir -p /app/logs

EXPOSE 18790

CMD ["node", "dist/index.js"]
