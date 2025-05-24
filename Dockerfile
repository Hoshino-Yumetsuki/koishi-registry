FROM node:lts

# ARG https_proxy http://192.168.1.100:7890
# ARG http_proxy http://192.168.1.100:7890

COPY . /koishi-registry

WORKDIR /koishi-registry

RUN npm config set registry https://registry.npmmirror.com
RUN npm install


EXPOSE 3000
CMD ["node", "./src/index.js" ,"--server"]