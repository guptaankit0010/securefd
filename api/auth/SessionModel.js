'use strict';
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  owner:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId:  { type: String, required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isRevoked: { type: Boolean, default: false },
}, { timestamps: true });

sessionSchema.index({ owner: 1, deviceId: 1 }, { unique: true });

module.exports = mongoose.model('Session', sessionSchema);
