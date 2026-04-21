# 1.如果“别的号池”是在宿主机上跑，代理地址填：
```bash
http://codex.acc_001:123@127.0.0.1:2260
```


# 2.如果“别的号池”也是 Docker 容器，并且和 Resin 在同一个 compose/network 里，填：
```bash
http://codex.acc_001:123@resin:2260
```
## 如何创建网络并联动：
先创建一个公共网络：
```bash
docker network create resin_net
```

然后改 Resin 这个项目的 docker-compose.yml：
```bash
services:
    resin:
      networks:
        - resin_net

networks:
    resin_net:
      external: true
```

另一个号池项目的 docker-compose.yml 也加同样的 network：
```bash
services:
    codex2api:
      networks:
        - resin_net

networks:
    resin_net:
      external: true

```

两个项目都重启：
```bash
docker compose up -d
```

# 3.如果”别的号池“也是Docker容器，但是不喝Resin在同一个compose/network里，填：
```bash
  http://codex.acc_001:123@host.docker.internal:2260
```

