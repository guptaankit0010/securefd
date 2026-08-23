'use strict';

module.exports = {
  collection: 'files',
  timestamps: true,
  fields: {
    owner:       { type: 'objectId', required: true },
    filename:    { type: 'string',   required: true },
    storageName: { type: 'string',   required: true },
    mimeType:    { type: 'string',   required: true },
    size:        { type: 'number',   required: true },
    iv:          { type: 'buffer',   required: true },
    authTag:     { type: 'buffer',   required: true },
    isDeleted:   { type: 'boolean',  default: false },
  },
};
