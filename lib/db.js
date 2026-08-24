'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const { AppError }              = require('../middleware/errorHandler');
const { validateDoc }           = require('./validation/schemas');
const logger                    = require('./logger');

let client;
let db;

async function connect(uri) {
  client = new MongoClient(uri, {
    maxPoolSize:              10,   // max concurrent sockets
    minPoolSize:               2,   // always-warm idle connections
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS:         30000,
    waitQueueTimeoutMS:       5000, // throw if pool exhausted for > 5s
  });
  await client.connect();
  db = client.db(); // db name is taken from the URI path
  logger.info('mongodb connected', { maxPoolSize: 10, minPoolSize: 2 });
  await ensureIndexes();
}

async function ensureIndexes() {
  await db.collection('sessions').createIndexes([
    { key: { owner: 1, deviceId: 1 }, unique: true },
    { key: { owner: 1, isRevoked: 1, expiresAt: 1 } },
    // TTL: MongoDB auto-deletes expired session documents
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('files').createIndex({ owner: 1, isDeleted: 1 });
  await db.collection('sharetokens').createIndexes([
    { key: { tokenId: 1 }, unique: true },
    { key: { file: 1, revoked: 1, expiresAt: 1 } },
    // TTL: MongoDB auto-deletes expired share token documents
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);
  logger.debug('mongodb indexes ensured');
}

// Validates doc against the model schema then inserts into the collection.
// Returns the inserted document with its _id.
async function insertDoc(schema, doc) {
  const prepared = validateDoc(schema, doc);
  const result   = await db.collection(schema.collection).insertOne(prepared);
  return { _id: result.insertedId, ...prepared };
}

// Safe ObjectId conversion — throws AppError 400 instead of a raw BSONError
// so the central error handler treats it as an operational (client) error.
function toObjectId(id) {
  try { return new ObjectId(id); }
  catch { throw new AppError('Invalid id format', 400); }
}

function getCollection(name) {
  return db.collection(name);
}

async function disconnect() {
  if (client) await client.close();
}

module.exports = { connect, disconnect, getCollection, insertDoc, toObjectId, ObjectId };
