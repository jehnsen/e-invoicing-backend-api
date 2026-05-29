import { describe, it, expect } from 'vitest';
import { parseJsonBuffer } from '../../src/modules/connectors/parsers/json.parser';

describe('json parser', () => {
  it('parses a top-level array', () => {
    const json = JSON.stringify([{ name: 'Buyer', amount: 100 }]);
    const result = parseJsonBuffer(Buffer.from(json));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe('Buyer');
  });

  it('parses an object with items key', () => {
    const json = JSON.stringify({ items: [{ name: 'Buyer' }], total: 1 });
    const result = parseJsonBuffer(Buffer.from(json));
    expect(result.rows).toHaveLength(1);
  });

  it('parses an object with data key', () => {
    const json = JSON.stringify({ data: [{ id: 1 }] });
    const result = parseJsonBuffer(Buffer.from(json));
    expect(result.rows[0]?.id).toBe(1);
  });

  it('wraps a single object in array', () => {
    const json = JSON.stringify({ name: 'Single' });
    const result = parseJsonBuffer(Buffer.from(json));
    expect(result.rows).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonBuffer(Buffer.from('not json'))).toThrow('Invalid JSON');
  });
});
