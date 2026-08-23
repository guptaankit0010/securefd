# SecureFileDrop

A self-hosted HTTPS API for securely uploading, encrypting, and sharing text and JSON files. Files are encrypted at rest using AES-256-GCM. Access is controlled by roles and scopes. Share links are time-limited and signed.

---

## Requirements

| Tool | Minimum version |
|------|----------------|
| Node.js | 20.6.0 |
| MongoDB | 6.0 |
| OpenSSL | any (for generating the TLS certificate) |

---

## First-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install nodemon (for development)

`nodemon` is already listed as a `devDependency` and installed by `npm install` in step 1. No separate install needed.

### 3. Generate a self-signed TLS certificate

The server only runs over HTTPS. Run this once to create `cert/key.pem` and `cert/cert.pem`:

```bash
mkdir cert
openssl req -x509 -newkey rsa:4096 -keyout cert/key.pem -out cert/cert.pem -days 365 -nodes -subj "/CN=localhost"
```

### 4. Create the `.env` file

Copy the template below, then fill in the secret values:

```env
PORT=4433
MONGODB_URI=mongodb://localhost:27017/securefiledrop
SESSION_SECRET=<run keygen below>
SHARE_TOKEN_SECRET=<run keygen below>
FILE_ENCRYPTION_KEY=<run keygen below>
STORAGE_DIR=./storage
MAX_FILE_SIZE_BYTES=5242880
ALLOWED_ORIGIN=https://localhost:3000
SERVER_BASE_URL=https://localhost:4433
```

**Generate all three secrets at once:**

```bash
npm run keygen
```

Paste the output lines into your `.env` file.

### 5. Start MongoDB

Make sure MongoDB is running locally before starting the server:

```bash
# macOS / Linux (Homebrew)
brew services start mongodb-community

# Windows
net start MongoDB
```

---

## Running the server

**Development** (auto-restarts on file changes):

```bash
npm run dev
```

**Production:**

```bash
npm start
```

The server will be available at `https://localhost:4433`.

> Your browser will show a certificate warning because the cert is self-signed. In Postman, disable "SSL certificate verification" under Settings → General.

---

## Roles and permissions

| Role | Can do |
|------|--------|
| `admin` | Manage users (create / update / delete / list), read all files |
| `manager` | Upload files, read own files + shared files, create and revoke share links, delete own files |
| `viewer` | Read own files + shared files only |

The first admin user must be created directly via `POST /api/auth/signup` with `"role": "admin"`. After that, the admin can create further users through the user management endpoints.

**Scope mapping:**

| Role | Scopes |
|------|--------|
| `admin` | `file:read`, `file:write`, `file:delete` |
| `manager` | `file:read`, `file:write`, `file:delete` |
| `viewer` | `file:read` |

---

## API reference

All request and response bodies are JSON. Successful responses follow the shape:

```json
{ "success": true, "data": { ... } }
```

Error responses:

```json
{ "success": false, "error": "Human-readable message", "requestId": "uuid" }
```

---

### Authentication

#### Sign up
```
POST /api/auth/signup
```
```json
{ "username": "alice", "password": "s3cr3t", "role": "manager" }
```

#### Log in
```
POST /api/auth/login
```
```json
{ "username": "alice", "password": "s3cr3t" }
```
Returns `accessToken` (15 min), `refreshToken` (7 days), and sets a `__Host-session` cookie.  
Optionally send `X-Device-Id: <uuid>` header to track a specific device.

#### Refresh tokens
```
POST /api/auth/refresh
```
```json
{ "refreshToken": "<your refresh token>" }
```
Returns a new `accessToken` + `refreshToken` pair. The old refresh token is invalidated immediately.

#### Log out
```
POST /api/auth/logout
```
Send whichever credential you are using (Bearer header or cookie — see below).

---

### Authenticating requests

The server accepts **two authentication methods**. Use whichever fits your client — both work on every protected endpoint.

#### Option A — Bearer token (API clients, mobile apps, Postman)

