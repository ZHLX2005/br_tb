# TabBoard 扩展密钥

`manifest.json` 的 `key` 字段对应的 RSA 私钥文件。

## ⚠️ 重要：私钥不放在扩展目录

Chrome 扩展打包时会**拒绝**包含 `.pem` 私钥的目录（因为持有私钥就能签发伪造更新）。
所以本目录**只放说明文档**——私钥保存在扩展目录之外。

## 当前值

| 项 | 值 |
|---|---|
| Chrome 扩展 ID | `6orv4jipupwr3nk75hnq2bosj63rwlus` |
| 私钥指纹 (SHA256 of pub) | `KCzAg0u/Gsj9Nj2KzoiM9MfBFLtEKdwnnE/VB+iv108=` |
| 私钥位置 | `D:\code\a_js\keys\tabboard.key.pem`（**扩展之外**,全机唯一） |
| manifest 里的公钥 | 见 `../manifest.json` 的 `key` 字段 |

## 派生关系

```
D:\code\a_js\keys\tabboard.key.pem  ──pubout DER──▶  [base64]  →  manifest.json 的 key 字段
                                                            │
                                                            └─ base32(SHA256, lowercase)
                                                                   →  Chrome 扩展 ID
```

## 备份策略

- **离线备份**到密码管理器 (1Password / Bitwarden) 或加密 USB。
- 备份内容: `D:\code\a_js\keys\tabboard.key.pem` 这一个文件。
- 丢失 = 失去该 ID 的发布权,无法再以同一 ID 更新 Chrome Web Store 上的扩展。
- `keys/README.md` 与 `manifest.json` 都可以从公开仓库恢复,唯独 `.key.pem` 不可恢复。

## 重新生成(慎用!会变更 ID)

```bash
openssl genrsa -out D:\code\a_js\keys\tabboard.key.pem 2048
openssl rsa -in D:\code\a_js\keys\tabboard.key.pem -pubout -outform DER \
  | openssl base64 -A -out -        # 把这一行写回 manifest.json 的 "key" 字段
```
