'use strict';

module.exports = {
  collection: 'sharetokens',
  timestamps: true,
  fields: {
    file:      { type: 'objectId', required: true },
    tokenId:   { type: 'string',   required: true },
    expiresAt: { type: 'date',     required: true },
    revoked:   { type: 'boolean',  default: false },
  },
};
