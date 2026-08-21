'use strict';
const mongoose = require('mongoose');

const shareSchema = new mongoose.Schema({
  file:      { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
  tokenId:   { type: String, required: true, unique: true }, // UUID embedded in signed payload
  expiresAt: { type: Date, required: true },
  revoked:   { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('ShareToken', shareSchema);
