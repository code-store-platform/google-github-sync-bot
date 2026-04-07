export function normalizeGitHubUsername(username: string): string {
  return username.toLowerCase().trim();
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function getGitHubUsername(user: {
  customSchemas?: { '3rd-party_tools'?: { GitHub_Username?: string } | null } | null;
}): string | null {
  return user.customSchemas?.['3rd-party_tools']?.GitHub_Username || null;
}
