# Auth Module — HLD

> **Legend**
> - 🔴 Red nodes — Security controls
> - 🔵 Blue nodes — Validation / Input checks
> - 🟢 Green nodes — Performance decisions
> - White nodes — Business logic / happy path

---

## Signup

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/auth/signup]) --> B

    B["readJsonBody\n— 64 KB hard limit\n— empty body → empty object"]
    B --> C

    C["sanitizeBody\n— trim whitespace\n— strip unknown keys\n— only schema fields pass through"]
    C --> D

    D{validate SCHEMAS.signup}
    D --> E
    D --> F

    E["username\n— plain: ^[a-zA-Z0-9_-]{3,32}$\n— OR email: RFC 5321 regex\n— maxLength 254\n— ReDoS-safe fixed char class"]
    F["password\n— required, type string\n— maxLength 128"]
    E --> G
    F --> G

    G["hashPassword\n— generate 16-byte random salt\n— scrypt(password, salt, 64)\n— output: salt:hexKey stored in DB\n— never stores plaintext"]
    G --> H

    H["insertDoc UserModel\n— validateDoc: type-checks all fields\n— timestamps added automatically\n— inserts into users collection"]
    H --> I

    I{MongoServerError code 11000?}
    I -- yes --> J["AppError 409 Username Taken\n— unique index is the authority\n— no check-then-insert race condition\n— concurrent signups handled correctly"]
    I -- no  --> K["201 Created\n— returns id, username, role, scopes\n— password hash NEVER in response"]

    class C,E,F val
    class G,J sec
    class H perf
```

---

## Login

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/auth/login]) --> B

    B["readJsonBody + sanitizeBody + validate\n— same checks as signup\n— username and password required"]
    B --> C

    C["Read X-Device-Id header\n— optional, UUID from client\n— server generates UUID if absent\n— ties cookie + Bearer to same session slot"]
    C --> D

    D["findOne users\n— filter: username + isDeleted=false\n— projection includes password field\n— only query that returns hashed password"]
    D --> E

    E["verifyPassword\n— scrypt re-derive with stored salt\n— timingSafeEqual: constant-time compare\n— prevents timing side-channel attacks"]
    E --> F

    F{credentials valid?}
    F -- no --> G["AppError 401 Invalid credentials\n— same message for wrong username\n   AND wrong password\n— prevents username enumeration"]
    F -- yes --> H

    H["enforceSessionLimit\n— single dollar-facet aggregation\n— thisDevice + allActive in one round-trip\n— evicts oldest session if cap reached"]
    H --> I

    I["signToken x3  HMAC-SHA256\n— cookieToken  TTL 8h\n— accessToken  TTL 15min\n— refreshToken TTL 7d\n— each signed with SESSION_SECRET"]
    I --> J

    J["findOneAndUpdate sessions  upsert\n— stores SHA-256(refreshToken) only\n— raw refresh token never persisted\n— $setOnInsert stamps createdAt"]
    J --> K

    K["Set-Cookie __Host-session\n— HttpOnly: JS cannot read it\n— Secure: HTTPS only\n— SameSite=Strict: blocks CSRF\n— __Host- prefix: no subdomain scope"]
    K --> L["200 accessToken + refreshToken + scopes\n— accessToken → JS memory only\n— refreshToken → mobile SecureStorage\n— cookie handles browser sessions"]

    class B,C val
    class E,G,I,J,K sec
    class H perf
```

---

## Refresh Tokens

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/auth/refresh]) --> B

    B["readJsonBody\n— refreshToken string required\n— type check before any DB call"]
    B --> C

    C["verifyToken\n— HMAC-SHA256 signature check\n— timingSafeEqual: no early-exit comparison\n— exp claim validated\n— throws 401 on any failure"]
    C --> D

    D["findOne sessions\n— filter: owner=uid + deviceId\n— no isRevoked filter here intentionally\n— must read current state to detect reuse"]
    D --> E

    E{session state?}
    E -- "not found / expired" --> F["AppError 401 Session expired or revoked"]
    E -- "isRevoked = true"    --> F
    E -- valid --> G

    G["SHA-256 incoming refreshToken\ncompare vs session.tokenHash"]
    G --> H

    H{hash match?}
    H -- no --> I["updateMany sessions isRevoked=true\n— ALL sessions for this user revoked\n— breach response: token reuse detected\n— legitimate user must log in again"]
    H -- yes --> J

    J["findOne users\n— verify user still exists + not deleted\n— role could have changed since last login"]
    J --> K

    K["issueTokenPair\n— new accessToken + refreshToken\n— old refresh token now invalid\n— single-use rotation enforced"]
    K --> L["200 new token pair\n— previous refreshToken is dead"]

    class B,C val
    class C,G,I sec
    class D perf
```

---

## Logout

```mermaid
flowchart TD
    classDef sec  fill:#c0392b,color:#fff,stroke:#922b21
    classDef val  fill:#1a5276,color:#fff,stroke:#154360
    classDef perf fill:#1e8449,color:#fff,stroke:#196f3d

    A([POST /api/auth/logout]) --> B

    B["requireAuth middleware\n— Bearer token verified first\n— cookie fallback if no Bearer header\n— req.user.uid + req.user.deviceId populated"]
    B --> C

    C["revokeSession\n— updateOne sessions\n— filter: owner=uid + deviceId\n— sets isRevoked=true immediately\n— device-scoped: only this device logged out"]
    C --> D

    D["Set-Cookie __Host-session Max-Age=0\n— clears cookie regardless of auth path used\n— browser discards the cookie immediately\n— works even if user authenticated via Bearer"]
    D --> E["200 Logged out successfully"]

    class B val
    class C,D sec
```
