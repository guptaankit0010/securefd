'use strict';

module.exports = {
  collection: 'users',
  timestamps: true,
  fields: {
    username:  { type: 'string',  required: true },
    password:  { type: 'string',  required: true, private: true },
    role:      { type: 'string',  required: true, enum: ['admin', 'manager', 'viewer'] },
    isDeleted: { type: 'boolean', default: false },
  },
};
