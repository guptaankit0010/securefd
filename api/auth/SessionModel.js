'use strict';

module.exports = {
  collection: 'sessions',
  timestamps: true,
  fields: {
    owner:     { type: 'objectId', required: true },
    deviceId:  { type: 'string',   required: true },
    tokenHash: { type: 'string',   required: true },
    expiresAt: { type: 'date',     required: true },
    isRevoked: { type: 'boolean',  default: false },
  },
};
