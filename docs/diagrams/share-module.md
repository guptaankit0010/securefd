# Share Module — HLD

> **Legend**
> - 🔴 Red nodes — Security controls
> - 🔵 Blue nodes — Validation / Input checks
> - 🟢 Green nodes — Performance decisions
> - White nodes — Business logic / happy path

---

## Create Share Token

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/files/:fileId/share]) --> B

    B["requireAuth + requireScope file:write"]
    B --> C

    C["readJsonBody + validate SCHEMAS.shareCreate\n— expiresInSeconds required\n— min: SHARE_TOKEN_MIN_EXPIRY from env\n— max: SHARE_TOKEN_MAX_EXPIRY from env\n— both configurable without code change"]
    C --> D

    D["findOne files\n— filter: _id + owner=uid + isDeleted=false\n— owner-only check\n— admin cannot create share links for others files\n— soft-deleted files cannot be shared"]
    D --> E

    E{file found?}
    E -- no --> F["AppError 404"]
    E -- yes --> G

    G["randomUUID tokenId\n— CSPRNG: cryptographically random\n— UUID v4: 122 bits of entropy\n— never predictable or guessable"]
    G --> H

    H["insertDoc ShareModel\n— file as ObjectId\n— tokenId unique index prevents duplicates\n— expiresAt = now + expiresInSeconds\n— revoked defaults to false"]
    H --> I

    I["signToken HMAC-SHA256\n— payload: fileId + tokenId + exp\n— signed with SHARE_TOKEN_SECRET\n— separate secret from session tokens\n— token = base64url(payload).base64url(sig)"]
    I --> J["201\n— token: signed string for download URL\n— tokenId: UUID for revocation\n— shareUrl: full ready-to-use link\nclient must store tokenId for revocation"]

    class C val
    class D,G,I sec
    class H perf
```

---

## List Share Tokens

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([GET /api/files/:fileId/share]) --> B

    B["requireAuth + requireScope file:read"]
    B --> C

    C{user role?}
    C -- admin --> D["match: _id + isDeleted=false\n— admin sees tokens for any file"]
    C -- manager/viewer --> E["match: _id + owner=uid + isDeleted=false\n— must own the file"]

    D --> F
    E --> F

    F{file found?}
    F -- no --> G["AppError 404"]
    F -- yes --> H

    H["parsePagination\n— bounded query — no unbounded toArray\n— MAX_PAGE_SIZE cap"]
    H --> I

    I["find sharetokens\n— filter: file + revoked=false + expiresAt gt now\n— compound index: file+revoked+expiresAt used\n— projection: tokenId + expiresAt + createdAt only\n— signed token string NEVER returned in list\n— token is a capability — listing it = listing passwords"]
    I --> J

    J["Promise.all find + countDocuments\n— parallel queries"]
    J --> K["200 tokens + total + page + limit + pages"]

    class B,C val
    class I sec
    class H,I,J perf
```

---

## Revoke Share Token

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([DELETE /api/files/:fileId/share/:tokenId]) --> B

    B["requireAuth + requireScope file:delete"]
    B --> C

    C{user role?}
    C -- admin --> D["match: _id + isDeleted=false\n— admin can revoke tokens on any file"]
    C -- manager/viewer --> E["match: _id + owner=uid + isDeleted=false\n— owner can only revoke own file tokens"]

    D --> F
    E --> F

    F{file found?}
    F -- no --> G["AppError 404"]
    F -- yes --> H

    H["updateOne sharetokens\n— filter: tokenId + file=fileId\n— set revoked=true via prepareSet\n— updatedAt stamped automatically"]
    H --> I

    I{matchedCount = 0?}
    I -- yes --> J["AppError 404 Token not found\n— tokenId did not belong to this file\n— prevents cross-file revocation"]
    I -- no --> K["200 Token revoked\n— any in-flight download using this token\n— will get 401 on next resolveShareToken call"]

    class B,C val
    class C,J sec
    class H perf
```

---

## Download via Share Link

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([GET /api/share/:token  public no auth required]) --> B

    B["verifyToken\n— split token into data + sig parts\n— HMAC-SHA256 recompute expected signature\n— timingSafeEqual: constant-time comparison\n— decode payload: fileId + tokenId + exp\n— check exp claim: throw 401 if expired\n— all in one function — no partial checks possible"]
    B --> C

    C{token valid?}
    C -- no --> D["AppError 401 Token invalid or expired"]
    C -- yes --> E

    E["findOne sharetokens\n— filter: tokenId + revoked=false\n— tokenId unique index: O(1) lookup\n— double-check expiresAt in DB\n— catches tokens revoked after signing"]
    E --> F

    F{share valid?}
    F -- "revoked or expired" --> D
    F -- valid --> G

    G["findOne files\n— filter: _id + isDeleted=false\n— file deleted after share created: blocked here\n— returns storageName iv authTag mimeType filename"]
    G --> H

    H["createDecryptStream\n— toBuf: BSON Binary coerced to Node Buffer\n— createDecipheriv aes-256-gcm\n— decipher.setAuthTag: GCM integrity check\n— if ciphertext tampered: decipher throws\n— before any plaintext reaches the response"]
    H --> I

    I["createReadStream storagePath\n— trackStream: registered for graceful shutdown\n— pipe readStream pipe decipher pipe res\n— streaming: never loads whole file into RAM"]
    I --> J["200 file download\n— Content-Type from mimeType\n— Content-Disposition attachment\n— filename URI-encoded"]

    class B,E,H sec
    class I perf
```