After login, take the `accessToken` from the response body and send it as a header on every request:

```
Authorization: Bearer <accessToken>
```

Access tokens expire after **15 minutes**. When one expires, call `POST /api/auth/refresh` with your `refreshToken` to get a new pair without logging in again.

#### Option B — Session cookie (browsers)

After login, the server automatically sets a `__Host-session` cookie. Browsers send it back on every subsequent request with no extra work on your part. The cookie lasts **8 hours**.

> Both methods can coexist — a browser that also sends an `Authorization` header will use the Bearer token path.

---

### User management *(admin only)*

> All user management endpoints require authentication. Send either the `Authorization: Bearer <accessToken>` header or the session cookie.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users/me` | Get your own profile |
| `GET` | `/api/users` | List all active users |
| `POST` | `/api/users` | Create a user |
| `PATCH` | `/api/users/:id` | Update username / password / role |
| `DELETE` | `/api/users/:id` | Soft-delete a user (revokes all their sessions) |

**Create user body:**
```json
{ "username": "bob", "password": "p4ssw0rd", "role": "viewer" }
```

**Update user body** (all fields optional):
```json
{ "username": "bob2", "password": "newpass", "role": "manager" }
```

---

### Files

> All file endpoints require authentication. Send either the `Authorization: Bearer <accessToken>` header or let the browser send the session cookie automatically.

#### Upload one or more files
```
POST /api/files
Content-Type: multipart/form-data
```

For each file, send a **`meta` field before its `file` field**:

| Field | Type | Value |
|-------|------|-------|
| `meta` | Text | `{"filename":"notes.txt","mimeType":"text/plain","declaredSize":1234}` |
| `file` | File | the actual file |

Allowed `mimeType` values: `text/plain`, `application/json`.  
Maximum file size: 5 MB (configurable via `MAX_FILE_SIZE_BYTES`).

#### List files
```
GET /api/files
```
- **admin**: sees all non-deleted files (with `shareUrl` if a share link exists)
- **manager / viewer**: sees own files + files shared with them (with `shareUrl`)

#### Get a single file record
```
GET /api/files/:fileId
```

#### Delete a file *(owner only)*
```
DELETE /api/files/:fileId
```
Soft-deletes the file and revokes all its share links. The encrypted blob is kept on disk.

---

### Sharing

> Share endpoints require authentication except for the public download link.

#### Create a share link
```
POST /api/files/:fileId/share
```
```json
{ "expiresInSeconds": 3600 }
```
`expiresInSeconds` must be between 60 (1 minute) and 604800 (7 days).

Response includes:
```json
{
  "success": true,
  "data": {
    "token": "eyJ...",
    "shareUrl": "https://localhost:4433/api/share/eyJ..."
  }
}
```

#### Download via share link *(public — no auth required)*
```
GET /api/share/<token>
```
Returns the decrypted file as a download. The link expires at the time specified when it was created. No login needed — anyone with the link can download the file until it expires.

#### Revoke a share link *(owner only)*
```
DELETE /api/files/:fileId/share/:tokenId
```

---

## Architecture

### System overview

```mermaid
graph TB
    Client["Client (Browser / Postman / Mobile)"]

    subgraph Server["HTTPS Server (Node.js, no Express)"]
        CORS["CORS preflight handler"]
        Router["Custom Regex Router"]

        subgraph Middleware["Middleware chain"]
            Auth["requireAuth (Bearer or cookie)"]
            RBAC["requireRole / requireScope"]
        end

        subgraph Controllers
            AuthCtrl["AuthController"]
            UserCtrl["UserController"]
            FileCtrl["FileController"]
            ShareCtrl["ShareController"]
        end

        subgraph Services
            AuthSvc["AuthService"]
            UserSvc["UserService"]
            FileSvc["FileService"]
            ShareSvc["ShareService"]
        end

        subgraph Libs["Shared libraries"]
            Crypto["lib/crypto (AES-256-GCM, scrypt, HMAC)"]
            Validation["lib/validation (schemas, sanitize)"]
            Logger["lib/logger (structured JSON)"]
            ErrHandler["centralErrorHandler"]
        end
    end

    subgraph Persistence
        MongoDB[("MongoDB (Users, Sessions, Files, Shares)")]
        Disk[("Local disk (Encrypted blobs)")]
    end

    Client -->|"HTTPS TLS"| CORS
    CORS --> Router
    Router --> Middleware
    Middleware --> Controllers
    Controllers --> Services
    Services --> Libs
    Services --> MongoDB
    Services --> Disk
    Libs --> MongoDB
