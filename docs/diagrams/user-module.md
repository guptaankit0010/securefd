# User Module — HLD

> **Legend**
> - 🔴 Red nodes — Security controls
> - 🔵 Blue nodes — Validation / Input checks
> - 🟢 Green nodes — Performance decisions
> - White nodes — Business logic / happy path

---

## List Users

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([GET /api/users]) --> B

    B["requireAuth + requireRole admin\n— strict role check, not scope\n— only exact role=admin passes\n— any other role gets 403"]
    B --> C

    C["parsePagination\n— ?page and ?limit from query string\n— limit clamped to MAX_PAGE_SIZE\n— skip calculated server-side\n— unbounded list impossible"]
    C --> D

    D["Promise.all\n— find isDeleted=false projection password=0\n— countDocuments isDeleted=false\n— both queries run in parallel"]
    D --> E["200\n— users array + total + page + limit + pages\n— password hash NEVER in any user object"]

    class B val
    class B sec
    class C,D perf
```

---

## Create User

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/users]) --> B

    B["requireAuth + requireRole admin"]
    B --> C

    C["sanitizeBody\n— trim all string fields\n— strip any keys not in schema"]
    C --> D

    D["validate SCHEMAS.createUser\n— username: plain regex OR email regex\n— maxLength 254 supports email addresses\n— password: required, maxLength 128\n— role: enum admin/manager/viewer"]
    D --> E

    E["validateUsername\n— plain: ^[a-zA-Z0-9_-]{3,32}$\n— email: local@domain.tld RFC5321\n— both ReDoS-safe, no catastrophic backtracking"]
    E --> F

    F["hashPassword\n— scrypt: 16-byte random salt\n— 64-byte derived key\n— password hashed BEFORE any DB operation\n— plaintext never touches storage"]
    F --> G

    G["insertDoc UserModel\n— validateDoc enforces all field types\n— timestamps added automatically"]
    G --> H

    H{MongoServerError 11000?}
    H -- yes --> I["AppError 409 Username taken\n— unique index is the authority\n— no pre-check findOne needed\n— race-condition safe"]
    H -- no --> J["201 Created\n— id, username, role returned\n— no password in response"]

    class C,D,E val
    class F,I sec
    class G perf
```

---

## Update User

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([PATCH /api/users/:id]) --> B

    B["requireAuth + requireRole admin"]
    B --> C

    C["sanitizeBody + validate SCHEMAS.updateUser\n— all fields optional\n— only provided fields go into updates object\n— empty update object throws 400"]
    C --> D

    D{"username in body?"}
    D -- yes --> E["validateUsername regex\n— same plain/email dual check"]
    D -- no  --> F

    E --> F

    F{"password in body?"}
    F -- yes --> G["hashPassword\n— fresh salt on every password change\n— old hash immediately replaced"]
    F -- no  --> H

    G --> H

    H["updateOne users\n— filter: _id + isDeleted=false\n— prepareSet: wraps in dollar-set + stamps updatedAt\n— partial update: only provided fields changed"]
    H --> I

    I{result?}
    I -- matchedCount=0 --> J["AppError 404 User not found"]
    I -- MongoServerError 11000 --> K["AppError 409 Username already taken\n— unique index handles concurrent renames\n— no pre-check race condition"]
    I -- success --> L["200 User updated"]

    class C,D,E val
    class G,K sec
    class H perf
```

---

## Delete User

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([DELETE /api/users/:id]) --> B

    B["requireAuth + requireRole admin"]
    B --> C

    C["toObjectId id\n— throws AppError 400 on malformed ID\n— prevents BSON errors reaching DB"]
    C --> D

    D["updateOne users\n— filter: _id + isDeleted=false\n— set isDeleted=true\n— soft delete: record kept for audit trail\n— user will appear deleted in all queries"]
    D --> E

    E{matchedCount = 0?}
    E -- yes --> F["AppError 404 User not found\n— already deleted users return 404"]
    E -- no  --> G

    G["updateMany sessions\n— filter: owner=userId\n— set isRevoked=true for ALL sessions\n— user kicked off all devices immediately\n— no grace period\n— next request with any token gets 401"]
    G --> H["200 User deleted"]

    class B,C val
    class D,G sec
```
