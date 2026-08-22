'use strict';
const { AppError } = require('../../middleware/errorHandler');

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
  fileMeta:    { filename: { required: true, type: 'string', maxLength: 255 }, mimeType: { required: true, type: 'string', enum: ['text/plain','application/json','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] }, declaredSize: { required: true, type: 'number', min: 1 } },
  shareCreate: { expiresInSeconds: { required: true, type: 'number', min: 60, max: 604800 } },
  roleUpdate:  { role: { required: true, type: 'string', enum: ['admin','manager','viewer'] } },
};

module.exports = { validate, SCHEMAS };
