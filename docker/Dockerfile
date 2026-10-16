FROM node:slim

RUN sed -i "s|deb.debian.org|mirrors.ustc.edu.cn|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && sed -i "s|http://mirrors.ustc.edu.cn|https://mirrors.ustc.edu.cn|" /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get full-upgrade -y \
 && apt-get install -y --no-install-recommends \
    curl \
    git \
    valkey-server \
    chromium \
    fonts-lxgw-wenkai \
    fonts-noto-color-emoji \
 && apt-get autoremove --purge -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /var/cache/* /var/log/* /root/.npm \
 && ln -vsf $(which valkey-server || echo /usr/bin/valkey-server) /bin/redis-server \
 && ln -vsf $(which valkey-server || echo /usr/bin/valkey-server) /usr/local/bin/redis-server \
 && git config --global --add safe.directory "*" \
 && npm install -g pnpm --registry https://registry.npmmirror.com

WORKDIR /root/Yunzai

EXPOSE 2536

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s CMD curl -fs http://127.0.0.1:2536/status || exit 1

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
