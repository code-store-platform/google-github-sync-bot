/**
 * Normalizes a GitHub username for consistent comparison.
 * GitHub usernames are case-insensitive, so we convert to lowercase.
 */
export function normalizeGitHubUsername(username: string): string {
  return username.toLowerCase().trim();
}