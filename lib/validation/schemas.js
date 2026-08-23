'use strict';
const { AppError } = require('../../middleware/errorHandler');
// Lazy-loaded once after process.env is ready — safe because schemas.js is
// required after process.loadEnvFile() runs in server.js.
const env = require('../../config/env');

function validate(data, schema) {
  for (const [field, rules] of Object.entries(schema)) {
    const val = data[field];
    if (rules.required && (val === undefined || val === null || val === ''))
      throw new AppError(`${field} is required`, 400);
    if (val === undefined) continue;
    if (rules.type      && typeof val !== rules.type)    throw new AppError(`${field} must be ${rules.type}`, 400);
    if (rules.maxLength && val.length > rules.maxLength) throw new AppError(`${field} too long (max ${rules.maxLength})`, 400);
    if (rules.enum      && !rules.enum.includes(val))    throw new AppError(`${field} must be one of: ${rules.enum.join(', ')}`, 400);
    if (rules.min != null && val < rules.min)            throw new AppError(`${field} must be >= ${rules.min}`, 400);
    if (rules.max != null && val > rules.max)            throw new AppError(`${field} must be <= ${rules.max}`, 400);
  }
}

const SCHEMAS = {
  signup:      { username: { required: true, type: 'string', maxLength: 32 }, password: { required: true, type: 'string', maxLength: 128 }, role: { type: 'string', enum: ['admin','manager','viewer'] } },
  login:       { username: { required: true, type: 'string', maxLength: 32 }, password: { required: true, type: 'string', maxLength: 128 } },
  fileMeta:    { filename: { required: true, type: 'string', maxLength: 255 }, mimeType: { required: true, type: 'string', enum: ['text/plain','application/json'] }, declaredSize: { required: true, type: 'number', min: 1 } },
  shareCreate: { expiresInSeconds: { required: true, type: 'number', min: env.shareTokenMinExpiry, max: env.shareTokenMaxExpiry } },
  roleUpdate:  { role: { required: true, type: 'string', enum: ['admin','manager','viewer'] } },
  createUser:  { username: { required: true, type: 'string', maxLength: 32 }, password: { required: true, type: 'string', maxLength: 128 }, role: { required: true, type: 'string', enum: ['admin','manager','viewer'] } },
  updateUser:  { username: { type: 'string', maxLength: 32 }, password: { type: 'string', maxLength: 128 }, role: { type: 'string', enum: ['admin','manager','viewer'] } },
};

// Validates a document against a model schema before a DB insert.
// Applies declared defaults, enforces required fields and types,
// coerces objectId strings, and stamps timestamps when schema.timestamps is true.
// Returns a prepared plain object ready for collection.insertOne().
function validateDoc(schema, doc) {
  // Lazy-require to avoid circular dependency (db.js requires schemas.js)
  const { toObjectId } = require('../db');
  const prepared = {};

  for (const [field, rules] of Object.entries(schema.fields)) {
    let val = doc[field];

    // Apply declared default when the caller omitted the field
    if (val === undefined && rules.default !== undefined) {
      val = rules.default;
    }

    if (rules.required && (val === undefined || val === null)) {
      throw new AppError(`${field} is required`, 400);
    }
    if (val === undefined) continue;

    switch (rules.type) {
      case 'string':
        if (typeof val !== 'string') throw new AppError(`${field} must be a string`, 400);
        if (rules.enum && !rules.enum.includes(val))
          throw new AppError(`${field} must be one of: ${rules.enum.join(', ')}`, 400);
        break;
      case 'number':
        if (typeof val !== 'number') throw new AppError(`${field} must be a number`, 400);
        break;
      case 'boolean':
        if (typeof val !== 'boolean') throw new AppError(`${field} must be a boolean`, 400);
        break;
      case 'date':
        if (!(val instanceof Date)) val = new Date(val);
        if (isNaN(val.getTime())) throw new AppError(`${field} must be a valid date`, 400);
        break;
      case 'objectId':
        if (typeof val === 'string') val = toObjectId(val);
        break;
      case 'buffer':
        if (!Buffer.isBuffer(val)) throw new AppError(`${field} must be a Buffer`, 400);
        break;
    }

    prepared[field] = val;
  }

  if (schema.timestamps) {
    prepared.createdAt = new Date();
    prepared.updatedAt = new Date();
  }

  return prepared;
}

// Wraps a partial update payload in { $set } and appends updatedAt automatically
// when the schema declares timestamps:true.
function prepareSet(schema, updates) {
  return { $set: schema.timestamps ? { ...updates, updatedAt: new Date() } : updates };
}

module.exports = { validate, SCHEMAS, validateDoc, prepareSet };
