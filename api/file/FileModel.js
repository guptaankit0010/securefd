'use strict';
const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename:    { type: String, required: true },
  storageName: { type: String, required: true },       // crypto.randomUUID() — disk filename
  mimeType:    { type: String, required: true },
  size:        { type: Number, required: true },
  iv:          { type: Buffer, required: true },       // aes-256-gcm iv (12 bytes)
  authTag:     { type: Buffer, required: true },       // aes-256-gcm auth tag (16 bytes)
  isDeleted:   { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('File', fileSchema);
