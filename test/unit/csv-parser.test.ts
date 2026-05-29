import { describe, it, expect } from 'vitest';
import { parseCsvBuffer } from '../../src/modules/connectors/parsers/csv.parser';

describe('csv parser', () => {
  it('parses a simple CSV', () => {
    const csv = 'name,amount,date\nBuyer Inc,1000,2025-01-15\nBuyer Two,2000,2025-01-16';
    const result = parseCsvBuffer(Buffer.from(csv));
    expect(result.headers).toEqual(['name', 'amount', 'date']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.name).toBe('Buyer Inc');
    expect(result.rows[0]?.amount).toBe(1000);
  });

  it('strips UTF-8 BOM', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const csv = Buffer.concat([bom, Buffer.from('col1,col2\nval1,val2')]);
    const result = parseCsvBuffer(csv);
    expect(result.headers[0]).toBe('col1');
  });

  it('detects semicolon delimiter', () => {
    const csv = 'name;amount\nBuyer;500';
    const result = parseCsvBuffer(Buffer.from(csv));
    expect(result.detectedDelimiter).toBe(';');
    expect(result.rows[0]?.amount).toBe(500);
  });

  it('handles quoted fields with commas', () => {
    const csv = 'name,address\n"Corp, Inc","123 Main St, City"';
    const result = parseCsvBuffer(Buffer.from(csv));
    expect(result.rows[0]?.name).toBe('Corp, Inc');
    expect(result.rows[0]?.address).toBe('123 Main St, City');
  });
});