```

---

### Session & token lifetime

```mermaid
gantt
    title Token and session lifetimes (not to scale)
    dateFormat X
    axisFormat %s

    section Bearer path
    Access token 15 min      : 0, 900
    Refresh token 7 days     : 0, 604800

    section Cookie path
    Session cookie 8 hours   : 0, 28800
```

- **Access token** — stateless JWT-like HMAC token; no DB lookup on every request.
- **Refresh token** — DB-backed; SHA-256 hash stored in `SessionModel`. Token rotation on every use.
- **Cookie token** — long-lived, same secret as access token; verified entirely from signature.
- **Session cap** — `MAX_SESSIONS = 2` per user. Oldest session is evicted when cap is reached.
- **Reuse detection** — if a refresh token is used twice, all sessions for that user are immediately revoked.

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Port to listen on (default: `4433`) |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `SESSION_SECRET` | Yes | 64-char hex — signs session and access/refresh tokens |
| `SHARE_TOKEN_SECRET` | Yes | 64-char hex — signs share link tokens |
| `FILE_ENCRYPTION_KEY` | Yes | 64-char hex — AES-256-GCM key for file encryption |
| `STORAGE_DIR` | Yes | Path to directory where encrypted files are stored |
| `MAX_FILE_SIZE_BYTES` | Yes | Maximum upload size in bytes (e.g. `5242880` = 5 MB) |
| `ALLOWED_ORIGIN` | No | CORS allowed origin (default: `https://localhost:3000`) |
| `SERVER_BASE_URL` | No | Base URL used in share links (default: `https://localhost:<PORT>`) |
| `LOG_LEVEL` | No | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `DEBUG` in dev, `INFO` in prod) |

---

## Project structure

```
.
├── api/
│   ├── auth/          AuthController, AuthService, SessionModel
│   ├── file/          FileController, FileService, FileModel
│   ├── share/         ShareController, ShareService, ShareModel
│   └── user/          UserController, UserService, UserModel
├── cert/              TLS key and certificate (git-ignored)
├── config/
│   ├── auth.js        Token TTLs, role→scope mapping, MAX_SESSIONS
│   ├── env.js         Environment variable loader and validator
│   └── routes.js      All API routes with middleware chains
├── lib/
│   ├── crypto/
│   │   ├── fileCrypto.js   AES-256-GCM encrypt/decrypt streams
│   │   ├── password.js     scrypt hash + verify
│   │   └── tokens.js       HMAC sign + verify (timingSafeEqual)
│   ├── validation/
│   │   ├── schemas.js      JSON schema validators
│   │   └── sanitize.js     Input sanitization, path traversal guard
│   ├── http.js        readJsonBody, sendJson, cookie helpers, CORS
│   ├── logger.js      Structured JSON logger (no external deps)
│   ├── perf.js        Async timing helper
│   ├── router.js      Custom regex-based HTTP router
│   └── shutdown.js    Graceful SIGTERM/SIGINT shutdown
├── middleware/
│   ├── errorHandler.js    AppError class + centralErrorHandler
│   ├── rbac.js            requireRole, requireScope guards
│   └── session.js         requireAuth — Bearer token + cookie
├── storage/           Encrypted file blobs (git-ignored)
├── .env               Secret configuration (git-ignored)
└── server.js          Entry point — HTTPS server + MongoDB connect
```
