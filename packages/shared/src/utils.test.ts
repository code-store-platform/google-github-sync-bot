import { describe, expect, test } from 'bun:test';
import { normalizeGitHubUsername, normalizeEmail, getGitHubUsername } from './utils';

describe('normalizeGitHubUsername', () => {
  test('lowercases', () => {
    expect(normalizeGitHubUsername('JohnDoe')).toBe('johndoe');
  });

  test('trims whitespace', () => {
    expect(normalizeGitHubUsername('  johndoe  ')).toBe('johndoe');
  });

  test('handles mixed case with whitespace', () => {
    expect(normalizeGitHubUsername('  JohnDoe  ')).toBe('johndoe');
  });

  test('handles empty string', () => {
    expect(normalizeGitHubUsername('')).toBe('');
  });
});

describe('normalizeEmail', () => {
  test('lowercases', () => {
    expect(normalizeEmail('John@Example.COM')).toBe('john@example.com');
  });

  test('trims whitespace', () => {
    expect(normalizeEmail('  john@example.com  ')).toBe('john@example.com');
  });

  test('handles empty string', () => {
    expect(normalizeEmail('')).toBe('');
  });
});

describe('getGitHubUsername', () => {
  test('extracts username from valid user', () => {
    expect(
      getGitHubUsername({
        customSchemas: { '3rd-party_tools': { GitHub_Username: 'johndoe' } },
      }),
    ).toBe('johndoe');
  });

  test('returns null when customSchemas is undefined', () => {
    expect(getGitHubUsername({})).toBeNull();
  });

  test('returns null when customSchemas is null', () => {
    expect(getGitHubUsername({ customSchemas: null })).toBeNull();
  });

  test('returns null when 3rd-party_tools is null', () => {
    expect(getGitHubUsername({ customSchemas: { '3rd-party_tools': null } })).toBeNull();
  });

  test('returns null when 3rd-party_tools is missing', () => {
    expect(getGitHubUsername({ customSchemas: {} })).toBeNull();
  });

  test('returns null when GitHub_Username is undefined', () => {
    expect(getGitHubUsername({ customSchemas: { '3rd-party_tools': {} } })).toBeNull();
  });

  test('returns null when GitHub_Username is empty string', () => {
    expect(
      getGitHubUsername({
        customSchemas: { '3rd-party_tools': { GitHub_Username: '' } },
      }),
    ).toBeNull();
  });
});
