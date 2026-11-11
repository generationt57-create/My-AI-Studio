FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-noto-core fonts-noto-extra fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]