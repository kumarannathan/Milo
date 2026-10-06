import { randomBytes } from 'node:crypto';

export function newId(prefix) {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
