# Shared Infrastructure — HLD

> **Legend**
> - 🔴 Red nodes — Security controls
> - 🔵 Blue nodes — Validation / Input checks
> - 🟢 Green nodes — Performance decisions
> - White nodes — Business logic / happy path

---

## MongoDB Connection Layer (lib/db.js)

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([server.js: db.connect uri]) --> B

    B["new MongoClient\n— maxPoolSize: 10\n— minPoolSize: 2  always-warm connections\n— serverSelectionTimeoutMS: 5000\n— socketTimeoutMS: 30000\n— waitQueueTimeoutMS: 5000"]
    B --> C

    C["client.connect\n— db = client.db()  name from URI path\n— ensureIndexes called immediately after"]
    C --> D

    D["ensureIndexes\n— sessions: owner+deviceId unique\n— sessions: owner+isRevoked+expiresAt compound\n— sessions: expiresAt TTL  expireAfterSeconds=0\n— users: username unique\n— files: owner+isDeleted compound\n— sharetokens: tokenId unique\n— sharetokens: file+revoked+expiresAt compound\n— sharetokens: expiresAt TTL  expireAfterSeconds=0"]
    D --> E

    E["insertDoc schema doc\n— validateDoc: types defaults ObjectId coercion\n— collection.insertOne prepared doc\n— returns doc with insertedId"]
    E --> F

    F["toObjectId id\n— new ObjectId id\n— try/catch: BSON error becomes AppError 400\n— prevents stack traces reaching client"]
    F --> G

    G["getCollection name\n— returns db.collection directly\n— caller uses native driver API\n— no abstraction overhead"]

    class B,D perf
    class F sec
    class E val
```

---

## Cryptography (lib/crypto/)

```mermaid
flowchart LR
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    subgraph FILES["fileCrypto.js — File encryption at rest"]
        FA["createEncryptStream\n— randomBytes 12 = IV\n— createCipheriv aes-256-gcm\n— returns Transform stream + iv + getAuthTag"]
        FB["createDecryptStream\n— createDecipheriv aes-256-gcm\n— setAuthTag from DB\n— auth tag validates ciphertext integrity\n— tampered file throws before any plaintext output"]
        FA --> FB
    end

    subgraph PASS["password.js — Password hashing"]
        PA["hashPassword plaintext\n— randomBytes 16 = salt\n— scrypt plaintext salt 64\n— stores salt:hexKey\n— scrypt: CPU + memory hard KDF\n— GPU cracking made expensive"]
        PB["verifyPassword plaintext stored\n— split stored into salt + hash\n— scrypt re-derive with same salt\n— timingSafeEqual constant-time compare\n— no early-exit on first differing byte"]
        PA --> PB
    end

    subgraph TOKENS["tokens.js — HMAC token signing"]
        TA["signToken payload secret\n— JSON.stringify payload\n— base64url encode = data\n— HMAC-SHA256 data secret = sig\n— return data.sig"]
        TB["verifyToken token secret\n— split into data + sig\n— recompute HMAC-SHA256\n— timingSafeEqual\n— decode payload JSON\n— check exp claim"]
        TA --> TB
    end

    class FA,FB,PA,PB,TA,TB sec
```

---

## Validation Layer (lib/validation/)

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    subgraph HTTP["schemas.js — HTTP body validation"]
        H1["validate data schema\n— required: missing or empty → 400\n— type: typeof check → 400\n— maxLength: string length → 400\n— enum: allowed values → 400\n— min/max: numeric range → 400"]
        H2["SCHEMAS\n— signup login: username maxLength 254\n— fileMeta: mimeType enum text/plain or json\n— shareCreate: min/max from env config\n— createUser updateUser: all user fields"]
    end

    subgraph DB_VAL["schemas.js — DB document validation"]
        D1["validateDoc schema doc\n— applies declared defaults\n— enforces required fields\n— coerces objectId strings via toObjectId\n— validates Buffer for iv and authTag\n— stamps createdAt + updatedAt if timestamps:true\n— returns prepared doc for insertOne"]
        D2["prepareSet schema updates\n— wraps in dollar-set\n— appends updatedAt if timestamps:true\n— used in all updateOne/updateMany calls"]
    end

    subgraph SANITIZE["sanitize.js — Input sanitization"]
        S1["assertSafePath filePath\n— path.resolve collapses all dot-dot\n— check: resolved.startsWith base + sep\n— sep prevents /storage-evil prefix match\n— AppError 400 on traversal attempt"]
        S2["sanitizeMongoQuery obj\n— filter keys starting with dollar\n— filter keys containing dot\n— blocks NoSQL operator injection\n— recursive for nested objects"]
        S3["validateUsername str\n— plain: ^[a-zA-Z0-9_-]{3,32}$\n— OR email: RFC 5321 pattern\n— both: no nested quantifiers, ReDoS-safe\n— total max length 254"]
        S4["sanitizeBody data schema\n— keep only schema-defined keys\n— trim string values\n— no unknown fields in service layer"]
    end

    class H1,H2,D1,D2 val
    class S1,S2,S3,S4 sec
```

---

## Middleware Chain

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([Incoming HTTPS request]) --> B

    B["handleCors\n— set Access-Control-Allow-Origin\n— OPTIONS preflight → 204 and return\n— applied before every request"]
    B --> C

    C["Custom regex router\n— O(n) route scan at startup\n— compiled RegExp per route\n— no framework overhead"]
    C --> D

    D["requireAuth  middleware/session.js\n— check Authorization Bearer header first\n— verifyToken: HMAC-SHA256 + exp\n— check type = access for Bearer path\n— fallback: __Host-session cookie\n— verifyToken on cookie\n— req.user = uid role scopes deviceId"]
    D --> E

    E{"requireRole or requireScope?"}

    E -- "requireRole admin" --> F["exact role match\n— used for user management endpoints\n— admin only, no scope delegation"]
    E -- "requireScope file:read etc" --> G["check req.user.scopes array\n— ABAC: attribute-based access control\n— scopes from JWT claims\n— no DB lookup\n— getScopesForRole fallback for old tokens"]

    F --> H
    G --> H

    H["Controller handler\n— business logic\n— throws AppError on error"]
    H --> I

    I{"error thrown?"}
    I -- AppError operational --> J["centralErrorHandler\n— logger.warn with requestId\n— send err.message to client\n— safe: message was written by us"]
    I -- unexpected error --> K["centralErrorHandler\n— logger.error with full stack\n— send Internal server error\n— stack NEVER sent to client"]
    I -- success --> L["sendJson 2xx\n— envelope: success:true data payload\n— Content-Length header set\n— no partial responses"]

    class B,D,F,G val
    class D,J,K sec
    class C perf
```

---

## Logger (lib/logger.js)

```mermaid
flowchart LR
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A["logger.debug / info / warn / error msg ctx"]
    A --> B

    B["level filter\n— compare numeric level vs configured threshold\n— configuredLevel from LOG_LEVEL env\n— default: DEBUG in dev, INFO in production\n— below threshold: return immediately, zero cost"]
    B --> C

    C["build entry object\n— ts: ISO timestamp\n— level: DEBUG INFO WARN ERROR\n— msg: message string\n— ctx instanceof Error: serialize message stack code\n— ctx object: Object.assign into entry"]
    C --> D

    D{level >= ERROR?}
    D -- yes --> E["process.stderr.write\n— errors to stderr\n— separates from normal output\n— ops tooling can route independently"]
    D -- no  --> F["process.stdout.write\n— JSON.stringify entry + newline\n— no external dependencies\n— no log library overhead"]

    class B perf
```
